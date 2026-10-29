// ChatRun retains the conversation; this object only streams official OpenAI HTTP requests.
export const OPENAI_TRANSPORT_ORIGIN = 'https://openai-upstream.internal';
const OPENAI_ORIGIN = 'https://api.openai.com';
const OBJECT_NAME = 'openai-upstream:v1';

function allowed(method, url) {
  return !url.search && !url.hash && (
    (method === 'POST' && url.pathname === '/v1/responses') ||
    (method === 'GET' && url.pathname === '/v1/models')
  );
}

export async function fetchOpenAIFromUS(env, url, options = {}) {
  const target = new URL(url);
  const method = String(options.method || 'GET').toUpperCase();
  if (target.origin !== OPENAI_ORIGIN || !allowed(method, target)) throw new Error('OpenAI 传输目标无效。');
  if (typeof env.CHAT_RUNS?.jurisdiction !== 'function') throw new Error('OpenAI 美国区传输尚未部署。');
  const namespace = env.CHAT_RUNS.jurisdiction('us');
  const id = namespace.idFromName(OBJECT_NAME);
  const headers = new Headers();
  if (method === 'POST') headers.set('Content-Type', 'application/json');
  // The receiving object uses its own encrypted binding, so no credential crosses this hop.
  return namespace.get(id).fetch(new Request(OPENAI_TRANSPORT_ORIGIN + target.pathname, {
    method, headers, body: options.body, signal: options.signal, redirect: 'manual'
  }));
}

export async function handleOpenAITransport(request, env, jurisdiction) {
  const target = new URL(request.url);
  const reply = (error, status) => Response.json({error}, {status, headers:{'Cache-Control':'no-store'}});
  if (target.origin !== OPENAI_TRANSPORT_ORIGIN || !allowed(request.method, target)) return reply('OpenAI 传输请求无效。', 400);
  if (jurisdiction !== 'us') return reply('OpenAI 传输未位于美国辖区。', 503);
  if (!env.OPENAI_API_KEY) return reply('OpenAI 官方密钥尚未配置。', 503);
  const headers = new Headers({Authorization:'Bearer ' + env.OPENAI_API_KEY});
  const options = {method:request.method, headers, signal:request.signal, redirect:'manual'};
  if (request.method === 'POST') {
    headers.set('Content-Type', 'application/json');
    options.body = request.body;
    options.duplex = 'half';
  }
  // Preserve upstream status, SSE chunks, usage events and cancellation without buffering.
  const response = await fetch(OPENAI_ORIGIN + target.pathname, options);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(response.body, {status:response.status, statusText:response.statusText, headers:responseHeaders});
}
