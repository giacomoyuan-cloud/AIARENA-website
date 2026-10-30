// Scheduled executions use the same durable, per-run event journal as chat.
// The scheduler alarm only enqueues or inspects a run; it never waits for a model.
export function createScheduledChatClient({ credentials, models }) {
  function actor(env, task, run) {
    if (!env.CHAT_RUNS) throw Object.assign(Error('后台执行服务尚未部署'), { status: 503 });
    const scope = Object.prototype.hasOwnProperty.call(run, 'projectId') ? run.projectId : task.projectId;
    return env.CHAT_RUNS.get(env.CHAT_RUNS.idFromName(task.user + ':' + (scope || 'general') + ':' + run.chatId), { locationHint: 'enam' });
  }
  async function request(env, task, run, body) {
    return actor(env, task, run).fetch(new Request('https://scheduled-chat.internal/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, runId: run.runId }),
      ...(body.action !== 'events' ? { signal: AbortSignal.timeout(25000) } : {})
    }));
  }
  async function result(response) {
    const data = await response.json();
    if (!response.ok) throw Object.assign(Error(data.error || '后台状态暂不可用'), { status: response.status });
    return data;
  }
  return {
    async start(env, task, run) {
      const auth = await credentials(env, task.user), model = models[task.model];
      if (!model) throw Error('任务模型已不可用');
      const payload = { ...auth, model: task.model, ...(task.effort !== undefined ? { effort: task.effort } : {}),
        projectId: task.projectId, search: task.search, noAutomaticRetry: true,
        chat: { scope: task.projectId || 'general', chatId: run.chatId, question: task.prompt, query: task.prompt, history: [], historyEndUid: null, systemMode: 'default' } };
      return result(await request(env, task, run, { action: 'start', directStart: true, fingerprint: run.runId, payload,
        recovery: { user: task.user, projectId: task.projectId, chatId: run.chatId, scheduleId: task.id, title: task.name,
          historyEndUid: null, userMessage: { uid: 1, isUser: true, brand: 'user', name: '定时任务', text: task.prompt, createdAt: run.at },
          reply: { uid: 2, name: model.name, submodel: task.model, brand: model.provider, effort: task.effort, text: '', reasoning: '', citations: [], activity: [] } } }));
    },
    async status(env, task, run) { return result(await request(env, task, run, { action: 'status' })); },
    async stop(env, task, run) { return result(await request(env, task, run, { action: 'stop' })); },
    async events(env, task, run, after = 0) { return request(env, task, run, { action: 'events', after }); }
  };
}
