// Only explicit, pre-generation quota rejections may switch credentials.
// Network failures, ordinary rate limits, server errors and accepted streams
// are returned without replaying a potentially billable operation.
const QUOTA_CODES = new Set([
  "insufficient_quota", "credit_balance_exhausted",
  "organization_spend_limit_exceeded", "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded", "billing_hard_limit_reached",
]);
const COOLDOWN_MS = 15 * 60 * 1000;

function keys(env) {
  return [...new Set([env.OPENAI_API_KEY, env.OPENAI_API_KEY_BACKUP]
    .filter(value => typeof value === "string" && value.trim()).map(value => value.trim()))];
}
export function hasOpenAIKey(env) { return keys(env).length > 0; }
export function redactOpenAISecrets(message, env) {
  for (const key of keys(env)) message = String(message).split(key).join("[redacted]");
  return String(message);
}
async function fingerprint(key) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}
function authorization(init, key) {
  if (init.headers instanceof Headers || Array.isArray(init.headers)) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", "Bearer " + key);
    return headers;
  }
  const headers = { ...init.headers };
  for (const name of Object.keys(headers)) if (name.toLowerCase() === "authorization") delete headers[name];
  headers.Authorization = "Bearer " + key;
  return headers;
}
async function quotaRejected(response) {
  if (response.status !== 429) return false;
  const data = await response.clone().json().catch(() => null);
  if (data?.usage || data?.error?.usage) return false;
  return QUOTA_CODES.has(data?.error?.code) || data?.error?.type === "insufficient_quota";
}
function unavailable() {
  return Response.json({ error: { code: "insufficient_quota", type: "insufficient_quota",
    message: "OpenAI 可用账户额度不足，请补充额度后重试。" } }, { status: 429 });
}
export function createOpenAIKeyRouter({ now = () => Date.now(), cooldownMs = COOLDOWN_MS } = {}) {
  const blocked = new Map();
  async function health(id, store) {
    let until = blocked.get(id) || 0;
    if (store) {
      try {
        const value = Number(await store.get("openai-key-health:v1:" + id));
        if (Number.isFinite(value) && value > until) until = value;
      } catch { /* State storage is best effort; never replay a provider error. */ }
    }
    if (until <= now()) { blocked.delete(id); return 0; }
    blocked.set(id, until);
    return until;
  }
  async function block(id, store) {
    const until = now() + cooldownMs;
    blocked.set(id, until);
    if (blocked.size > 16) blocked.delete(blocked.keys().next().value);
    if (store) {
      try { await store.put("openai-key-health:v1:" + id, String(until),
        { expirationTtl: Math.max(60, Math.ceil(cooldownMs / 1000)) }); } catch {}
    }
  }
  return {
    async fetch(env, url, init = {}, { dispatch = (url, options) => fetch(url, options), store } = {}) {
      const target = new URL(url);
      if (target.protocol !== "https:" || target.hostname !== "api.openai.com" || target.port || target.username || target.password) {
        throw new Error("OpenAI credentials require the official HTTPS endpoint.");
      }
      const available = keys(env);
      if (!available.length) throw new Error("OpenAI API key 尚未配置。");
      // Request bodies must be replayable. A stream might already be consumed.
      const replayable = init.body == null || typeof init.body === "string" || init.body instanceof FormData
        || init.body instanceof URLSearchParams || init.body instanceof Blob
        || init.body instanceof ArrayBuffer || ArrayBuffer.isView(init.body);
      const candidates = [];
      for (const key of available) {
        const id = await fingerprint(key);
        if (!(await health(id, store))) candidates.push({ key, id });
      }
      if (!candidates.length) return unavailable();
      let lastResponse;
      for (let index = 0; index < candidates.length; index++) {
        init.signal?.throwIfAborted();
        const { key, id } = candidates[index];
        let response;
        try {
          response = await dispatch(url, { ...init, headers: authorization(init, key), redirect: "manual" });
        } catch (error) {
          const message = redactOpenAISecrets(error?.message || "OpenAI 连接失败", env);
          if (error?.name === "AbortError") throw new DOMException(message, "AbortError");
          throw new Error(message);
        }
        // Never inspect or restart a successful streaming response.
        if (!(await quotaRejected(response))) return response;
        await block(id, store);
        lastResponse = response;
        if (!replayable || index === candidates.length - 1) return response;
        await response.body?.cancel();
      }
      return lastResponse || unavailable();
    },
  };
}
const router = createOpenAIKeyRouter();
export const openAIFetch = (env, url, init, options) => router.fetch(env, url, init, options);
