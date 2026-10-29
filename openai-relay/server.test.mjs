import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createRelayServer } from './server.mjs';

const KEY = 'sk-test-only-' + 'x'.repeat(64);
const HASH = createHash('sha256').update(KEY).digest('hex');
const auth = { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const payload = (extra = {}) => JSON.stringify({ model: 'gpt-6.1-sol', input: 'Synthetic test', stream: true, ...extra });
const encoder = new TextEncoder();
async function start(t, options = {}) {
  const server = createRelayServer({ keyHash: HASH, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return 'http://127.0.0.1:' + server.address().port;
}

test('a missing fingerprint fails closed without exposing a key', () => {
  assert.throws(() => createRelayServer(), /SHA-256 fingerprint/);
});

test('a malformed HTTP target cannot crash the service', async t => {
  const origin = await start(t, { fetchImpl: async () => { throw new Error('unexpected upstream'); } });
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(origin, { path: 'http://[' }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
    request.end();
  });
  assert.equal(status, 400);
  assert.equal((await fetch(origin + '/healthz')).status, 200);
});

test('health is public, while inference and model-list access require the pinned key', async t => {
  let calls = 0;
  const origin = await start(t, { fetchImpl: async () => { calls++; throw new Error('unexpected upstream'); } });
  assert.equal((await fetch(origin + '/healthz')).status, 200);
  for (const headers of [{}, { Authorization: 'Bearer wrong-key' }]) {
    assert.equal((await fetch(origin + '/v1/models', { headers })).status, 401);
    assert.equal((await fetch(origin + '/v1/responses', { method: 'POST', headers, body: payload() })).status, 401);
  }
  assert.equal(calls, 0);
});

test('only the two chat models are listed; private and image model IDs are excluded', async t => {
  const origin = await start(t, { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/models');
    assert.equal(options.headers.Authorization, 'Bearer ' + KEY);
    assert.equal(options.redirect, 'manual');
    return Response.json({ data: [{ id: 'gpt-6-astra' }, { id: 'private-fine-tune' }, { id: 'gpt-6.1-sol' }, { id: 'gpt-image-example' }] }, { headers: { 'x-request-id': 'req-models' } });
  } });
  const response = await fetch(origin + '/v1/models', { headers: auth });
  assert.equal(response.headers.get('x-request-id'), 'req-models');
  assert.deepEqual((await response.json()).data.map(model => model.id), ['gpt-6-astra', 'gpt-6.1-sol']);
});

test('a fresh official request preserves model options but omits caller IP headers and storage', async t => {
  const calls = [];
  const origin = await start(t, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.deepEqual(Object.keys(options.headers).sort(), ['Authorization', 'Content-Type']);
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.deepEqual(body.reasoning, { effort: 'max' });
    assert.deepEqual(body.tools, [{ type: 'web_search' }]);
    return new Response('data: {"delta":"OK"}\n\n', { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-text' } });
  } });
  for (const model of ['gpt-6-astra', 'gpt-6.1-sol']) {
    const response = await fetch(origin + '/v1/responses', { method: 'POST', headers: { ...auth, 'cf-ipcountry': 'HK', 'x-forwarded-for': '192.0.2.10' }, body: payload({ model, store: true, reasoning: { effort: 'max' }, tools: [{ type: 'web_search' }] }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-request-id'), 'req-text');
    assert.match(await response.text(), /OK/);
  }
  assert.equal(calls.length, 2);
});

test('image routes, unapproved models, tools and query strings never reach OpenAI', async t => {
  let calls = 0;
  const origin = await start(t, { fetchImpl: async () => { calls++; throw new Error('unexpected upstream'); } });
  assert.equal((await fetch(origin + '/v1/images/generations', { method: 'POST', headers: auth, body: '{}' })).status, 404);
  assert.equal((await fetch(origin + '/v1/responses?target=another-host', { method: 'POST', headers: auth, body: payload() })).status, 404);
  for (const extra of [{ model: 'another-model' }, { tools: [{ type: 'image_generation' }] }]) {
    assert.equal((await fetch(origin + '/v1/responses', { method: 'POST', headers: auth, body: payload(extra) })).status, 400);
  }
  assert.equal(calls, 0);
});

test('invalid or oversized input is rejected before a billable upstream call', async t => {
  let calls = 0;
  const origin = await start(t, { maxBodyBytes: 128, fetchImpl: async () => { calls++; throw new Error('unexpected upstream'); } });
  assert.equal((await fetch(origin + '/v1/responses', { method: 'POST', headers: auth, body: '{' })).status, 400);
  assert.equal((await fetch(origin + '/v1/responses', { method: 'POST', headers: auth, body: payload({ input: 'x'.repeat(500) }) })).status, 413);
  assert.equal((await fetch(origin + '/v1/responses', { method: 'POST', headers: { Authorization: auth.Authorization }, body: payload() })).status, 415);
  assert.equal(calls, 0);
});

test('the first SSE event arrives while the upstream stream is still open', async t => {
  let controller;
  const origin = await start(t, { fetchImpl: async () => new Response(new ReadableStream({ start(value) { controller = value; value.enqueue(encoder.encode('data: first\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } }) });
  const response = await fetch(origin + '/v1/responses', { method: 'POST', headers: auth, body: payload() });
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /first/);
  assert.equal(first.done, false);
  controller.enqueue(encoder.encode('data: second\n\n'));
  controller.close();
  let tail = '';
  while (true) { const next = await reader.read(); if (next.done) break; tail += new TextDecoder().decode(next.value); }
  assert.match(tail, /second/);
});

test('client cancellation aborts the matching OpenAI request', async t => {
  let observeAbort;
  const aborted = new Promise(resolve => { observeAbort = resolve; });
  const origin = await start(t, { fetchImpl: async (_url, options) => {
    options.signal.addEventListener('abort', observeAbort, { once: true });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('data: first\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const abort = new AbortController();
  const response = await fetch(origin + '/v1/responses', { method: 'POST', headers: auth, body: payload(), signal: abort.signal });
  await response.body.getReader().read();
  abort.abort();
  let timer;
  try { await Promise.race([aborted, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('upstream was not aborted')), 1500); })]); }
  finally { clearTimeout(timer); }
});

test('overlapping requests obey the limit and completed streams release their slot', async t => {
  let controller, calls = 0;
  const origin = await start(t, { maxInflight: 1, fetchImpl: async () => {
    if (++calls > 1) return new Response('data: OK\n\n');
    return new Response(new ReadableStream({ start(value) { controller = value; value.enqueue(encoder.encode('data: first\n\n')); } }));
  } });
  const first = await fetch(origin + '/v1/responses', { method: 'POST', headers: auth, body: payload() });
  const second = await fetch(origin + '/v1/responses', { method: 'POST', headers: auth, body: payload() });
  assert.equal(second.status, 429);
  assert.equal(calls, 1);
  controller.close();
  await first.text();
  const third = await fetch(origin + '/v1/responses', { method: 'POST', headers: auth, body: payload() });
  assert.equal(third.status, 200);
  await third.text();
});

test('upstream errors retain their status and request ID without leaking the key or retrying', async t => {
  let calls = 0;
  const origin = await start(t, { fetchImpl: async () => {
    calls++;
    return Response.json({ error: { code: 'unsupported_country_region_territory', message: 'Rejected ' + KEY } }, { status: 403, headers: { 'x-request-id': 'req-rejected' } });
  } });
  const response = await fetch(origin + '/v1/responses', { method: 'POST', headers: auth, body: payload() });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('x-request-id'), 'req-rejected');
  const text = await response.text();
  assert.match(text, /unsupported_country_region_territory/);
  assert.ok(!text.includes(KEY));
  assert.equal(calls, 1);
});

test('redirects never forward credentials to another destination', async t => {
  let calls = 0;
  const origin = await start(t, { fetchImpl: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://unexpected.example/' } });
  } });
  assert.equal((await fetch(origin + '/v1/responses', { method: 'POST', headers: auth, body: payload() })).status, 502);
  assert.equal(calls, 1);
});

test('a timeout aborts the upstream and releases the concurrency slot', async t => {
  let calls = 0;
  const origin = await start(t, { timeoutMs: 25, maxInflight: 1, fetchImpl: async (_url, options) => {
    if (++calls === 1) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    return new Response('data: OK\n\n');
  } });
  assert.equal((await fetch(origin + '/v1/responses', { method: 'POST', headers: auth, body: payload() })).status, 504);
  const second = await fetch(origin + '/v1/responses', { method: 'POST', headers: auth, body: payload() });
  assert.equal(second.status, 200);
  await second.text();
});
