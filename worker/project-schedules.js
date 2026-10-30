// One durable scheduler per account. No credentials are persisted in task records.
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{6,80}$/.test(value);
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

// Alarm invocations only dispatch and poll. Generation runs in a separate HTTP
// ChatRun object, whose journal survives scheduler restarts and manual retries.
export function createProjectScheduler({ runs, project, models, efforts = {} }) {
  const active = task => task.status === 'running';
  const recordKey = (id, runId) => 'run:' + id + ':' + runId;
  const indexKey = (id, entry) => 'attempt:' + id + ':' + String(entry.at).padStart(16, '0') + ':' + entry.runId;
  return class ProjectScheduler {
    constructor(ctx, env) {
      this.ctx = ctx; this.env = env; this.running = false;
      this.ready = ctx.blockConcurrencyWhile(async () => {
        this.tasks = await ctx.storage.get('tasks') || [];
        let changed = false;
        for (const task of this.tasks) {
          task.history ||= [];
          // New executions can be inspected after restart without resubmitting.
          // Legacy in-process jobs have no recoverable executor to reconnect to.
          if (active(task) && !task.activeRun) {
            task.status = 'failed'; task.error = '执行中断，未自动重复调用模型'; changed = true;
            task.history.unshift({ at: task.lastRunAt, status: 'failed', error: task.error, chatId: task.chatId });
          }
        }
        if (changed) await this.persist();
      });
    }
    async persist() { await this.ctx.storage.put('tasks', this.tasks); }
    async arm() {
      const times = this.tasks.filter(t => t.enabled && !active(t) && t.nextRunAt).map(t => t.nextRunAt);
      // While an account has an active execution, inspect it without repeatedly
      // firing overdue tasks or restarting the model on a transient failure.
      const next = this.tasks.some(active) ? Date.now() + 30000 : times.length ? Math.min(...times) : null;
      if (next !== null) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next));
      else await this.ctx.storage.deleteAlarm();
    }
    async persistAttempt(task, entry) {
      const writes = {};
      // Preserve the old compact history before making room in the UI cache.
      if (!task.historyVersion) {
        task.history = task.history.map((old, i) => ({ ...old, runId: old.runId || 'legacy-' + (old.chatId || task.id + '-' + i), legacy: !old.runId || !!old.legacy }));
        for (const old of task.history) {
          writes[recordKey(task.id, old.runId)] = old;
          writes[indexKey(task.id, old)] = old;
        }
        task.historyVersion = 2;
      }
      const { runId, chatId, at, completedAt, status, projectId, legacy } = entry;
      const cached = { runId, chatId, at, completedAt, status, projectId, legacy, ...(entry.error ? { error: String(entry.error).slice(0, 300) } : {}) };
      task.history = [cached, ...task.history.filter(old => old.runId !== entry.runId)].slice(0, 20);
      writes.tasks = this.tasks;
      writes[recordKey(task.id, entry.runId)] = entry;
      writes[indexKey(task.id, entry)] = entry;
      // Multi-key put is atomic. No provider starts until this succeeds.
      await this.ctx.storage.put(writes);
    }
    async history(task, after) {
      const prefix = 'attempt:' + task.id + ':';
      if (after !== undefined && (typeof after !== 'string' || !after.startsWith(prefix) || after.length > 300)) return json({ error: '记录分页无效' }, 400);
      const rows = await this.ctx.storage.list({ prefix, reverse: true, limit: 21, ...(after ? { end: after } : {}) });
      if (!rows.size && !after && !task.historyVersion) return json({ runs: task.history, next: null });
      const entries = [...rows.entries()];
      return json({ runs: entries.slice(0, 20).map(([, value]) => value), next: entries.length > 20 ? entries[19][0] : null });
    }
    async fetch(request) {
      await this.ready;
      try {
        const body = await request.json(), action = body.action || 'list';
        if (action === 'list') return json({ tasks: this.tasks.filter(t => body.projectId === undefined || t.projectId === body.projectId) });
        if (action === 'create' || action === 'update') {
          if (!idOK(body.id)) return json({ error: '任务编号无效' }, 400);
          const prior = this.tasks.find(t => t.id === body.id);
          if (action === 'create' && prior) return json({ task: prior });
          if (prior && (active(prior) || prior.queued)) return json({ error: '任务执行中，完成后可修改' }, 409);
          if (action === 'update' && !prior) return json({ error: '任务不存在' }, 404);
          if (!prior && this.tasks.length >= 30) return json({ error: '最多保存 30 个定时任务' }, 400);
          const name = String(body.name || '').trim(), prompt = String(body.prompt || '').trim();
          if (!name || name.length > 80 || !prompt || prompt.length > 8000) return json({ error: '名称最多 80 字，任务指令需为 1–8000 字' }, 400);
          if (!models.includes(body.model)) return json({ error: '请选择可用的文字模型' }, 400);
          const effort = typeof body.effort === 'string' && body.effort ? body.effort : body.effort === undefined && prior?.model === body.model ? prior?.effort : undefined;
          if (effort !== undefined && !(efforts[body.model] || []).includes(effort)) return json({ error: '请选择此模型支持的思考深度' }, 400);
          const projectId = body.projectId || null;
          if (projectId) await project(this.env, body.user, projectId);
          const schedule = validateSchedule(body.schedule), nextRunAt = nextOccurrence(schedule);
          if (!nextRunAt) return json({ error: '执行时间必须在将来' }, 400);
          const task = { ...prior, id: body.id, user: body.user, projectId, name, prompt, model: body.model, effort, search: body.search === true,
            schedule, enabled: body.enabled !== false, nextRunAt, status: prior?.status || 'scheduled', createdAt: prior?.createdAt || Date.now(), updatedAt: Date.now(), history: prior?.history || [] };
          this.tasks = this.tasks.filter(t => t.id !== task.id); this.tasks.unshift(task);
          await this.persist(); await this.arm(); return json({ task });
        }
        const task = this.tasks.find(t => t.id === body.id && t.user === body.user);
        if (!task) return json({ error: '任务不存在' }, 404);
        if (task.projectId && action !== 'delete' && !(action === 'toggle' && body.enabled === false)) await project(this.env, body.user, task.projectId);
        if (action === 'history') return this.history(task, body.after);
        if (action === 'events') {
          if (typeof body.runId !== 'string' || !/^[a-zA-Z0-9_-]{6,160}$/.test(body.runId)) return json({ error: '记录编号无效' }, 400);
          const run = await this.ctx.storage.get(recordKey(task.id, body.runId));
          if (!run || run.legacy) return json({ error: '没有可回放的原始事件，请打开对应对话查看已保存的结果' }, 410);
          if (run.projectId) await project(this.env, body.user, run.projectId);
          return runs.events(this.env, task, run, Number(body.after) || 0);
        }
        if (action === 'run' && body.operationId !== undefined) {
          if (!idOK(body.operationId)) return json({ error: '操作编号无效' }, 400);
          if (await this.ctx.storage.get('operation:' + task.id + ':' + body.operationId)) return json({ ok: true, task });
        }
        if (action === 'stop') {
          if (active(task)) await runs.stop(this.env, task, task.activeRun);
          await this.arm(); return json({ ok: true, task });
        }
        if (active(task) || task.queued) return json({ error: '任务执行中，完成后可操作' }, 409);
        if (action === 'toggle') {
          if (typeof body.enabled !== 'boolean') return json({ error: '任务状态无效' }, 400);
          if (body.enabled) { const next = nextOccurrence(task.schedule); if (!next) return json({ error: '原定时间已过，请先修改执行时间' }, 400); task.nextRunAt = next; }
          task.enabled = body.enabled;
        } else if (action === 'delete') this.tasks = this.tasks.filter(t => t.id !== task.id);
        else if (action === 'run') {
          if (this.running || this.tasks.some(active)) return json({ error: '已有任务执行中，请稍后再试' }, 409);
          task.lastOperationId = body.operationId; task.nextRunAt = Date.now(); task.enabled = true; task.queued = true;
        } else return json({ error: '未知任务操作' }, 400);
        task.updatedAt = Date.now();
        if (action === 'run' && body.operationId) await this.ctx.storage.put({ tasks: this.tasks, ['operation:' + task.id + ':' + body.operationId]: { at: task.updatedAt } });
        else await this.persist();
        await this.arm(); return json({ ok: true, task });
      } catch (error) { return json({ error: error.status ? error.message : error instanceof SyntaxError ? '任务请求无效' : error.message || '任务操作失败' }, error.status || 400); }
    }
    async inspect(task) {
      const run = task.activeRun;
      let state;
      try {
        state = await runs.status(this.env, task, run);
      } catch (error) {
        if (error.status !== 410 && error.status !== 404) return;
        state = { status: 'failed', error: task.error || '后台执行记录已不可用，未自动重发模型请求', updatedAt: Date.now() };
      }
      if (state.status === 'running') return;
      const before = structuredClone(task);
      try {
        task.status = state.status === 'completed' ? 'completed' : state.status === 'cancelled' ? 'cancelled' : 'failed';
        task.error = state.error ? String(state.error).slice(0, 300) : null;
        const entry = { ...run, status: task.status, completedAt: state.updatedAt || Date.now(),
          ...(state.error ? { error: state.error } : {}), diagnostics: state.reply?.diagnostics, usage: state.reply?.usage };
        delete task.activeRun;
        await this.persistAttempt(task, entry);
      } catch (error) {
        Object.keys(task).forEach(key => delete task[key]); Object.assign(task, before);
        throw error;
      }
    }
    async alarm() {
      await this.ready;
      if (this.running) return;
      this.running = true;
      try {
        for (const task of this.tasks.filter(active)) await this.inspect(task);
        if (this.tasks.some(active)) return;
        const task = this.tasks.find(t => t.enabled && t.nextRunAt && t.nextRunAt <= Date.now());
        if (!task) return;
        const before = structuredClone(task), at = Date.now(), runId = 'schedule-' + crypto.randomUUID(), chatId = 'scheduled-' + crypto.randomUUID();
        const run = { runId, chatId, at, status: 'running', model: task.model, effort: task.effort, name: task.name, prompt: task.prompt, projectId: task.projectId, search: task.search };
        task.lastRunAt = at; task.nextRunAt = nextOccurrence(task.schedule, at); task.enabled = !!task.nextRunAt;
        task.status = 'running'; task.error = null; task.queued = false; task.chatId = chatId; task.activeRun = run;
        try { await this.persistAttempt(task, run); }
        catch (error) { Object.keys(task).forEach(key => delete task[key]); Object.assign(task, before); throw error; }
        try {
          if (task.projectId) await project(this.env, task.user, task.projectId);
          await runs.start(this.env, task, run);
        } catch (error) {
          // An unknown acknowledgement may mean the provider is already running.
          // Inspect the existing run on the next alarm; do not enqueue a second one.
          task.error = String(error.message || '启动回执暂不可用').slice(0, 300);
          if (error.status === 404 || error.status === 401) {
            task.status = 'failed'; task.enabled = false; task.nextRunAt = null;
            await this.persistAttempt(task, { ...run, status: 'failed', completedAt: Date.now(), error: task.error }); delete task.activeRun;
          }
          await this.persist();
        }
      } finally { this.running = false; await this.arm(); }
    }
  };
}
