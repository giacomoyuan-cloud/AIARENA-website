import { handleBillingLedger } from './billing-ledger.js';
import { handleProjectLibrary } from './project-library.js';
// A generation belongs to its chat, not to a phone's HTTP connection.
// Credentials and provider keys are never written to Durable Object storage.
const encoder = new TextEncoder();
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_LOG_BYTES = 64 * 1024 * 1024;
const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const json = (value, status = 200) => Response.json(value, { status, headers: cors });
const terminal = status => status && status !== 'running';

export function createChatRunClass(execute, DebateRun, { deferStart = () => false, createTransport, onInterrupt, executePayload } = {}) {
  return class ChatRun {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
      this.transport = createTransport?.(ctx, env);
      this.listeners = new Set();
      this.privateEvents = [];
      this.execution = null;
      this.pendingRun = null;
      this.abort = null;
      this.sql = ctx.storage.sql;
      if (DebateRun) this.debate = new DebateRun(ctx, env);
      this.sql.exec('CREATE TABLE IF NOT EXISTS run_meta (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS run_events (seq INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      // Upgrade existing objects in place; do not discard their last run.
      if (!this.sql.exec('PRAGMA table_info(run_events)').toArray().some(column => column.name === 'received_at')) {
        this.sql.exec('ALTER TABLE run_events ADD COLUMN received_at INTEGER');
      }
      this.sql.exec('CREATE TABLE IF NOT EXISTS run_history (run_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, value TEXT NOT NULL)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS run_event_history (run_id TEXT NOT NULL, seq INTEGER NOT NULL, value TEXT NOT NULL, received_at INTEGER, PRIMARY KEY (run_id, seq))');
      this.sql.exec('CREATE INDEX IF NOT EXISTS run_history_expiry ON run_history(expires_at)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS run_meta_chunks (run_id TEXT NOT NULL, idx INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (run_id, idx))');
      const saved = this.sql.exec('SELECT value FROM run_meta WHERE id = 1').toArray()[0];
      this.meta = saved ? this.readMeta(saved.value) : null;
      // A process restart must not silently charge for a second provider request.
      if (this.meta?.status === 'running') {
        for (const event of this.sql.exec('SELECT seq, value, received_at FROM run_events WHERE seq > ? ORDER BY seq', this.meta.sequence).toArray()) {
          this.absorb(event.value, event.received_at ?? this.meta.updatedAt ?? this.meta.createdAt);
          this.meta.sequence = event.seq;
          this.meta.logBytes = (this.meta.logBytes || 0) + encoder.encode(event.value).length;
        }
        this.meta.status = 'interrupted';
        this.meta.error = '服务器连接已中断，已保留收到的内容。请重新回答以继续。';
        this.persistMeta();
        if(onInterrupt&&this.meta.reply?.diagnostics?.googleInteractionId){
          const interrupted=this.meta;
          const cancelled=Promise.resolve().then(()=>onInterrupt(interrupted,this.env)).catch(()=>{});
          this.ctx.waitUntil?.(cancelled);
        }
      }
    }

    readMeta(value) {
      const meta=JSON.parse(value);
      if(!meta._chunkedMeta)return meta;
      const chunks=this.sql.exec('SELECT value FROM run_meta_chunks WHERE run_id = ? ORDER BY idx',meta.runId).toArray();
      if(chunks.length!==meta._chunkedMeta)throw new Error('已保存的回答分段不完整。');
      return JSON.parse(chunks.map(c=>c.value).join(''));
    }

    writeMeta(meta) {
      const value=JSON.stringify(meta);
      this.sql.exec('DELETE FROM run_meta_chunks WHERE run_id = ?',meta.runId);
      if(value.length<=64000)return value;
      let count=0;
      for(let offset=0;offset<value.length;){
        let end=Math.min(value.length,offset+64000);
        if(end<value.length&&/[\uD800-\uDBFF]/.test(value[end-1]))end--;
        this.sql.exec('INSERT INTO run_meta_chunks (run_id, idx, value) VALUES (?, ?, ?)',meta.runId,count++,value.slice(offset,end));offset=end;
      }
      return JSON.stringify({_chunkedMeta:count,runId:meta.runId});
    }

    persistMeta() {
      if (!this.meta || this.meta.incognito) return;
      this.ctx.storage.transactionSync(()=>{
        this.sql.exec('INSERT OR REPLACE INTO run_meta (id, value) VALUES (1, ?)',this.writeMeta(this.meta));
      });
      this.lastMetaSave = Date.now();
    }

    snapshot(meta = this.meta) {
      if (!meta) return null;
      const { runId, status, sequence, createdAt, updatedAt, error, reply } = meta;
      return { runId, status, sequence, createdAt, updatedAt, error, reply };
    }

    archived(runId) {
      const row = this.sql.exec('SELECT value FROM run_history WHERE run_id = ? AND expires_at > ?', runId, Date.now()).toArray()[0];
      return row ? this.readMeta(row.value) : null;
    }

    archiveCurrent() {
      if (!this.meta || this.meta.incognito) return;
      const meta = this.meta;
      // Copy and clear atomically. A failed copy leaves the old run intact.
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('INSERT OR REPLACE INTO run_event_history (run_id, seq, value, received_at) SELECT ?, seq, value, received_at FROM run_events', meta.runId);
        this.sql.exec('INSERT OR REPLACE INTO run_history (run_id, expires_at, value) VALUES (?, ?, ?)', meta.runId, (meta.updatedAt || meta.createdAt || Date.now()) + RETENTION_MS, this.writeMeta(meta));
        this.sql.exec('DELETE FROM run_events');
        this.sql.exec('DELETE FROM run_meta');
      });
    }

    pruneHistory() {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM run_meta_chunks WHERE run_id IN (SELECT run_id FROM run_history WHERE expires_at <= ?)', Date.now());
        this.sql.exec('DELETE FROM run_event_history WHERE run_id IN (SELECT run_id FROM run_history WHERE expires_at <= ?)', Date.now());
        this.sql.exec('DELETE FROM run_history WHERE expires_at <= ?', Date.now());
      });
    }

    async scheduleCleanup() {
      const next = this.sql.exec('SELECT MIN(expires_at) AS at FROM run_history').toArray()[0]?.at;
      const current = this.meta && !this.meta.incognito
        ? (terminal(this.meta.status) ? (this.meta.updatedAt || this.meta.createdAt || Date.now()) : Date.now()) + RETENTION_MS : null;
      const deadlines = [next, current].filter(value => value != null);
      if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...deadlines)));
    }

    events(after, meta = this.meta, privateEvents = this.privateEvents) {
      if (meta?.incognito) return privateEvents.filter(item => item.seq > after);
      if (meta?.runId !== this.meta?.runId) return this.sql.exec('SELECT seq, value FROM run_event_history WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT 256', meta.runId, after).toArray();
      return this.sql.exec('SELECT seq, value FROM run_events WHERE seq > ? ORDER BY seq LIMIT 256', after).toArray();
    }

    async append(value) {
      if (!this.meta) return;
      const size = encoder.encode(value).length;
      if (size > 120000 || (this.meta.logBytes || 0) + size > MAX_LOG_BYTES) throw new Error('回答过长，已保存收到的部分。');
      const seq = ++this.meta.sequence;
      this.meta.logBytes = (this.meta.logBytes || 0) + size;
      this.meta.updatedAt = Date.now();
      if (this.meta.incognito) this.privateEvents.push({ seq, value });
      else this.sql.exec('INSERT INTO run_events (seq, value, received_at) VALUES (?, ?, ?)', seq, value, this.meta.updatedAt);
      if (Date.now() - (this.lastMetaSave || 0) >= 500 || value === '[DONE]') this.persistMeta();
      this.listeners.forEach(wake => wake());
    }

    absorb(value, receivedAt = Date.now()) {
      if (value === '[DONE]') return;
      let item;
      try { item = JSON.parse(value); } catch { throw new Error('模型返回的数据格式不完整，已保留收到的内容。'); }
      const reply = this.meta.reply;
      if (item.diagnostics || item.t || item.r || item.usage || item.usageCheckpoint) {
        reply.diagnostics = { ...reply.diagnostics, ...item.diagnostics, lastEventAt: receivedAt };
        if (item.t) { reply.diagnostics.firstTextAt ??= receivedAt; reply.diagnostics.lastTextAt = receivedAt; }
        if (item.r) { reply.diagnostics.firstReasoningAt ??= receivedAt; reply.diagnostics.lastReasoningAt = receivedAt; }
      }
      if (item.error) this.meta.error = typeof item.error === 'string' ? item.error : item.error.message;
      if (item.modelName) reply.name = item.modelName;
      if (item.t) reply.text += item.t;
      if (item.r) reply.reasoning = (reply.reasoning || '') + item.r;
      if (item.context) reply.context = item.context;
      if (item.skills) reply.skills=item.skills;
      if (item.artifacts) reply.artifacts=[...(reply.artifacts||[]),...item.artifacts];
      if (item.skillSession) reply.skillSession=item.skillSession;
      if (item.executionModel) { reply.executionModel=item.executionModel; reply.submodel=item.executionModel; if(item.executionModel.startsWith('claude-'))reply.brand='anthropic'; }
      if (item.grounding) reply.grounding = item.grounding;
      if (item.usage) reply.usage = item.usage;
      else if (item.usageCheckpoint) reply.usage = item.usageCheckpoint;
      if (item.citation) {
        const index = reply.citations.findIndex(source => source.url === item.citation.url);
        if (index < 0) reply.citations.push(item.citation);
        else if (item.citation.title) reply.citations[index].title = item.citation.title;
        if (item.citationInline !== false) reply.text += ' [[aa-citation:' + (index < 0 ? reply.citations.length : index + 1) + ']] ';
      }
      if(item.activity?.kind==='project_reading'){
        const index=reply.activity.findIndex(a=>a.kind==='project_reading');
        if(index>=0)reply.activity[index]=item.activity;else if(reply.activity.length<80)reply.activity.push(item.activity);
      }else if (item.activity && reply.activity.length < 80) reply.activity.push(item.activity);
      else if (item.status && item.status !== 'responding' && reply.activity.at(-1)?.kind !== item.status) {
        reply.activity.push({ kind: item.status, label: item.status === 'searching' ? '搜索网页' : '模型思考' });
      }
    }

    async saveChat(initial = false) {
      const meta = this.meta;
      if (!meta || meta.incognito || !meta.userMessage || !meta.reply) return;
      const prefix = meta.projectId ? 'project:' + meta.user + ':' + meta.projectId + ':chats' : 'chats:' + meta.user;
      const key = prefix + ':' + meta.chatId;
      let messages = JSON.parse(await this.env.BIZ_KV.get(key) || '[]');
      if (!Array.isArray(messages)) messages = [];
      if (initial && meta.historyEndUid === null) messages = [];
      else if (initial && meta.historyEndUid !== undefined) {
        const at = messages.findIndex(item => String(item.uid) === String(meta.historyEndUid));
        if (at >= 0) messages = messages.slice(0, at + 1);
      }
      const upsert = message => {
        const index = messages.findIndex(item => String(item.uid) === String(message.uid));
        if (index < 0) messages.push(message); else messages[index] = { ...messages[index], ...message };
      };
      upsert(meta.userMessage);
      const reply = { ...meta.reply, run: { id: meta.runId, status: meta.status, chatId: meta.chatId, projectId: meta.projectId } };
      if (terminal(meta.status)) {
        reply.completedAt = meta.updatedAt;
        reply.isError = !['completed', 'cancelled'].includes(meta.status);
        if (meta.error) reply.text += '\n\n[' + meta.error + ']';
        else if (meta.status === 'cancelled' && !reply.text) reply.text = '已停止生成。';
      }
      upsert(reply);
      const put = async (target, value) => {
        try { await this.env.BIZ_KV.put(target, value); }
        catch (error) {
          if (!/429|rate.limit|too many/i.test(String(error.message || error))) throw error;
          await new Promise(resolve => setTimeout(resolve, 1100));
          await this.env.BIZ_KV.put(target, value);
        }
      };
      await put(key, JSON.stringify(messages));
      if (initial || terminal(meta.status)) {
        const listKey = prefix + ':list';
        const list = JSON.parse(await this.env.BIZ_KV.get(listKey) || '[]');
        let chat = list.find(item => item.id === meta.chatId);
        if (!chat) { chat = { id: meta.chatId }; list.push(chat); }
        chat.title = meta.title || chat.title || '新对话';
        chat.updatedAt = Date.now();
        chat.mode = 'chat';
        if (terminal(meta.status)) chat.lastReplyAt = reply.completedAt;
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        await put(listKey, JSON.stringify(list));
      }
    }

    async generate(payload) {
      try {
        await this.saveChat(true);
        if (this.meta.status !== 'running') return;
        this.abort = new AbortController();
        // Let a slow thinking stream finish. Only Stop, upstream failure or
        // the existing output-size bound cancels it; elapsed time does not.
        const response = executePayload ? await executePayload(payload,this.env,this.abort.signal) : await execute(new Request('https://internal.invalid/', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: this.abort.signal
        }), this.env);
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || '模型请求失败（' + response.status + '）');
        }
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '', done = false, lastSave = Date.now();
        while (!done && this.meta.status === 'running') {
          const part = await reader.read();
          buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
          const lines = buffer.split('\n'); buffer = lines.pop();
          if (part.done && buffer) { lines.push(buffer); buffer = ''; }
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const value = line.slice(5).trim();
            if (!value) continue;
            if (value === '[DONE]') { done = true; break; }
            this.absorb(value);
            await this.append(value);
          }
          if (Date.now() - lastSave >= 5000) { await this.saveChat(); lastSave = Date.now(); }
          if (part.done) break;
        }
        if (!done && this.meta.status === 'running' && !this.meta.error) this.meta.error = '上游连接中断，已保留收到的内容。请重新回答以继续。';
        if (this.meta.status === 'running') this.meta.status = this.meta.error ? 'failed' : 'completed';
        await reader.cancel().catch(() => {});
      } catch (error) {
        if (this.meta.status === 'running') {
          this.meta.status = 'failed';
          this.meta.error ||= String(error?.message || '生成中断，已保留收到的内容。');
        }
      } finally {
        this.meta.updatedAt = Date.now();
        this.meta.reply.completedAt = this.meta.updatedAt;
        try {
          if (this.meta.error) await this.append(JSON.stringify({ error: this.meta.error }));
          await this.append('[DONE]');
          this.persistMeta();
          await this.saveChat();
        } catch { this.meta.saveError = true; this.persistMeta(); }
        try { await this.scheduleCleanup(); }
        catch { this.meta.saveError = true; this.persistMeta(); }
        this.listeners.forEach(wake => wake());
        this.execution = null;
      }
    }

    stream(after, signal, meta = this.meta) {
      const self = this;
      const privateEvents = this.privateEvents;
      let stopped = false, wake = null;
      return new ReadableStream({
        async start(controller) {
          const onAbort = () => { stopped = true; if (wake) wake(); };
          signal?.addEventListener('abort', onAbort, { once: true });
          try {
            controller.enqueue(encoder.encode(': connected\n\n'));
            while (!stopped) {
              const events = self.events(after, meta, privateEvents);
              for (const item of events) {
                controller.enqueue(encoder.encode('id: ' + item.seq + '\ndata: ' + item.value + '\n\n'));
                after = item.seq;
              }
              if (terminal(meta.status) && after >= meta.sequence) break;
              if (after < meta.sequence) continue;
              await new Promise(resolve => {
                const timer = setTimeout(resolve, 10000);
                wake = () => { clearTimeout(timer); resolve(); };
                self.listeners.add(wake);
              });
              self.listeners.delete(wake); wake = null;
              if (!stopped) controller.enqueue(encoder.encode(': heartbeat\n\n'));
            }
            try { controller.close(); } catch {}
          } catch { /* A lost subscriber does not cancel generation. */ }
          finally { signal?.removeEventListener('abort', onAbort); if (wake) self.listeners.delete(wake); }
        },
        cancel() { stopped = true; if (wake) wake(); }
      });
    }

    async fetch(request) {
      const target=new URL(request.url);
      if(target.hostname==='usage-ledger.internal'&&target.pathname==='/__billing')return handleBillingLedger(this.ctx,request);
      if(target.hostname==='project-library.internal')return handleProjectLibrary(this.ctx,this.env,request);
      if (this.transport?.matches(request)) return this.transport.fetch(request);
      const body = await request.json();
      if (body.kind === 'debate' && this.debate) return this.debate.fetchBody(body);
      // Internal, read-only repair for archives saved by older clients. Never
      // start/reconnect a model, return private runs, or expose prompt contents.
      if (body.action === 'usage') {
        if (target.hostname !== 'chat-run.internal') return json({ error: 'Internal usage lookup only' }, 400);
        if (!Array.isArray(body.runIds) || body.runIds.length > 8 || body.runIds.some(id => typeof id !== 'string' || !id || id.length > 160)) return json({ error: 'Invalid usage references' }, 400);
        const usages = [];
        for (const runId of new Set(body.runIds)) {
          const meta = this.meta?.runId === runId ? this.meta : this.archived(runId);
          if (!meta?.incognito && meta?.reply?.usage?.schemaVersion === 2) usages.push({ runId, uid: meta.reply.uid, usage: meta.reply.usage });
        }
        return json({ usages });
      }
      const archived = this.meta?.runId === body.runId ? null : this.archived(body.runId);
      if (archived) {
        if (body.action === 'start' && archived.fingerprint && archived.fingerprint !== body.fingerprint) return json({ error: '请求编号已存在，请勿修改后重复发送。' }, 409);
        if (body.action === 'events') return new Response(this.stream(Number(body.after) || 0, request.signal, archived), {
          headers: { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8' }
        });
        if (['start', 'status', 'stop'].includes(body.action)) return json(this.snapshot(archived));
      }
      if (body.action === 'start') {
        if (this.meta?.runId === body.runId) {
          if (this.meta.fingerprint && this.meta.fingerprint !== body.fingerprint) return json({ error: '请求编号已存在，请勿修改后重复发送。' }, 409);
          return json(this.snapshot());
        }
        if (this.meta?.status === 'running' || this.execution || this.pendingRun) return json({ error: '这段对话仍有回答正在生成，请先等待或停止。' }, 409);
        if (!body.payload || !body.recovery) return json({ error: '缺少恢复信息。' }, 400);
        this.pruneHistory();
        this.archiveCurrent();
        this.privateEvents = [];
        this.meta = { ...body.recovery, runId: body.runId, fingerprint: body.fingerprint, status: 'running', sequence: 0, createdAt: Date.now(), updatedAt: Date.now(), logBytes: 0 };
        const deferred = deferStart(body.payload);
        if (deferred) this.meta.alarmRetainUntil = Date.now() + RETENTION_MS;
        this.persistMeta();
        if (deferred) {
          // An alarm starts a server-originated request without inheriting the
          // browser request's network context. Keep credentials in memory only.
          this.pendingRun = { runId: body.runId, payload: body.payload };
          try { await this.ctx.storage.setAlarm(Date.now() + 1); }
          catch (error) {
            this.pendingRun = null;
            this.meta.status = 'failed';
            this.meta.error = '后台任务启动失败，请重新发送。';
            this.persistMeta();
            throw error;
          }
        } else {
          try { await this.scheduleCleanup(); }
          catch (error) {
            this.meta.status = 'failed';
            this.meta.error = '后台任务启动失败，请重新发送。';
            this.persistMeta();
            throw error;
          }
          this.execution = this.generate(body.payload);
          this.ctx.waitUntil(this.execution);
        }
        return json(this.snapshot(), 202);
      }
      if (body.action === 'stop' && !this.meta) {
        this.meta = { runId: body.runId, status: 'cancelled', sequence: 0, createdAt: Date.now(), updatedAt: Date.now() };
        this.persistMeta();
        await this.ctx.storage.setAlarm(Date.now() + RETENTION_MS);
        return json(this.snapshot());
      }
      if (!this.meta || this.meta.runId !== body.runId) return json({ error: '这条回答的恢复记录已过期，请重新打开聊天记录。' }, 410);
      if (this.meta.status === 'interrupted' && !this.meta.restartReported) {
        this.meta.restartReported = true;
        await this.append(JSON.stringify({ error: this.meta.error }));
        await this.append('[DONE]');
      }
      if (body.action === 'status') {
        if (this.meta.status === 'interrupted') await this.saveChat();
        return json(this.snapshot());
      }
      if (body.action === 'stop') {
        if (this.meta.status === 'running') { this.meta.status = 'cancelled'; this.abort?.abort(); }
        if (this.pendingRun?.runId === this.meta.runId) {
          const pending = this.pendingRun; this.pendingRun = null;
          // Finalize a queued cancellation without making a provider request.
          this.execution = this.generate(pending.payload);
          this.ctx.waitUntil(this.execution);
        }
        this.persistMeta(); this.listeners.forEach(wake => wake());
        return json(this.snapshot());
      }
      if (body.action === 'events') return new Response(this.stream(Number(body.after) || 0, request.signal), {
        headers: { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'Content-Encoding': 'identity', 'X-Accel-Buffering': 'no' }
      });
      return json({ error: '未知任务操作。' }, 400);
    }

    async alarm() {
      if (this.transport?.active) return this.transport.alarm();
      if (this.debate?.hasJobs) return this.debate.alarm();
      this.pruneHistory();
      if (this.execution) { await this.scheduleCleanup(); return; }
      if (this.pendingRun) {
        const pending = this.pendingRun; this.pendingRun = null;
        if (pending.runId !== this.meta?.runId) return;
        this.execution = this.generate(pending.payload);
        await this.execution;
        return;
      }
      if (this.meta && this.meta.status !== 'running' && Date.now() - (this.meta.updatedAt || this.meta.createdAt || 0) >= RETENTION_MS) {
        this.sql.exec('DELETE FROM run_meta_chunks WHERE run_id = ?',this.meta.runId);
        this.sql.exec('DELETE FROM run_events'); this.sql.exec('DELETE FROM run_meta'); this.meta = null;
      }
      await this.scheduleCleanup();
    }
  };
}
