import { handleBillingLedger } from './billing-ledger.js';
// A generation belongs to its chat, not to a phone's HTTP connection.
// Credentials and provider keys are never written to Durable Object storage.
const encoder = new TextEncoder();
const RUN_LIMIT_MS = 14 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_LOG_BYTES = 8 * 1024 * 1024;
const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const json = (value, status = 200) => Response.json(value, { status, headers: cors });
const terminal = status => status && status !== 'running';

export function createChatRunClass(execute, DebateRun, { deferStart = () => false } = {}) {
  return class ChatRun {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
      this.listeners = new Set();
      this.privateEvents = [];
      this.execution = null;
      this.pendingRun = null;
      this.abort = null;
      this.sql = ctx.storage.sql;
      if (DebateRun) this.debate = new DebateRun(ctx, env);
      this.sql.exec('CREATE TABLE IF NOT EXISTS run_meta (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS run_events (seq INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      const saved = this.sql.exec('SELECT value FROM run_meta WHERE id = 1').toArray()[0];
      this.meta = saved ? JSON.parse(saved.value) : null;
      // A process restart must not silently charge for a second provider request.
      if (this.meta?.status === 'running') {
        for (const event of this.sql.exec('SELECT seq, value FROM run_events WHERE seq > ? ORDER BY seq', this.meta.sequence).toArray()) {
          this.absorb(event.value);
          this.meta.sequence = event.seq;
          this.meta.logBytes = (this.meta.logBytes || 0) + encoder.encode(event.value).length;
        }
        this.meta.status = 'interrupted';
        this.meta.error = '服务器连接已中断，已保留收到的内容。请重新回答以继续。';
        this.persistMeta();
      }
    }

    persistMeta() {
      if (!this.meta || this.meta.incognito) return;
      this.sql.exec('INSERT OR REPLACE INTO run_meta (id, value) VALUES (1, ?)', JSON.stringify(this.meta));
      this.lastMetaSave = Date.now();
    }

    snapshot() {
      if (!this.meta) return null;
      const { runId, status, sequence, createdAt, updatedAt, error, reply } = this.meta;
      return { runId, status, sequence, createdAt, updatedAt, error, reply };
    }

    events(after) {
      if (this.meta?.incognito) return this.privateEvents.filter(item => item.seq > after);
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
      else this.sql.exec('INSERT INTO run_events (seq, value) VALUES (?, ?)', seq, value);
      if (Date.now() - (this.lastMetaSave || 0) >= 500 || value === '[DONE]') this.persistMeta();
      this.listeners.forEach(wake => wake());
    }

    absorb(value) {
      if (value === '[DONE]') return;
      let item;
      try { item = JSON.parse(value); } catch { throw new Error('模型返回的数据格式不完整，已保留收到的内容。'); }
      const reply = this.meta.reply;
      if (item.error) this.meta.error = typeof item.error === 'string' ? item.error : item.error.message;
      if (item.modelName) reply.name = item.modelName;
      if (item.t) reply.text += item.t;
      if (item.r) reply.reasoning = (reply.reasoning || '') + item.r;
      if (item.context) reply.context = item.context;
      if (item.grounding) reply.grounding = item.grounding;
      if (item.usage) reply.usage = item.usage;
      if (item.citation) {
        const index = reply.citations.findIndex(source => source.url === item.citation.url);
        if (index < 0) reply.citations.push(item.citation);
        else if (item.citation.title) reply.citations[index].title = item.citation.title;
        if (item.citationInline !== false) reply.text += ' [[aa-citation:' + (index < 0 ? reply.citations.length : index + 1) + ']] ';
      }
      if (item.activity && reply.activity.length < 80) reply.activity.push(item.activity);
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
        if (terminal(meta.status)) chat.lastReplyAt = reply.completedAt;
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        await put(listKey, JSON.stringify(list));
      }
    }

    async generate(payload) {
      let timer;
      try {
        await this.saveChat(true);
        if (this.meta.status !== 'running') return;
        this.abort = new AbortController();
        timer = setTimeout(() => { this.meta.error = '本次生成超过 14 分钟，已保存收到的内容。'; this.abort.abort(); }, RUN_LIMIT_MS);
        const response = await execute(new Request('https://internal.invalid/', {
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
        clearTimeout(timer);
        this.meta.updatedAt = Date.now();
        this.meta.reply.completedAt = this.meta.updatedAt;
        try {
          if (this.meta.error) await this.append(JSON.stringify({ error: this.meta.error }));
          await this.append('[DONE]');
          this.persistMeta();
          await this.saveChat();
        } catch { this.meta.saveError = true; this.persistMeta(); }
        if (this.meta.alarmRetainUntil && !this.meta.incognito) {
          try { await this.ctx.storage.setAlarm(this.meta.alarmRetainUntil); }
          catch { this.meta.saveError = true; this.persistMeta(); }
        }
        this.listeners.forEach(wake => wake());
        this.execution = null;
      }
    }

    stream(after, signal) {
      const self = this;
      let stopped = false, wake = null;
      return new ReadableStream({
        async start(controller) {
          const onAbort = () => { stopped = true; if (wake) wake(); };
          signal?.addEventListener('abort', onAbort, { once: true });
          try {
            controller.enqueue(encoder.encode(': connected\n\n'));
            while (!stopped) {
              const events = self.events(after);
              for (const item of events) {
                controller.enqueue(encoder.encode('id: ' + item.seq + '\ndata: ' + item.value + '\n\n'));
                after = item.seq;
              }
              if (terminal(self.meta.status) && after >= self.meta.sequence) break;
              if (after < self.meta.sequence) continue;
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
      const body = await request.json();
      if (body.kind === 'debate' && this.debate) return this.debate.fetchBody(body);
      if (body.action === 'start') {
        if (this.meta?.runId === body.runId) {
          if (this.meta.fingerprint && this.meta.fingerprint !== body.fingerprint) return json({ error: '请求编号已存在，请勿修改后重复发送。' }, 409);
          return json(this.snapshot());
        }
        if (this.meta?.status === 'running' || this.execution || this.pendingRun) return json({ error: '这段对话仍有回答正在生成，请先等待或停止。' }, 409);
        if (!body.payload || !body.recovery) return json({ error: '缺少恢复信息。' }, 400);
        this.sql.exec('DELETE FROM run_events'); this.sql.exec('DELETE FROM run_meta'); this.privateEvents = [];
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
          if (!this.meta.incognito) await this.ctx.storage.setAlarm(Date.now() + RETENTION_MS);
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
      if (this.execution) return;
      if (this.pendingRun) {
        const pending = this.pendingRun; this.pendingRun = null;
        if (pending.runId !== this.meta?.runId) return;
        this.execution = this.generate(pending.payload);
        await this.execution;
        return;
      }
      if (this.debate?.hasJobs) return this.debate.alarm();
      if (this.meta?.alarmRetainUntil > Date.now()) {
        await this.ctx.storage.setAlarm(this.meta.alarmRetainUntil);
        return;
      }
      if (this.meta?.status === 'running') { await this.ctx.storage.setAlarm(Date.now() + RETENTION_MS); return; }
      this.sql.exec('DELETE FROM run_events'); this.sql.exec('DELETE FROM run_meta'); this.meta = null;
    }
  };
}
