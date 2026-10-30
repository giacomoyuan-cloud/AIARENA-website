// One durable scheduler per account. No credentials are persisted in task records.
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{6,80}$/.test(value);
const DAY = 86400000;
export function validateSchedule(value) {
  if (!value || !['once', 'daily', 'weekdays', 'weekly'].includes(value.frequency)) throw Error('请选择执行频率');
  const timeZone = value.timeZone || 'Asia/Shanghai';
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { throw Error('时区无效'); }
  if (value.frequency === 'once') {
    const at = Date.parse(value.at);
    if (!Number.isFinite(at)) throw Error('请选择有效的执行时间');
    return { frequency: 'once', at: new Date(at).toISOString(), timeZone };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time || '')) throw Error('请选择有效的执行时间');
  const day = Number(value.day);
  if (value.frequency === 'weekly' && (!Number.isInteger(day) || day < 0 || day > 6)) throw Error('请选择每周执行日期');
  return { frequency: value.frequency, time: value.time, timeZone, ...(value.frequency === 'weekly' ? { day } : {}) };
}
export function nextOccurrence(schedule, after = Date.now()) {
  const value = validateSchedule(schedule);
  if (value.frequency === 'once') return Date.parse(value.at) > after ? Date.parse(value.at) : null;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: value.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = stamp => Object.fromEntries(fmt.formatToParts(stamp).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  const local = parts(after), [hour, minute] = value.time.split(':').map(Number);
  for (let offset = 0; offset < 9; offset++) {
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day + offset)), weekday = date.getUTCDay();
    if (value.frequency === 'weekdays' && [0, 6].includes(weekday) || value.frequency === 'weekly' && weekday !== value.day) continue;
    const wall = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
    let utc = wall;
    for (let i = 0; i < 4; i++) {
      const p = parts(utc), delta = wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      utc += delta;
      if (!delta) break;
    }
    const p = parts(utc);
    // Skip nonexistent times during a daylight-saving transition.
    if (utc > after && p.year === date.getUTCFullYear() && p.month === date.getUTCMonth() + 1 && p.day === date.getUTCDate() && p.hour === hour && p.minute === minute) return utc;
  }
  return null;
}

export function createProjectScheduler({ execute, credentials, project, models, efforts = {} }) {
  return class ProjectScheduler {
    constructor(ctx, env) {
      this.ctx = ctx; this.env = env; this.running = false;
      this.ready = ctx.blockConcurrencyWhile(async () => {
        this.tasks = await ctx.storage.get('tasks') || [];
        let changed = false;
        for (const task of this.tasks) if (task.status === 'running') {
          task.status = 'failed'; task.error = '执行中断，未自动重复调用模型'; changed = true;
          task.history.unshift({ at: task.lastRunAt, status: 'failed', error: task.error, chatId: task.chatId });
          task.history = task.history.slice(0, 20);
        }
        if (changed) await this.persist();
      });
    }
    async persist() { await this.ctx.storage.put('tasks', this.tasks); }
    async arm() {
      const times = this.tasks.filter(t => t.enabled && t.status !== 'running' && t.nextRunAt).map(t => t.nextRunAt);
      if (times.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, Math.min(...times)));
      else await this.ctx.storage.deleteAlarm();
    }
    async fetch(request) {
      await this.ready;
      try {
        const body = await request.json(), action = body.action || 'list';
        if (action === 'list') return json({ tasks: this.tasks.filter(t => body.projectId === undefined || t.projectId === body.projectId) });
        if (action === 'create' || action === 'update') {
          if (this.running && this.tasks.find(t => t.id === body.id)?.status === 'running') return json({ error: '任务执行中，完成后可修改' }, 409);
          if (!idOK(body.id)) return json({ error: '任务编号无效' }, 400);
          const prior = this.tasks.find(t => t.id === body.id);
          if (action === 'create' && prior) return json({ task: prior }); // Lost creation acknowledgements are safe to retry.
          if (action === 'update' && !prior) return json({ error: '任务不存在' }, 404);
          if (!prior && this.tasks.length >= 30) return json({ error: '最多保存 30 个定时任务' }, 400);
          const name = String(body.name || '').trim(), prompt = String(body.prompt || '').trim();
          if (!name || name.length > 80 || !prompt || prompt.length > 8000) return json({ error: '名称最多 80 字，任务指令需为 1–8000 字' }, 400);
          if (!models.includes(body.model)) return json({ error: '请选择可用的文字模型' }, 400);
          const effort=typeof body.effort==='string'&&body.effort?body.effort:body.effort===undefined&&prior?.model===body.model?prior?.effort:undefined;
          if(effort!==undefined&&!(efforts[body.model]||[]).includes(effort))return json({error:'请选择此模型支持的思考深度'},400);
          const projectId = body.projectId || null;
          if (projectId) await project(this.env, body.user, projectId);
          const schedule = validateSchedule(body.schedule), nextRunAt = nextOccurrence(schedule);
          if (!nextRunAt) return json({ error: '执行时间必须在将来' }, 400);
          const task = { id: body.id, user: body.user, projectId, name, prompt, model: body.model, ...(effort!==undefined?{effort}:{}), search: body.search === true, schedule, enabled: body.enabled !== false, nextRunAt, status: prior?.status || 'scheduled', createdAt: prior?.createdAt || Date.now(), updatedAt: Date.now(), history: prior?.history || [], ...(prior?.lastRunAt ? { lastRunAt: prior.lastRunAt } : {}) };
          this.tasks = this.tasks.filter(t => t.id !== task.id); this.tasks.unshift(task);
          await this.persist(); await this.arm(); return json({ task });
        }
        const task = this.tasks.find(t => t.id === body.id);
        if (!task) return json({ error: '任务不存在' }, 404);
        if (task.projectId && action !== 'delete' && !(action === 'toggle' && body.enabled === false)) await project(this.env, body.user, task.projectId);
        if (task.status === 'running') return json({ error: '任务执行中，完成后可操作' }, 409);
        if (action === 'toggle') {
          if (typeof body.enabled !== 'boolean') return json({ error: '任务状态无效' }, 400);
          if (body.enabled) { const next = nextOccurrence(task.schedule); if (!next) return json({ error: '原定时间已过，请先修改执行时间' }, 400); task.nextRunAt = next; }
          task.enabled = body.enabled;
        } else if (action === 'delete') this.tasks = this.tasks.filter(t => t.id !== task.id);
        else if (action === 'run') {
          if (this.running) return json({ error: '已有任务执行中，请稍后再试' }, 409);
          task.nextRunAt = Date.now(); task.enabled = true;
        } else return json({ error: '未知任务操作' }, 400);
        task.updatedAt = Date.now(); await this.persist(); await this.arm(); return json({ ok: true, task });
      } catch (error) { return json({ error: error.status ? error.message : error instanceof SyntaxError ? '任务请求无效' : error.message || '任务操作失败' }, error.status || 400); }
    }
    async alarm() {
      await this.ready;
      if (this.running) return;
      this.running = true;
      try {
        const task = this.tasks.find(t => t.enabled && t.status !== 'running' && t.nextRunAt && t.nextRunAt <= Date.now());
        if (!task) return;
        task.lastRunAt = Date.now(); task.nextRunAt = nextOccurrence(task.schedule, task.lastRunAt);
        task.enabled = !!task.nextRunAt; task.status = 'running'; task.error = null;
        task.chatId = 'scheduled-' + crypto.randomUUID();
        // Persist before any paid request. A crash produces an interrupted result, never a duplicate call.
        await this.persist();
        let timer, reader;
        const reply = { uid: 2, name: task.model, submodel: task.model, brand: 'assistant', text: '', citations: [] };
        const messages = [{ uid: 1, isUser: true, name: '定时任务', text: task.prompt, createdAt: task.lastRunAt }, reply];
        try {
          if (task.projectId) await project(this.env, task.user, task.projectId);
          const auth = await credentials(this.env, task.user), controller = new AbortController();
          timer = setTimeout(() => controller.abort(), 14 * 60000);
          const response = await execute(new Request('https://internal.invalid/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({ ...auth, model: task.model, ...(task.effort!==undefined?{effort:task.effort}:{}), projectId: task.projectId, search: task.search, chat: { scope: task.projectId || 'general', chatId: task.chatId, question: task.prompt, query: task.prompt, history: [], historyEndUid: null, systemMode: 'default' } }) }), this.env);
          if (!response.ok) { const data = await response.json().catch(() => ({})); throw Error(data.error || '模型请求失败'); }
          reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', completed = false;
          for (;;) {
            const part = await reader.read(); buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
            const lines = buffer.split('\n'); buffer = lines.pop();
            for (const line of lines) if (line.startsWith('data: ')) {
              const raw = line.slice(6); if (raw === '[DONE]') { completed = true; continue; }
              const event = JSON.parse(raw);
              if (event.error) throw Error(typeof event.error === 'string' ? event.error : '模型请求失败');
              if (event.t) reply.text += event.t;
              if (event.r) reply.reasoning = (reply.reasoning || '') + event.r;
              if (event.modelName) reply.name = event.modelName;
              if (event.context) reply.context = event.context;
              if (event.grounding) reply.grounding = event.grounding;
              if (event.usage) reply.usage = event.usage;
              if (event.citation) { reply.citations.push(event.citation); if (event.citationInline !== false) reply.text += ' [[aa-citation:' + reply.citations.length + ']] '; }
              if (reply.text.length > 400000) throw Error('结果过长，已保留收到的内容');
            }
            if (part.done) break;
          }
          if (!completed || !reply.text.trim()) throw Error('未收到完整结果，已保留收到的内容');
          task.status = 'completed';
        } catch (error) {
          task.status = 'failed'; task.error = error.name === 'AbortError' ? '执行超时' : String(error.message || '执行失败').slice(0, 300);
          if (error.status === 404) { task.enabled = false; task.nextRunAt = null; }
          reply.isError = true; reply.text += '\n\n[' + task.error + ']';
        } finally { clearTimeout(timer); if (reader) await reader.cancel().catch(() => {}); }
        reply.completedAt = Date.now();
        const prefix = task.projectId ? 'project:' + task.user + ':' + task.projectId + ':chats' : 'chats:' + task.user;
        await this.env.BIZ_KV.put(prefix + ':' + task.chatId, JSON.stringify(messages));
        const list = JSON.parse(await this.env.BIZ_KV.get(prefix + ':list') || '[]');
        list.unshift({ id: task.chatId, title: task.name, customTitle: true, updatedAt: reply.completedAt, lastReplyAt: reply.completedAt, scheduleId: task.id });
        await this.env.BIZ_KV.put(prefix + ':list', JSON.stringify(list));
        task.history.unshift({ at: task.lastRunAt, completedAt: reply.completedAt, status: task.status, chatId: task.chatId, ...(task.error ? { error: task.error } : {}) });
        task.history = task.history.slice(0, 20); await this.persist();
      } finally { this.running = false; await this.arm(); }
    }
  };
}
