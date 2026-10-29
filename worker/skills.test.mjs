import Billing from '../arena-billing.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import worker from './worker.js';
import { selectSkills, skillCatalog } from './skills.js';
import { runOfficialDocuments, signSkillToken, verifySkillToken, serveSkillFile } from './skill-files.js';
import { createChatRunClass } from './chat-runs.js';

// Synthetic provider responses exercise routing and transport, not model quality or file layout.
const providerEnv = { ANTHROPIC_API_KEY: 'synthetic-provider-key' };
const accountHash = 'synthetic-account-hash';
const skill = id => skillCatalog.find(item => item.id === id);
const selection = ids => ({ mode: 'auto', ids, skills: ids.map(skill), output: 'text' });
const fakeRouter = value => async () => Response.json({ content: [{ type: 'tool_use', id: 'selection_test', name: 'select_skills', input: value }], usage: { input_tokens: 3, output_tokens: 2 } });
function executionResult({ code = 0, fileId, stop = 'end_turn' } = {}) {
  return {
    container: { id: 'container_test_123' }, stop_reason: stop,
    content: [
      { type: 'server_tool_use', id: 'call1', name: 'bash_code_execution', input: { command: 'synthetic' } },
      { type: 'bash_code_execution_tool_result', tool_use_id: 'call1', content: {
        type: 'bash_code_execution_result', return_code: code, stdout: '', stderr: code ? 'failed' : '',
        content: fileId ? [{ type: 'bash_code_execution_output', file_id: fileId }] : []
      } },
      { type: 'text', text: '计算或文件处理已完成。' }
    ], usage: { input_tokens: 20, output_tokens: 10 }
  };
}
const documentArgs = fields => ({ env: providerEnv, user: 'tester', scope: 'general', selection: selection(['analyze']), system: 'Synthetic test', messages: [{ role: 'user', content: '计算实际数据并核验' }], send: async () => {}, ...fields });

for(const model of ['claude-fable-5-1','claude-opus-5-5','claude-sonnet-5-5'])test('native Skills use selected '+model+' and effort in payload, display and billing',async()=>{
  let payload;const events=[],usage=[];
  await runOfficialDocuments(documentArgs({model,effort:'xhigh',env:{...providerEnv,SKILLS_DOCUMENT_MODEL:'claude-sonnet-5-5'},send:async item=>events.push(item),recordUsage:async(...args)=>usage.push(args),fetcher:async(url,options)=>{payload=JSON.parse(options.body);return Response.json(executionResult());}}));
  assert.equal(payload.model,model);assert.equal(payload.output_config.effort,'xhigh');assert.equal(payload.thinking.type,'adaptive');
  assert.equal(events.find(item=>item.modelName).executionModel,model);assert(events.find(item=>item.modelName).modelName.includes(model.includes('fable')?'Fable':model.includes('opus')?'Opus':'Sonnet'));
  assert.equal(usage[0][0],model);assert.equal(payload.service_tier,'standard_only');assert.deepEqual(usage[0][1],{input_tokens:20,output_tokens:10});
  const receipt=Billing.receipt(usage[0][0],usage[0][1],usage[0][2]);
  assert.equal(receipt.knownCostUsd,{'claude-fable-5-1':'0.0007','claude-opus-5-5':'0.00028','claude-sonnet-5-5':'0.00014'}[model]);
  assert.equal(events.filter(item=>item.usage).length,0);
});
test('automatic document routing from another provider chooses only a compatible Claude default',async()=>{
  let payload;
  await runOfficialDocuments(documentArgs({model:'grok-4.7',env:{...providerEnv,SKILLS_DOCUMENT_MODEL:'gpt-6-astra'},fetcher:async(url,options)=>{payload=JSON.parse(options.body);return Response.json(executionResult());}}));
  assert.equal(payload.model,'claude-sonnet-5-5');
});
function accountFixture() {
  const data = new Map([['user:tester', JSON.stringify({ hash: accountHash })], ['user:another', JSON.stringify({ hash: accountHash })]]), writes = [];
  const kv = {
    get: async key => data.get(key) || null,
    put: async (key, value) => { writes.push(key); data.set(key, value); },
    delete: async key => data.delete(key),
    list: async ({ prefix }) => ({ keys: [...data.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })) })
  };
  return { data, writes, env: { MEMORY_KV: kv, BIZ_KV: kv, PASSWORD: 'synthetic-shared', ANTHROPIC_API_KEY: 'synthetic-provider-key', OPENAI_API_KEY: 'synthetic-openai-key', GROK_API_KEY: 'synthetic-xai-key', GEMINI_API_KEY: 'synthetic-google-key' } };
}
const accountRequest = (path, fields) => new Request('https://api.pickandcase.com' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester', password: accountHash, ...fields }) });

for(const id of ['pptx','xlsx','docx','pdf'])test(id+' rejects every non-Claude model before direct or recoverable execution',async t=>{
  const fixture=accountFixture();let network=0,actors=0;
  t.mock.method(globalThis,'fetch',async()=>{network++;throw Error('Must not contact provider');});
  fixture.env.CHAT_RUNS={idFromName(){actors++;throw Error('Must not create a run');}};
  for(const model of ['grok-4.7','gemini-4-argon','gpt-6-astra','gpt-6.1-sol']){
    const chat={chatId:'chat-model-guard',scope:'general',question:'分析文档',history:[],skills:{mode:'manual',ids:[id]}};
    const payload={model,projectId:null,chat};
    for(const [path,fields] of [['/',payload],['/chat-runs',{action:'start',runId:'run-model-guard',chatId:chat.chatId,payload}]]){
      const response=await worker.fetch(accountRequest(path,fields),fixture.env);
      assert.equal(response.status,400,model+' '+path);assert.match((await response.json()).error,/仅支持 Claude/);
    }
  }
  assert.equal(network,0);assert.equal(actors,0);
});
test('the Worker passes the selected Opus and effort through a manual PDF task',async t=>{
  const fixture=accountFixture();let payload;
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(new URL(url).hostname,'api.anthropic.com');payload=JSON.parse(options.body);return Response.json(executionResult());});
  const response=await worker.fetch(accountRequest('/',{model:'claude-opus-5-5',effort:'max',chat:{scope:'general',chatId:'chat-opus-doc',question:'分析这份文档',history:[],skills:{mode:'manual',ids:['pdf']}}}),fixture.env);
  assert.equal(response.status,200);const stream=await response.text();assert(!stream.includes('"error":'),stream);
  assert.equal(payload.model,'claude-opus-5-5');assert.equal(payload.output_config.effort,'max');assert.equal(payload.container.skills[0].skill_id,'pdf');
  assert.match(stream,/"executionModel":"claude-opus-5-5"/);assert.match(stream,/Claude Opus 5.5/);assert.match(stream,/"model":"claude-opus-5-5"/);
});
test('automatic routing from Grok to a document reports the real Claude model',async t=>{
  const fixture=accountFixture(),payloads=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(new URL(url).hostname,'api.anthropic.com');const payload=JSON.parse(options.body);payloads.push(payload);return payload.tools.some(tool=>tool.name==='select_skills')?fakeRouter({ids:['pdf'],output:'text'})():Response.json(executionResult());});
  const response=await worker.fetch(accountRequest('/',{model:'grok-4.7',effort:'high',chat:{scope:'general',chatId:'chat-auto-doc',question:'请读取并分析这份PDF文件',history:[],skills:{mode:'auto',ids:[]}}}),fixture.env);
  assert.equal(response.status,200);const stream=await response.text();assert(!stream.includes('"error":'),stream);
  assert.equal(payloads.length,2);assert.equal(payloads[1].model,'claude-sonnet-5-5');assert.match(stream,/"executionModel":"claude-sonnet-5-5"/);
});
function actorStorage() {
  const db = new DatabaseSync(':memory:');
  return { db, transactionSync(callback) {
    db.exec('BEGIN');
    try { const value = callback(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }, sql: { exec(query, ...values) { const statement = db.prepare(query); const rows = statement.columns().length ? statement.all(...values) : (statement.run(...values), []); return { toArray: () => rows }; } }, setAlarm: async () => {} };
}

test('disabled skills and greetings do not make a classifier request', async () => {
  const fetcher = () => { throw Error('Unexpected paid request'); };
  assert.deepEqual((await selectSkills({ settings: { mode: 'off' }, question: '制作销售表', env: providerEnv, fetcher })).ids, []);
  assert.deepEqual((await selectSkills({ settings: { mode: 'auto' }, question: '你好', env: providerEnv, fetcher })).ids, []);
});

test('an already-cancelled task never starts a classifier request', async () => {
  let calls = 0;
  await assert.rejects(() => selectSkills({ settings: { mode: 'auto' }, question: '请润色这段文字', env: providerEnv, signal: AbortSignal.abort(), fetcher: async () => { calls++; return Response.json({ content: [{ type: 'text', text: '{"ids":[]}' }] }); } }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('routing keeps valid skills and discards names invented by the model', async () => {
  const result = await selectSkills({ settings: { mode: 'auto' }, question: '帮我润色此段文字', env: providerEnv, fetcher: fakeRouter({ ids: ['humanizer', 'shell-access', 'unknown'], output: 'text' }) });
  assert.deepEqual(result.ids, ['humanizer']);
});

test('automatic routing forces a single structured selection from the available directory', async () => {
  let payload;
  const result = await selectSkills({ settings: { mode: 'auto' }, question: '生成两页PPT', search: false, env: providerEnv, fetcher: async (url, options) => {
    payload = JSON.parse(options.body);
    return fakeRouter({ ids: ['pptx'], output: 'file' })();
  } });
  assert.deepEqual(payload.tool_choice, { type: 'tool', name: 'select_skills', disable_parallel_tool_use: true });
  assert.deepEqual(payload.tools[0].input_schema.required, ['ids', 'output']);
  assert(!payload.tools[0].input_schema.properties.ids.items.enum.includes('deep-research'));
  assert.deepEqual(result.ids, ['pptx']);
  assert.equal(result.output, 'file');
});

test('prose returned instead of a routing tool call is rejected without parsing model text', async () => {
  await assert.rejects(() => selectSkills({ settings: { mode: 'auto' }, question: '生成PPT', env: providerEnv, fetcher: async () => Response.json({ content: [{ type: 'text', text: '我来为你生成这份验收材料。' }] }) }), /未返回有效的结构化结果/);
});

test('manual editing of a long original document retains its native file reader', async () => {
  const result = await selectSkills({ settings: { mode: 'manual', ids: ['humanizer'] }, question: '润色完整的这份长文档', files: [{ name: 'long.docx', size: 90000 }], env: providerEnv, fetcher: () => { throw Error('Manual mode should not classify'); } });
  assert(result.ids.includes('humanizer'));
  assert(result.skills.some(item => item.official === 'docx'));
});

test('manual research requires web access and document tasks are unavailable in debate', async () => {
  await assert.rejects(() => selectSkills({ settings: { mode: 'manual', ids: ['deep-research'] }, question: '查询最新价格', search: false, env: providerEnv }));
  await assert.rejects(() => selectSkills({ settings: { mode: 'manual', ids: ['pptx'] }, question: '制作PPT', debate: true, env: providerEnv }));
});

for (const code of [1, 2, 127]) test('nonzero execution exit ' + code + ' cannot be called verified computation', async () => {
  await assert.rejects(() => runOfficialDocuments(documentArgs({ fetcher: async () => Response.json(executionResult({ code })) })), /未实际执行|未核验/);
});

test('research-to-PPT enables web tools only when search is enabled', async () => {
  for (const search of [false, true]) {
    let payload;
    await runOfficialDocuments(documentArgs({ selection: selection(['deep-research', 'pptx']), search, messages: [{ role: 'user', content: '查询今年市场趋势并做PPT' }], fetcher: async (url, options) => { payload = JSON.parse(options.body); return Response.json(executionResult()); } }));
    assert.equal(payload.tools.some(item => item.name === 'web_search'), search);
    assert.equal(payload.tools.some(item => item.name === 'web_fetch'), search);
  }
});

test('file tokens reject another account, another scope, tampering and expiration before network access', async () => {
  const value = { type: 'output', user: 'tester', scope: 'project-a', exp: Date.now() + 10000, fileId: 'file_output123', name: 'a.pdf' };
  const token = await signSkillToken(providerEnv, value);
  assert.deepEqual(await verifySkillToken(providerEnv, token, { user: 'tester', scope: 'project-a', type: 'output' }), value);
  for (const fields of [{ user: 'another', scope: 'project-a' }, { user: 'tester', scope: 'project-b' }]) await assert.rejects(() => verifySkillToken(providerEnv, token, { ...fields, type: 'output' }));
  await assert.rejects(() => verifySkillToken(providerEnv, token + 'x', { user: 'tester', scope: 'project-a', type: 'output' }));
  const expired = await signSkillToken(providerEnv, { ...value, exp: Date.now() - 1 });
  await assert.rejects(() => serveSkillFile({ env: providerEnv, body: { action: 'download', token: expired }, user: 'tester', scope: 'project-a', fetcher: () => { throw Error('Must reject before request'); } }));
});

test('a prose-only response cannot stand in for a requested downloadable file', async () => {
  const request = selection(['pptx']); request.output = 'file';
  await assert.rejects(() => runOfficialDocuments(documentArgs({ selection: request, fetcher: async () => Response.json(executionResult()) })), /没有返回可下载文件/);
});

for (const format of ['pptx', 'xlsx', 'docx', 'pdf']) test('official ' + format + ' requests the hosted skill and returns a signed real artifact handle', async () => {
  let payload; const events = [];
  const request = selection([format]); request.output = 'file';
  await runOfficialDocuments(documentArgs({ selection: request, send: async event => events.push(event), fetcher: async (url, options) => {
    if (url.endsWith('/messages')) { payload = JSON.parse(options.body); return Response.json(executionResult({ fileId: 'file_output123' })); }
    assert.match(url, /\/files\/file_output123$/);
    return Response.json({ filename: 'test.' + format, mime_type: 'application/octet-stream', downloadable: true, size_bytes: 200 });
  } }));
  assert(payload.container.skills.some(item => item.type === 'anthropic' && item.skill_id === format));
  const artifact = events.find(event => event.artifacts)?.artifacts[0];
  assert.equal(artifact.name, 'test.' + format);
  const value = await verifySkillToken(providerEnv, artifact.token, { user: 'tester', scope: 'general', type: 'output' });
  assert.equal(value.fileId, 'file_output123');
});

test('the authenticated Worker passes an entire long original to the file executor in manual editing mode', async t => {
  const fixture = accountFixture(), original = '原始完整文本。'.repeat(1000) + 'FULL_SOURCE_CANARY_AFTER_PREVIEW';
  let uploaded = '', payload;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).hostname, 'api.anthropic.com');
    if (url.endsWith('/files') && options.method === 'POST') { uploaded = await options.body.get('file').text(); return Response.json({ id: 'file_input123' }); }
    if (url.endsWith('/messages')) { payload = JSON.parse(options.body); return Response.json(executionResult()); }
    if (url.endsWith('/files/file_input123') && options.method === 'DELETE') return Response.json({ deleted: true });
    throw Error('Unexpected provider request: ' + url);
  });
  const response = await worker.fetch(accountRequest('/', { model: 'claude-sonnet-5-5', projectId: null, chat: { scope: 'general', chatId: 'chat-original-123', question: '[文件: long.txt]\n' + original.slice(0, 4000) + '\n[附件预览；全文由文档工具读取]', query: '润色完整文本', history: [], skills: { mode: 'manual', ids: ['humanizer'] }, files: [{ name: 'long.txt', mime: 'text/plain', data: Buffer.from(original).toString('base64') }] } }), fixture.env);
  assert.equal(response.status, 200); const stream = await response.text();
  assert(!stream.includes('"error":'), stream);
  assert.equal(uploaded, original);
  assert(payload.container.skills.some(item => item.skill_id === 'docx'));
  assert(payload.messages.at(-1).content.some(item => item.type === 'container_upload' && item.file_id === 'file_input123'));
});

test('download proxies original bytes with attachment and no-store headers', async () => {
  const token = await signSkillToken(providerEnv, { type: 'output', user: 'tester', scope: 'general', exp: Date.now() + 10000, fileId: 'file_output123', name: '演示.pdf', mime: 'application/pdf' });
  let requested = '';
  const response = await serveSkillFile({ env: providerEnv, user: 'tester', scope: 'general', body: { action: 'download', token }, fetcher: async url => { requested = url; return new Response('synthetic-document-bytes'); } });
  assert.equal(await response.text(), 'synthetic-document-bytes');
  assert.match(requested, /\/file_output123\/content$/);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('pause_turn continues the same container without replaying the initial user request', async () => {
  const payloads = [], events = [];
  await runOfficialDocuments(documentArgs({ selection: selection(['xlsx']), send: async event => events.push(event), fetcher: async (url, options) => { payloads.push(JSON.parse(options.body)); return Response.json(executionResult({ stop: payloads.length === 1 ? 'pause_turn' : 'end_turn' })); } }));
  assert.equal(payloads.length, 2);
  assert.equal(payloads[1].container.id, 'container_test_123');
  assert.equal(payloads[1].messages.filter(message => message.role === 'user').length, 1);
  assert(events.some(event => event.skillSession));
});

test('same-name original attachments stay isolated across project draft switches', async () => {
  let scope = 'project-a'; const elements = new Map(), storage = new Map();
  const node = id => { if (!elements.has(id)) elements.set(id, { addEventListener() {}, classList: { toggle() {} }, hidden: false, textContent: '' }); return elements.get(id); };
  const window = { ArenaSkillCatalog: skillCatalog };
  const context = vm.createContext({ window, document: { getElementById: node }, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, btoa, Uint8Array, TextEncoder, Promise });
  vm.runInContext(await readFile(new URL('../arena-skills.js', import.meta.url), 'utf8'), context);
  const runtime = window.ArenaSkills.install({ auth: () => ({ username: 'tester' }), scope: () => scope, mode: () => 'chat', worker: () => '', messages: () => [], notice: () => {}, changed: () => {} });
  const file = text => ({ name: 'data.csv', type: 'text/csv', arrayBuffer: async () => new TextEncoder().encode(text).buffer });
  runtime.capture(file('private-project-a')); await runtime.ready();
  scope = 'project-b'; runtime.capture(file('private-project-b')); await runtime.ready();
  scope = 'project-a';
  assert.equal(atob(runtime.filesForTexts(['[文件: data.csv]\nprivate-project-a'])[0].data), 'private-project-a');
});

test('moving a file chat preserves authorized downloads but drops its old project execution container', async t => {
  const fixture = accountFixture();
  const createProject = async name => (await (await worker.fetch(accountRequest('/projects', { action: 'create', name }), fixture.env)).json()).project;
  const a = await createProject('A'), b = await createProject('B');
  const token = await signSkillToken(fixture.env, { type: 'output', user: 'tester', scope: a.id, fileId: 'file_output123', name: 'result.pdf', mime: 'application/pdf', exp: Date.now() + 100000 });
  const session = await signSkillToken(fixture.env, { type: 'session', user: 'tester', scope: a.id, containerId: 'container_old123', exp: Date.now() + 100000 });
  assert.equal((await worker.fetch(accountRequest('/chats', { action: 'save', projectId: a.id, chatId: 'chat-move-001', title: 'report', messages: [{ uid: 1, isUser: true, text: '制作PDF' }, { uid: 2, text: '报告已生成', context: { scope: a.id }, skills: [{ id: 'pdf' }], skillSession: session, artifacts: [{ name: 'result.pdf', token }] }] }), fixture.env)).status, 200);
  const moved = await worker.fetch(accountRequest('/chats', { action: 'move', projectId: a.id, targetProjectId: b.id, chatId: 'chat-move-001' }), fixture.env);
  assert.equal(moved.status, 200); const receipt = await moved.json();
  const loaded = await (await worker.fetch(accountRequest('/chats', { action: 'load', projectId: b.id, chatId: receipt.chatId }), fixture.env)).json();
  const message = loaded.messages.find(item => item.uid === 2);
  assert(!message.skillSession);
  await verifySkillToken(fixture.env, message.artifacts[0].token, { user: 'tester', scope: b.id, type: 'output' });
  t.mock.method(globalThis, 'fetch', async () => new Response('file-bytes'));
  const downloaded = await worker.fetch(accountRequest('/skill-files', { action: 'download', projectId: b.id, token: message.artifacts[0].token }), fixture.env);
  assert.equal(downloaded.status, 200); assert.equal(await downloaded.text(), 'file-bytes');
});

for (const incognito of [false, true]) test((incognito ? 'incognito' : 'saved') + ' tasks retain skill/file recovery metadata without repeating execution', async () => {
  const fixture = accountFixture(), storage = actorStorage(), pending = []; let calls = 0;
  const events = [{ skills: [{ id: 'pdf', name: 'PDF 阅读与制作' }] }, { executionModel: 'claude-sonnet-5-5', modelName: 'Claude · 官方文档' }, { skillSession: 'synthetic-session' }, { t: '实际报告' }, { artifacts: [{ name: 'report.pdf', token: 'synthetic-file-token', mime: 'application/pdf' }] }];
  const Actor = createChatRunClass(async () => { calls++; return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n'); });
  const context = { storage, waitUntil: promise => pending.push(promise) }, actor = new Actor(context, fixture.env);
  const seed = { action: 'start', runId: 'run-metadata-001', fingerprint: 'fp', payload: { chat: { question: '制作PDF' } }, recovery: { user: 'tester', projectId: null, chatId: 'chat-metadata-001', incognito, userMessage: { uid: 1, isUser: true, text: '制作PDF' }, historyEndUid: null, reply: { uid: 2, text: '', citations: [], activity: [] } } };
  const request = () => new Request('https://internal/', { method: 'POST', body: JSON.stringify(seed) });
  assert.equal((await actor.fetch(request())).status, 202); await Promise.all(pending);
  assert.equal(actor.meta.status, 'completed');
  assert.equal(actor.meta.reply.artifacts[0].name, 'report.pdf'); assert.equal(actor.meta.reply.skills[0].id, 'pdf');
  assert.equal(actor.meta.reply.skillSession, 'synthetic-session'); assert.equal(actor.meta.reply.executionModel, 'claude-sonnet-5-5');
  assert.equal(actor.meta.reply.submodel,'claude-sonnet-5-5');assert.equal(actor.meta.reply.brand,'anthropic');
  await actor.fetch(request()); assert.equal(calls, 1);
  if (incognito) {
    assert.deepEqual(storage.sql.exec('SELECT * FROM run_meta').toArray(), []); assert.deepEqual(storage.sql.exec('SELECT * FROM run_events').toArray(), []);
    assert(!fixture.writes.some(key => key.startsWith('chats:')));
  } else {
    const restored = new Actor(context, fixture.env); assert.equal(restored.meta.reply.artifacts[0].name, 'report.pdf'); assert.equal(restored.meta.reply.skillSession, 'synthetic-session'); assert.equal(calls, 1);
    const saved = JSON.parse(fixture.data.get('chats:tester:chat-metadata-001')); assert.equal(saved.find(message => message.uid === 2).artifacts[0].token, 'synthetic-file-token');
    assert.equal(saved.find(message=>message.uid===2).submodel,'claude-sonnet-5-5');assert.equal(saved.find(message=>message.uid===2).brand,'anthropic');
  }
  storage.db.close();
});
