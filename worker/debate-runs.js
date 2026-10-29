// Durable discussion checkpoints. Disconnecting a viewer never restarts a paid turn.
const RETENTION = 7 * 86400000;
const TURN_LIMIT = 180000;
const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const json = (data, status = 200) => Response.json(data, { status, headers });
const retryable = status => ['failed', 'interrupted', 'cancelled', 'skipped'].includes(status);

export function createDebateRunClass(execute, authorize, core) {
  return class DebateRun {
    static contractVersion = 'studio-v3';
    constructor(ctx, env) {
      this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
      this.jobs = new Map(); this.inputs = new Map(); this.execution = null; this.abort = null;
      this.saves = Promise.resolve();
      this.sql.exec('CREATE TABLE IF NOT EXISTS debate_jobs (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS debate_turns (job TEXT, idx INTEGER, value TEXT NOT NULL, PRIMARY KEY (job, idx))');
      this.sql.exec('CREATE TABLE IF NOT EXISTS debate_inputs (job TEXT, idx INTEGER, value TEXT NOT NULL, PRIMARY KEY (job, idx))');
      for (const row of this.sql.exec('SELECT id, value FROM debate_jobs').toArray()) {
        const job = JSON.parse(row.value);
        job.turns = this.sql.exec('SELECT value FROM debate_turns WHERE job = ? ORDER BY idx', job.id).toArray().map(item => JSON.parse(item.value));
        this.jobs.set(job.id, job);
        // An uncertain, already-started provider request needs an explicit retry.
        const turn = job.turns.find(item => item.status === 'running');
        if (turn) {
          turn.status = 'interrupted'; turn.error = '服务器执行中断，已保留收到的内容；可单独重试本席。';
          job.status = 'paused'; job.reason = turn.error; job.repairOnly = false; job.syncOnRead = true;
          this.touch(job, turn);
        }
      }
    }

    get hasJobs() { return this.jobs.size > 0; }
    persist(job, turn) {
      if (job.incognito) return;
      if (turn) this.sql.exec('INSERT OR REPLACE INTO debate_turns (job, idx, value) VALUES (?, ?, ?)', job.id, turn.index, JSON.stringify(turn));
      const { turns, ...meta } = job;
      this.sql.exec('INSERT OR REPLACE INTO debate_jobs (id, value) VALUES (?, ?)', job.id, JSON.stringify(meta));
    }
    touch(job, turn) {
      job.revision++; job.updatedAt = Date.now();
      if (turn) turn.revision = job.revision;
      this.persist(job, turn);
    }
    input(job) {
      if (!this.inputs.has(job.id)) {
        const text = this.sql.exec('SELECT value FROM debate_inputs WHERE job = ? ORDER BY idx', job.id).toArray().map(row => row.value).join('');
        this.inputs.set(job.id, JSON.parse(text));
      }
      return this.inputs.get(job.id);
    }
    snapshot(job, after = 0) {
      return { id: job.id, status: job.status, revision: job.revision, reason: job.reason || '', updatedAt: job.updatedAt,
        plan: job.plan, userMessage: after ? undefined : this.userMessage(job, false), incognito: job.incognito,
        turns: job.turns.filter(turn => !after || turn.revision > after), total: job.turns.length,
        completed: job.turns.filter(turn => turn.status === 'completed').length,
        repairOnly: !!job.repairOnly, saveError: !!job.saveError };
    }
    reference(job) { return { id: job.id, status: job.status, chatId: job.chatId, projectId: job.projectId, maxUid: Math.max(...job.turns.map(turn => turn.reply.uid)) }; }
    userMessage(job, withImages = true) {
      const input = this.input(job);
      return { ...input.userMessage, ...(withImages && input.images.length ? { imgSrcs: input.images.map(i => 'data:' + i.mime + ';base64,' + i.data) } : {}), debateRun: this.reference(job) };
    }
    reply(job, turn) {
      return { ...turn.reply, debateRun: this.reference(job), debateTurn: turn.index, debateAttempt: turn.attempt,
        debateStatus: turn.status, debateError: turn.error || '', completedAt: turn.status === 'running' ? undefined : turn.updatedAt,
        isError: retryable(turn.status), debateOutdated: !!turn.outdated };
    }
    saveChat(job, initial = false) {
      if (job.incognito) return Promise.resolve();
      // Serialize KV writes as controls and provider completions can overlap.
      const work = async () => {
        const input = this.input(job), prefix = job.projectId ? 'project:' + job.user + ':' + job.projectId + ':chats' : 'chats:' + job.user;
        const key = prefix + ':' + job.chatId;
        let messages = JSON.parse(await this.env.BIZ_KV.get(key) || '[]');
        if (!Array.isArray(messages)) messages = [];
        if (initial && input.historyEndUid === null) messages = [];
        else if (initial && input.historyEndUid !== undefined) {
          const at = messages.findIndex(m => String(m.uid) === String(input.historyEndUid));
          if (at >= 0) messages = messages.slice(0, at + 1);
        }
        const upsert = message => {
          const at = messages.findIndex(m => String(m.uid) === String(message.uid));
          if (at < 0) messages.push(message); else messages[at] = { ...messages[at], ...message };
        };
        upsert(this.userMessage(job));
        for (const turn of job.turns) if (turn.status !== 'pending') upsert(this.reply(job, turn));
        const put = async (target, value) => {
          try { await this.env.BIZ_KV.put(target, value); }
          catch (error) {
            if (!/429|rate.limit|too many/i.test(String(error.message || error))) throw error;
            await new Promise(resolve => setTimeout(resolve, 1100));
            await this.env.BIZ_KV.put(target, value);
          }
        };
        await put(key, JSON.stringify(messages));
        const listKey = prefix + ':list', list = JSON.parse(await this.env.BIZ_KV.get(listKey) || '[]');
        let chat = list.find(item => item.id === job.chatId);
        if (!chat) { chat = { id: job.chatId }; list.push(chat); }
        chat.title = input.title || chat.title || '新讨论'; chat.updatedAt = Date.now();
        const lastReply = job.turns.filter(turn => turn.status === 'completed').at(-1);
        if (lastReply) chat.lastReplyAt = lastReply.updatedAt;
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        await put(listKey, JSON.stringify(list));
        if (job.saveError) { job.saveError = false; this.touch(job); }
      };
      const result = this.saves.then(work); this.saves = result.catch(() => {});
      return result.catch(() => { job.saveError = true; this.touch(job); });
    }
    async schedule() {
      if (!this.jobs.size) return;
      const active = [...this.jobs.values()].some(job => job.status === 'running');
      const next = Math.min(...[...this.jobs.values()].map(job => job.updatedAt + RETENTION));
      await this.ctx.storage.setAlarm(active ? Date.now() + 100 : Math.max(Date.now() + 1000, next));
    }
    async fetchBody(body) {
      let job = this.jobs.get(body.runId);
      const stopped = () => json({ id:job.id,status:'stopped',revision:job.revision,turns:[],total:0,completed:0 });
      if (body.action === 'start') {
        if (job && !job.plan && job.status === 'stopped') return stopped();
        if (job) return job.fingerprint === body.fingerprint ? json(this.snapshot(job)) : json({ error: '请求编号已存在，请勿修改后重复发送。' }, 409);
        if ([...this.jobs.values()].some(item => item.status === 'running') || this.execution) return json({ error: '本对话仍有讨论正在执行，请先等待或停止。' }, 409);
        const seed = body.seed;
        if (!seed) return json({ error: '缺少讨论恢复信息。' }, 400);
        const config = { ...seed.config };
        if(config.priorRunId){
          const previous=this.jobs.get(config.priorRunId);
          if(!previous?.plan||Date.now()-previous.updatedAt>RETENTION)return json({error:'上一场讨论的追问记录已过期，请引用聊天中的相关段落继续。'},410);
          if(previous.status==='running')return json({error:'请等待上一场讨论完成后再追问。'},409);
          // The actor is bound to one authenticated account/project/chat. A caller
          // cannot supply another conversation's excerpt or a fabricated verdict.
          try{config.priorContext=core.continuation(previous.plan,previous.turns);}catch(error){return json({error:error.message},400);}
        }
        const plan = core.plan(config), now = Date.now();
        job = { id: body.runId, fingerprint: body.fingerprint, user: seed.user, authVersion: seed.authVersion,
          projectId: seed.projectId, chatId: seed.chatId, incognito: seed.incognito, plan, status: 'running', revision: 1,
          createdAt: now, updatedAt: now, operations: [], turns: plan.turns.map((turn, index) => ({ index, status: 'pending', attempt: 0, revision: 1,
            reply: { uid: seed.replyUids[index], submodel: turn.member.model, effort: turn.member.effort!==undefined?turn.member.effort:seed.efforts[turn.member.model],
              brand: seed.models[turn.member.model].brand, name: turn.member.label + ' · ' + seed.models[turn.member.model].name,
              color: seed.models[turn.member.model].color, round: turn.round, _team: turn.member.team,
              participantId: turn.member.id, debateSessionId: body.runId, debateStage: turn.stage, text: '', reasoning: '', citations: [], activity: [] } })) };
        const input = { userMessage: seed.userMessage, images: seed.images, search: seed.search, skills:seed.skills, title: seed.title, historyEndUid: seed.historyEndUid };
        this.inputs.set(job.id, input); this.jobs.set(job.id, job);
        if (!job.incognito) {
          const text = JSON.stringify(input);
          for (let i = 0; i < text.length; i += 64000) this.sql.exec('INSERT INTO debate_inputs (job, idx, value) VALUES (?, ?, ?)', job.id, i / 64000, text.slice(i, i + 64000));
          for (const turn of job.turns) this.persist(job, turn);
        }
        await this.schedule(); await this.saveChat(job, true);
        return json(this.snapshot(job), 202);
      }
      if (body.action === 'stop' && !job) {
        // A delayed start must not resurrect a task stopped before its acknowledgement.
        job = { id: body.runId, fingerprint: '', status: 'stopped', revision: 1, updatedAt: Date.now(), turns: [], operations: [] };
        this.jobs.set(job.id, job); this.persist(job); await this.schedule();
        return stopped();
      }
      if (job && !job.plan && job.status === 'stopped' && body.action === 'status') return stopped();
      if (!job || !job.plan || Date.now() - job.updatedAt > RETENTION) return json({ error: '这场讨论的续跑记录已过期；已保存的聊天记录仍可查看。' }, 410);
      if (body.action === 'status') {
        if (job.syncOnRead) { await this.saveChat(job); job.syncOnRead = false; this.persist(job); }
        return json(this.snapshot(job, Math.max(0, Number(body.after) || 0)));
      }
      if (!['stop', 'resume', 'retry', 'skip', 'finish'].includes(body.action)) return json({ error: '未知讨论操作。' }, 400);
      if (job.operations.includes(body.operationId)) return json(this.snapshot(job));
      if (!body.operationId) return json({ error: '缺少操作编号。' }, 400);
      const turn = job.turns[body.turn];
      if (body.action === 'stop') {
        job.status = 'stopped'; job.reason = '已停止。保留已完成发言，可继续剩余席位。';
        const current = job.turns.find(item => item.status === 'running');
        if (current) { current.status = 'cancelled'; current.error = '本席已停止，发言未完成。'; current.updatedAt = Date.now(); this.touch(job, current); }
        if (current) this.abort?.abort(); job.repairOnly = false;
      } else {
        if (job.status === 'running' || this.execution) return json({ error: '讨论仍在执行，请等待当前席位结束。' }, 409);
        if (body.action === 'finish') {
          for (const item of job.turns) if (item.status === 'pending') { item.status = 'skipped'; item.error = '已结束本场，未执行这一席。'; item.updatedAt = Date.now(); this.touch(job, item); }
          job.status = 'partial'; job.repairOnly = false; job.reason = '本场已结束，完成的发言已保留。';
        } else if (body.action === 'resume') {
          if (job.turns.some(item => ['failed', 'interrupted', 'cancelled'].includes(item.status))) return json({ error: '请先重试或跳过未完成的席位。' }, 409);
          job.status = 'running'; job.repairOnly = false;
        } else {
          if (!turn || turn.attempt !== body.attempt || !retryable(turn.status)) return json({ error: '本席状态已变化，请刷新进度后再操作。' }, 409);
          if (body.action === 'skip') { turn.status = 'skipped'; turn.updatedAt = Date.now(); job.repairOnly = false; }
          else {
            // Repairing an earlier seat leaves later paid answers intact and labels them stale.
            job.repairOnly = job.turns.slice(turn.index + 1).some(item => item.status !== 'pending');
            if (job.repairOnly) for (const later of job.turns.slice(turn.index + 1)) if (later.status === 'completed' && job.plan.turns[later.index].round > job.plan.turns[turn.index].round) { later.outdated = true; this.touch(job, later); }
            turn.status = 'pending'; turn.error = ''; job.repairIndex = job.repairOnly ? turn.index : null;
          }
          job.status = 'running'; this.touch(job, turn);
        }
        job.reason = '';
      }
      job.operations.push(body.operationId); job.operations = job.operations.slice(-100);
      this.touch(job); await this.schedule(); await this.saveChat(job);
      return json(this.snapshot(job));
    }

    async perform(job, turn) {
      let timer, reader;
      try {
        const credentials = await authorize(job, this.env), input = this.input(job), spec = job.plan.turns[turn.index];
        if (job.status !== 'running' || turn.status !== 'running') return;
        const records = job.turns.filter(item => item.index !== turn.index && item.status !== 'pending').map(item => ({ ...job.plan.turns[item.index], ok: item.status === 'completed', text: item.reply.text }));
        const prompt = core.prompt(job.plan, spec, records);
        this.abort = new AbortController();
        timer = setTimeout(() => this.abort?.abort(), TURN_LIMIT);
        const payload = { ...credentials, model: spec.member.model, effort: turn.reply.effort, prompt, images: input.images, search: input.search, noAutomaticRetry: true,
          projectId: job.projectId, chat: { scope: job.projectId || 'general', chatId: job.chatId, question: prompt,
            query: job.plan.topic, history: [], historyEndUid: null, incognito: job.incognito, debate:true, skills:input.skills } };
        const response = await execute(new Request('https://internal.invalid/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: this.abort.signal }), this.env);
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || '模型请求失败（' + response.status + '）'); }
        reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', done = false;
        while (!done && job.status === 'running' && turn.status === 'running') {
          const chunk = await reader.read();
          buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
          if (buffer.length > 500000) throw new Error('模型数据过长，已保留收到的内容。');
          const lines = buffer.split('\n'); buffer = lines.pop();
          if (chunk.done && buffer) { lines.push(buffer); buffer = ''; }
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const value = line.slice(5).trim(); if (!value) continue;
            if (value === '[DONE]') { done = true; break; }
            const item = JSON.parse(value), reply = turn.reply;
            if (item.error) throw new Error(typeof item.error === 'string' ? item.error : item.error.message);
            if (item.t) reply.text += item.t;
            if (item.r) reply.reasoning += item.r;
            if (item.context) reply.context = item.context;
            if (item.grounding) reply.grounding = item.grounding;
            if (item.usage) reply.usage = item.usage;
            if (item.citation) {
              let index = reply.citations.findIndex(c => c.url === item.citation.url);
              if (index < 0 && reply.citations.length < 100) { index = reply.citations.length; reply.citations.push(item.citation); }
              if (index >= 0 && item.citationInline !== false) reply.text += ' [[aa-citation:' + (index + 1) + ']] ';
            }
            if (item.activity && reply.activity.length < 80) reply.activity.push(item.activity);
            if (item.status && item.status !== 'responding' && reply.activity.length < 80 && reply.activity.at(-1)?.kind !== item.status) reply.activity.push({ kind: item.status, label: item.status === 'searching' ? '搜索网页' : '模型思考' });
            if (reply.text.length + reply.reasoning.length > 240000) throw new Error('本席回答过长，已保留收到的内容。');
          }
          this.touch(job, turn);
          if (chunk.done) break;
        }
        if (turn.status === 'running') {
          if (!done) throw new Error('上游连接提前结束，已保留收到的内容；可单独重试本席。');
          if (!turn.reply.text.trim()) throw new Error('模型未返回有效发言，可单独重试本席。');
          turn.status = 'completed'; turn.error = '';
        }
      } catch (error) {
        if (turn.status === 'running') { turn.status = 'failed'; turn.error = String(error?.name === 'AbortError' ? '本席发言超时或连接中断，可单独重试。' : error?.message || '本席请求失败。').slice(0, 1000); }
      } finally {
        clearTimeout(timer); if (reader) await reader.cancel().catch(() => {}); this.abort = null;
        turn.updatedAt = Date.now();
        if (job.status === 'running') {
          if (turn.status !== 'completed') { job.status = 'paused'; job.reason = turn.error; }
          else if (job.repairOnly) { job.status = job.turns.some(item => item.status === 'pending' || retryable(item.status)) ? 'paused' : 'completed'; job.reason = '本席已补全，后续已有发言保留。'; job.repairOnly = false; }
        }
        this.touch(job, turn); await this.saveChat(job);
      }
    }
    async alarm() {
      if (this.execution) return;
      for (const job of this.jobs.values()) if (job.status !== 'running' && Date.now() - job.updatedAt > RETENTION) {
        this.sql.exec('DELETE FROM debate_turns WHERE job = ?', job.id); this.sql.exec('DELETE FROM debate_inputs WHERE job = ?', job.id); this.sql.exec('DELETE FROM debate_jobs WHERE id = ?', job.id);
        this.jobs.delete(job.id); this.inputs.delete(job.id);
      }
      const job = [...this.jobs.values()].find(item => item.status === 'running');
      if (!job) { await this.schedule(); return; }
      const turn = job.repairOnly ? job.turns[job.repairIndex] : job.turns.find(item => item.status === 'pending');
      if (!turn) {
        job.status = job.turns.some(item => retryable(item.status)) ? 'partial' : 'completed'; job.reason = '';
        this.touch(job); await this.saveChat(job); await this.schedule(); return;
      }
      if (job.plan.turns[turn.index].summary && !job.turns.some(item => item.status === 'completed')) {
        turn.status = 'skipped'; turn.error = '没有已完成发言，已跳过总结。'; this.touch(job, turn); await this.schedule(); return;
      }
      // Claim synchronously before the first await, including the provider call.
      turn.status = 'running'; turn.attempt++; turn.error = '';
      turn.reply.text = ''; turn.reply.reasoning = ''; turn.reply.citations = []; turn.reply.activity = [];
      delete turn.reply.usage; delete turn.reply.grounding; delete turn.reply.context;
      this.touch(job, turn);
      this.execution = this.perform(job, turn);
      try { await this.execution; } finally { this.execution = null; await this.schedule(); }
    }
  };
}
