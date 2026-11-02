import test from 'node:test';
import assert from 'node:assert/strict';
import { skillCatalog } from './skills.js';
import { runOfficialDocuments, verifySkillToken } from './skill-files.js';
import worker from './worker.js';
import { createChatRunClass } from './chat-runs.js';
import { DatabaseSync } from 'node:sqlite';

// All models and responses here are synthetic; no provider request is made.
const env = { ANTHROPIC_API_KEY: 'synthetic-provider-key' };
const args = extra => ({ env, user: 'synthetic-reader', scope: 'project-stream', model: 'claude-sonnet-5-5', effort: 'low', system: 'Synthetic test', selection: { skills: [skillCatalog.find(s => s.id === 'xlsx')], output: 'text' }, messages: [{ role: 'user', content: 'synthetic document analysis' }], send: async () => {}, ...extra });
const start = { type: 'message_start', message: { id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 20, cache_creation_input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 10 }, server_tool_use: { web_search_requests: 0 } } } };
const blockStart = (index, content_block) => ({ type: 'content_block_start', index, content_block });
const delta = (index, value) => ({ type: 'content_block_delta', index, delta: value });
const blockStop = index => ({ type: 'content_block_stop', index });
const result = file => ({ type: 'bash_code_execution_tool_result', tool_use_id: 'tool_synthetic', content: { type: 'bash_code_execution_result', return_code: 0, stdout: '', stderr: '', content: file ? [{ type: 'bash_code_execution_output', file_id: file }] : [] } });
const finish = (stop_reason = 'end_turn') => [{ type: 'message_delta', delta: { stop_reason, stop_sequence: null }, container: { id: 'container_synthetic' }, usage: { output_tokens: 12, server_tool_use: { web_fetch_requests: 1 } } }, { type: 'message_stop' }];
const full = (stop = 'end_turn') => [start, blockStart(0, { type: 'thinking', thinking: '' }), delta(0, { type: 'thinking_delta', thinking: '供应商返回的合成摘要。' }), delta(0, { type: 'signature_delta', signature: 'opaque-signature-never-displayed' }), blockStop(0), blockStart(1, { type: 'server_tool_use', id: 'tool_synthetic', name: 'bash_code_execution', input: {} }), delta(1, { type: 'input_json_delta', partial_json: '{"command":' }), delta(1, { type: 'input_json_delta', partial_json: '"synthetic"}' }), blockStop(1), blockStart(2, result()), blockStop(2), blockStart(3, { type: 'text', text: '' }), delta(3, { type: 'text_delta', text: '合成结果已完成。' }), blockStop(3), ...finish(stop)];
const encoded = values => new TextEncoder().encode(values.map(v => 'event: ' + v.type + '\r\ndata: ' + JSON.stringify(v) + '\r\n\r\n').join(''));
function stream(values, fragment = 11) {
  const bytes = encoded(values); let offset = 0;
  return new Response(new ReadableStream({ pull(controller) { if (offset >= bytes.length) { controller.close(); return; } controller.enqueue(bytes.slice(offset, offset += fragment)); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

test('document dispatch is streaming; fragmented UTF-8, tools, public thinking and cumulative usage reach both clients', async () => {
  const events = [], receipts = []; let payload, calls = 0;
  await runOfficialDocuments(args({ send: async e => events.push(e), recordUsage: async (...r) => receipts.push(r), fetcher: async (url, options) => { calls++; assert.equal(url, 'https://api.anthropic.com/v1/messages'); assert.equal(options.headers.Accept, 'text/event-stream'); payload = JSON.parse(options.body); return stream([start, { type: 'ping' }, { type: 'future_ignored_event' }, ...full().slice(1)]); } }));
  assert.equal(calls, 1); assert.equal(payload.stream, true); assert.equal(payload.output_config.effort, 'low');
  assert.equal(events.filter(e => e.t).map(e => e.t).join(''), '合成结果已完成。');
  assert.equal(events.filter(e => e.r).map(e => e.r).join(''), '供应商返回的合成摘要。');
  assert(!JSON.stringify(events).includes('opaque-signature')); assert(events.some(e => e.activity?.kind === 'skill_tool'));
  assert(events.some(e => e.diagnostics?.lastProviderPingAt)); assert(events.some(e => e.usageCheckpoint?.input === 130));
  assert.equal(receipts.length, 1); assert.equal(receipts[0][1].input_tokens, 100); assert.equal(receipts[0][1].output_tokens, 12);
  assert.deepEqual(receipts[0][1].server_tool_use, { web_search_requests: 0, web_fetch_requests: 1 });
  assert.equal(receipts[0][2].incompleteUsage, false);
});

test('thinking and answer arrive while the final long-running document message is still open', async () => {
  let controller, release, calls = 0; const events = [], firstText = new Promise(resolve => { release = resolve; });
  let settled = false;
  const work = runOfficialDocuments(args({ send: async e => { events.push(e); if (e.t) release(); }, fetcher: async () => { calls++; return new Response(new ReadableStream({ start(c) { controller = c; c.enqueue(encoded(full().slice(0, -2))); } }), { headers: { 'Content-Type': 'text/event-stream' } }); } })).finally(() => { settled = true; });
  await firstText; assert.equal(settled, false); assert(events.some(e => e.r)); assert.equal(calls, 1);
  controller.enqueue(encoded(finish())); controller.close(); await work;
  assert.equal(calls, 1); assert.equal(events.filter(e => e.t).map(e => e.t).join(''), '合成结果已完成。');
});

test('streamed pause_turn preserves signatures, parsed tool input and the same container without replay or duplicate text', async () => {
  const payloads = [], events = [], receipts = [];
  await runOfficialDocuments(args({ send: async e => events.push(e), recordUsage: async (...r) => receipts.push(r), fetcher: async (url, options) => { payloads.push(JSON.parse(options.body)); return stream(full(payloads.length === 1 ? 'pause_turn' : 'end_turn')); } }));
  assert.equal(payloads.length, 2); assert(payloads.every(p => p.stream));
  assert.equal(payloads[1].container.id, 'container_synthetic');
  assert.equal(payloads[1].messages.filter(m => m.role === 'user').length, 1);
  const continued = payloads[1].messages.at(-1).content;
  assert.equal(continued[0].signature, 'opaque-signature-never-displayed'); assert.equal(continued[0].thinking, '供应商返回的合成摘要。');
  assert.deepEqual(continued[1].input, { command: 'synthetic' }); assert.deepEqual(continued[2], result());
  assert.equal(events.filter(e => e.t).map(e => e.t).join(''), '合成结果已完成。合成结果已完成。'); assert.equal(receipts.length, 2);
});

test('a 524 response is explained as an ambiguous upstream timeout and never automatically resubmitted', async () => {
  let calls = 0; const receipts = [];
  await assert.rejects(runOfficialDocuments(args({ recordUsage: async (...r) => receipts.push(r), fetcher: async () => { calls++; return new Response('<html>synthetic origin timeout</html>', { status: 524 }); } })), /上游连接超时.*524.*未自动重试/);
  assert.equal(calls, 1); assert.equal(receipts.length, 1); assert.equal(receipts[0][1], null); assert.equal(receipts[0][2].incompleteUsage, true);
});

for (const broken of ['eof', 'provider-error', 'invalid-json']) test(broken + ' retains partial text, summary and official usage without replay', async () => {
  let calls = 0; const events = [], receipts = [];
  await assert.rejects(runOfficialDocuments(args({ send: async e => events.push(e), recordUsage: async (...r) => receipts.push(r), fetcher: async () => { calls++;
    const partial = full().slice(0, -2);
    if (broken === 'provider-error') partial.push({ type: 'error', error: { type: 'overloaded_error', message: 'synthetic overload sk-secret123' } });
    if (broken === 'invalid-json') { const first = encoded(partial); return new Response(new Blob([first, 'data: not-json\n\n']).stream(), { headers: { 'Content-Type': 'text/event-stream' } }); }
    return stream(partial);
  } })), error => { assert(!error.message.includes('sk-secret123')); return /连接中断|流返回错误/.test(error.message); });
  assert.equal(calls, 1); assert.equal(events.filter(e => e.t).map(e => e.t).join(''), '合成结果已完成。'); assert(events.some(e => e.r));
  assert.equal(receipts.length, 1); assert.equal(receipts[0][1].input_tokens, 100); assert.equal(receipts[0][2].incompleteUsage, true);
});

test('a real generated-file reference survives a later stream failure with account/project-scoped download', async () => {
  let paid = 0, metadata = 0; const events = [];
  await assert.rejects(runOfficialDocuments(args({ send: async e => events.push(e), fetcher: async url => {
    if (url.endsWith('/messages')) { paid++; return stream([start, blockStart(0, result('file_synthetic123')), blockStop(0)]); }
    assert.equal(url, 'https://api.anthropic.com/v1/files/file_synthetic123'); metadata++;
    return Response.json({ filename: 'synthetic.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size_bytes: 1234 });
  } })), /连接中断/);
  assert.equal(paid, 1); assert.equal(metadata, 1);
  const artifact = events.find(e => e.artifacts)?.artifacts[0]; assert(artifact); assert.equal(artifact.provider, 'anthropic');
  const token = await verifySkillToken(env, artifact.token, { user: 'synthetic-reader', scope: 'project-stream', type: 'output' }); assert.equal(token.fileId, 'file_synthetic123');
  await assert.rejects(verifySkillToken(env, artifact.token, { user: 'another', scope: 'project-stream', type: 'output' }));
});

test('explicit Stop cancels the active stream and records only received counters once', async () => {
  const abort = new AbortController(), receipts = []; let calls = 0, cancelled = 0;
  await assert.rejects(runOfficialDocuments(args({ signal: abort.signal, send: async e => { if (e.r) abort.abort(new DOMException('Synthetic Stop', 'AbortError')); }, recordUsage: async (...r) => receipts.push(r), fetcher: async () => { calls++; return new Response(new ReadableStream({ start(c) { c.enqueue(encoded(full().slice(0, 4))); }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } }); } })), { name: 'AbortError' });
  assert.equal(calls, 1); assert.equal(cancelled, 1); assert.equal(receipts.length, 1); assert.equal(receipts[0][2].incompleteUsage, true);
});

test('a sandbox file link split across deltas is not displayed as a temporary fake download', async () => {
  const events = [];
  const values = [start, blockStart(0, result()), blockStop(0), blockStart(1, { type: 'text', text: '' }), ...['已生成 ', '[报', '告](sand', 'box:/mnt/data/result.xlsx)', '。'].map(text => delta(1, { type: 'text_delta', text })), blockStop(1), ...finish()];
  await runOfficialDocuments(args({ send: async e => events.push(e), fetcher: async () => stream(values) }));
  assert.equal(events.filter(e => e.t).map(e => e.t).join(''), '已生成 报告（见下方文件）。'); assert(!JSON.stringify(events).includes('sandbox:'));
});

for (const native of [false, true]) for (const interrupted of [false, true]) test((native ? 'Android API' : 'web API') + ' persists and replays document stream ' + (interrupted ? 'failure' : 'completion') + ' without another dispatch', async t => {
  const hash = 'c'.repeat(64), token = 'b'.repeat(64), pending = [], databases = [], actors = new Map();
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  const data = new Map([['user:synthetic-reader', JSON.stringify({ hash })], ['native-session:' + digest, JSON.stringify({ accountId: 'synthetic-reader' })]]);
  const kv = { get: async k => data.get(k) || null, put: async (k, v) => data.set(k, v), delete: async k => data.delete(k), list: async ({ prefix }) => ({ keys: [...data.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) };
  const environment = { ...env, MEMORY_KV: kv, BIZ_KV: kv };
  const Actor = createChatRunClass((request, env) => worker.fetch(request, env));
  environment.CHAT_RUNS = { idFromName: n => n, get: n => ({ fetch: request => {
    if (!actors.has(n)) {
      const db = new DatabaseSync(':memory:'); databases.push(db);
      const storage = { transactionSync(fn) { db.exec('BEGIN'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; } }, sql: { exec(query, ...args) { const s = db.prepare(query); const rows = s.columns().length ? s.all(...args) : (s.run(...args), []); return { toArray: () => rows }; } }, setAlarm: async () => {} };
      actors.set(n, new Actor({ storage, waitUntil: p => pending.push(p) }, environment));
    }
    return actors.get(n).fetch(request);
  } }) };
  const call = body => worker.fetch(new Request('https://api.pickandcase.com' + (native ? '/native/api' : '/chat-runs'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(native ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(native ? { path: '/chat-runs', payload: body } : { username: 'synthetic-reader', password: hash, ...body }) }), environment);
  let dispatches = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => { assert.equal(url, 'https://api.anthropic.com/v1/messages'); assert.equal(JSON.parse(options.body).stream, true); dispatches++; return stream(interrupted ? full().slice(0, -2) : full()); });
  const ids = { runId: 'run-document-stream', chatId: 'chat-document-stream' };
  const payload = { model: 'claude-sonnet-5-5', effort: 'low', chat: { chatId: ids.chatId, scope: 'general', question: '分析 synthetic document', history: [], skills: { mode: 'manual', ids: ['analyze'] } }, recovery: { userMessage: { uid: 1, text: 'synthetic document analysis', isUser: true }, replyUid: 2 } };
  try {
    assert.equal((await call({ action: 'start', ...ids, payload })).status, 202);
    await Promise.all(pending);
    const snapshot = await (await call({ action: 'status', ...ids })).json();
    assert.equal(snapshot.status, interrupted ? 'failed' : 'completed', snapshot.error);
    assert.equal(snapshot.reply.text, '合成结果已完成。'); assert.equal(snapshot.reply.reasoning, '供应商返回的合成摘要。');
    assert.equal(snapshot.reply.executionModel, 'claude-sonnet-5-5'); assert.equal(snapshot.reply.usage.schemaVersion, 2);
    assert.equal(snapshot.reply.usage.usageComplete, !interrupted);
    const replay = await (await call({ action: 'events', ...ids, after: 0 })).text();
    assert(replay.includes('供应商返回的合成摘要')); assert(replay.includes('合成结果已完成')); assert(replay.includes('[DONE]'));
    assert(!replay.includes('opaque-signature'));
    const saved = JSON.parse(data.get('chats:synthetic-reader:' + ids.chatId)); assert.equal(saved.find(m => m.uid === 2).reasoning, snapshot.reply.reasoning);
    await call({ action: 'start', ...ids, payload }); assert.equal(dispatches, 1);
  } finally { databases.forEach(db => db.close()); }
});
