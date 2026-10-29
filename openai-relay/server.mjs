import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

const MODELS = new Set(['gpt-6-astra', 'gpt-6.1-sol']);
const COPY_HEADERS = ['x-request-id', 'retry-after', 'openai-processing-ms'];

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
function failure(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}
async function readBody(request, limit) {
  if (Number(request.headers['content-length']) > limit) {
    request.resume();
    throw failure(413, 'Request body is too large.', 'request_too_large');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) {
      request.resume();
      throw failure(413, 'Request body is too large.', 'request_too_large');
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw failure(400, 'Invalid JSON request.', 'invalid_json'); }
}

export function createRelayServer({ keyHash, fetchImpl = fetch, timeoutMs = 720_000, maxBodyBytes = 32 * 1024 * 1024, maxInflight = 8 } = {}) {
  if (!/^[a-f0-9]{64}$/i.test(keyHash || '')) throw new Error('OPENAI_ALLOWED_KEY_SHA256 must contain a SHA-256 fingerprint.');
  const expected = Buffer.from(keyHash, 'hex');
  let inflight = 0;
  const server = createServer(async (request, response) => {
    let url;
    try { url = new URL(request.url, 'http://relay.local'); }
    catch { request.resume(); return json(response, 400, { error: { code: 'invalid_path', message: 'Invalid request path.' } }); }
    if (request.method === 'GET' && url.pathname === '/healthz' && !url.search) return json(response, 200, { status: 'ok' });
    const chat = request.method === 'POST' && url.pathname === '/v1/responses';
    const models = request.method === 'GET' && url.pathname === '/v1/models';
    if ((!chat && !models) || url.search) { request.resume(); return json(response, 404, { error: { code: 'not_found', message: 'Not found.' } }); }
    const authorization = request.headers.authorization || '';
    const key = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!key || key.length > 512 || /\s/.test(key) || !timingSafeEqual(createHash('sha256').update(key).digest(), expected)) {
      request.resume();
      return json(response, 401, { error: { code: 'unauthorized', message: 'Authentication required.' } });
    }
    if (inflight >= maxInflight) {
      request.resume();
      response.setHeader('Retry-After', '5');
      return json(response, 429, { error: { code: 'busy', message: 'Relay is busy. Retry shortly.' } });
    }
    inflight++;
    const abort = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
    const disconnected = () => { if (!response.writableEnded) abort.abort(); };
    request.once('aborted', disconnected);
    response.once('close', disconnected);
    try {
      let body;
      if (chat) {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw failure(415, 'Use application/json.', 'unsupported_content_type');
        const input = await readBody(request, maxBodyBytes);
        if (!input || Array.isArray(input) || typeof input !== 'object' || !MODELS.has(input.model)) throw failure(400, 'Select GPT-6 Astra or GPT-6.1 Sol.', 'unsupported_model');
        if (Array.isArray(input.tools) && input.tools.some(tool => tool?.type === 'image_generation')) throw failure(400, 'Image generation is not enabled.', 'unsupported_tool');
        input.store = false;
        body = JSON.stringify(input);
      }
      // Create a fresh server-side request; visitor IP and Cloudflare headers are not forwarded.
      const upstream = await fetchImpl('https://api.openai.com' + url.pathname, {
        method: request.method,
        headers: { Authorization: 'Bearer ' + key, ...(chat ? { 'Content-Type': 'application/json' } : {}) },
        body, redirect: 'manual', signal: abort.signal
      });
      for (const name of COPY_HEADERS) if (upstream.headers.has(name)) response.setHeader(name, upstream.headers.get(name));
      if (upstream.status >= 300 && upstream.status < 400) throw failure(502, 'Upstream redirect refused.', 'upstream_redirect');
      if (!upstream.ok) {
        let error;
        const safe = (await upstream.text()).replaceAll(key, '[redacted]').slice(0, 16_384);
        try { error = JSON.parse(safe); }
        catch { error = { error: { code: 'upstream_error', message: 'OpenAI rejected the request.' } }; }
        return json(response, upstream.status, error);
      }
      if (models) {
        const result = await upstream.json();
        return json(response, 200, { object: 'list', data: (Array.isArray(result.data) ? result.data : []).filter(model => MODELS.has(model?.id)).map(model => ({ id: model.id, object: 'model' })) });
      }
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'text/event-stream',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no'
      });
      response.flushHeaders();
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response, { signal: abort.signal });
      else response.end();
    } catch (error) {
      if (!response.destroyed && !response.headersSent) json(response, error.status || (timedOut ? 504 : 502), { error: { code: error.code || (timedOut ? 'upstream_timeout' : 'upstream_unavailable'), message: error.status ? error.message : 'OpenAI connection interrupted.' } });
      else if (!response.destroyed) response.destroy();
    } finally {
      clearTimeout(timer);
      request.off('aborted', disconnected);
      response.off('close', disconnected);
      inflight--;
    }
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 300_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 40;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createRelayServer({ keyHash: process.env.OPENAI_ALLOWED_KEY_SHA256 });
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
  process.once('SIGTERM', () => server.close());
  process.once('SIGINT', () => server.close());
}
