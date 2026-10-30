import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAIKeyRouter, hasOpenAIKey, redactOpenAISecrets } from "./openai-keys.js";
const url = "https://api.openai.com/v1/responses";
test("quota responses that report billable usage are preserved without replay", async () => {
  let calls = 0;
  const response = await createOpenAIKeyRouter().fetch(env, url, {}, {
    dispatch: async () => { calls++; return Response.json({
      error: { code: "insufficient_quota", type: "insufficient_quota" },
      usage: { input_tokens: 100, output_tokens: 1 },
    }, { status: 429 }); },
  });
  assert.equal(response.status, 429); assert.equal(calls, 1);
});
const env = { OPENAI_API_KEY: "synthetic-primary", OPENAI_API_KEY_BACKUP: "synthetic-backup" };
const quota = code => Response.json({ error: { code, type: "insufficient_quota" } }, { status: 429 });
const auth = options => new Headers(options.headers).get("authorization");

test("all explicit quota codes switch once with identical model, body, signal and private headers", async () => {
  for (const code of ["insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded", "billing_hard_limit_reached"]) {
    const router = createOpenAIKeyRouter(), calls = [], signal = new AbortController().signal;
    const body = JSON.stringify({ model: "gpt-6.1-sol", input: "synthetic context", store: false });
    const response = await router.fetch(env, url, { method: "POST", body, signal, headers: { "Content-Type": "application/json" } }, {
      dispatch: async (url, options) => { calls.push(options); return calls.length === 1 ? quota(code) : new Response("data: success\n\n"); },
    });
    assert.equal(await response.text(), "data: success\n\n");
    assert.deepEqual(calls.map(auth), ["Bearer synthetic-primary", "Bearer synthetic-backup"]);
    assert.ok(calls.every(options => options.body === body && options.signal === signal && options.redirect === "manual"));
  }
});
test("exhausted primary is skipped; cooldown probes it again after replenishment", async () => {
  let clock = 1000;
  const router = createOpenAIKeyRouter({ now: () => clock, cooldownMs: 100 }), calls = [];
  const options = { dispatch: async (url, options) => { calls.push(auth(options)); return calls.length === 1 ? quota("credit_balance_exhausted") : new Response("ok"); } };
  await router.fetch(env, url, {}, options); await router.fetch(env, url, {}, options);
  assert.deepEqual(calls, ["Bearer synthetic-primary", "Bearer synthetic-backup", "Bearer synthetic-backup"]);
  clock += 101; await router.fetch(env, url, {}, options);
  assert.equal(calls.at(-1), "Bearer synthetic-primary");
});
test("KV health survives another isolate; no key or prompt is stored", async () => {
  const data = new Map(), calls = [], store = { get: async key => data.get(key), put: async (key, value) => data.set(key, value) };
  const options = { store, dispatch: async (url, options) => { calls.push(auth(options)); return auth(options).endsWith("primary") ? quota("insufficient_quota") : new Response("ok"); } };
  await createOpenAIKeyRouter().fetch(env, url, {}, options);
  await createOpenAIKeyRouter().fetch(env, url, {}, options);
  assert.deepEqual(calls, ["Bearer synthetic-primary", "Bearer synthetic-backup", "Bearer synthetic-backup"]);
  const stored = JSON.stringify([...data]);
  assert.ok(!stored.includes("synthetic")); assert.match([...data.keys()][0], /^openai-key-health:v1:[a-f0-9]{64}$/);
});
test("ordinary 429, 401, 403, 5xx and malformed errors never switch or repeat", async () => {
  for (const status of [401, 403, 429, 500, 502, 503, 504]) {
    let calls = 0;
    const response = await createOpenAIKeyRouter().fetch(env, url, {}, {
      dispatch: async () => { calls++; return Response.json({ error: { code: "rate_limit_exceeded" } }, { status }); },
    });
    assert.equal(response.status, status); assert.equal(calls, 1);
  }
  let calls = 0;
  await createOpenAIKeyRouter().fetch(env, url, {}, { dispatch: async () => { calls++; return new Response("not-json", { status: 429 }); } });
  assert.equal(calls, 1);
});
test("ambiguous network failure is not replayed and both secrets are redacted", async () => {
  let calls = 0;
  await assert.rejects(createOpenAIKeyRouter().fetch(env, url, {}, {
    dispatch: async () => { calls++; throw Error(env.OPENAI_API_KEY + " " + env.OPENAI_API_KEY_BACKUP); },
  }), error => !error.message.includes("synthetic") && error.message.includes("[redacted]"));
  assert.equal(calls, 1);
});
test("accepted streams, including a later quota error, are passed through exactly once", async () => {
  let calls = 0;
  const body = 'data: {"type":"response.output_text.delta","delta":"prefix"}\n\ndata: {"type":"response.failed","response":{"error":{"code":"insufficient_quota"}}}\n\n';
  const response = await createOpenAIKeyRouter().fetch(env, url, {}, {
    dispatch: async () => { calls++; return new Response(body, { headers: { "content-type": "text/event-stream" } }); },
  });
  assert.equal(await response.text(), body); assert.equal(calls, 1);
});
test("both accounts exhausted stop after two attempts and subsequent requests make no paid call", async () => {
  const router = createOpenAIKeyRouter(); let calls = 0;
  const options = { dispatch: async () => { calls++; return quota("insufficient_quota"); } };
  assert.equal((await router.fetch(env, url, {}, options)).status, 429);
  assert.equal((await router.fetch(env, url, {}, options)).status, 429); assert.equal(calls, 2);
});
test("duplicate credentials are tried once; backup alone enables the provider", async () => {
  let calls = 0;
  await createOpenAIKeyRouter().fetch({ OPENAI_API_KEY: "same", OPENAI_API_KEY_BACKUP: "same" }, url, {}, {
    dispatch: async () => { calls++; return quota("insufficient_quota"); },
  });
  assert.equal(calls, 1); assert.equal(hasOpenAIKey({ OPENAI_API_KEY_BACKUP: "backup-only" }), true);
  assert.equal(hasOpenAIKey({ OPENAI_API_KEY: "  " }), false);
  assert.equal(redactOpenAISecrets("synthetic-backup", env), "[redacted]");
});
test("abort stops the switch and non-replayable bodies never get resent", async () => {
  const control = new AbortController(); let calls = 0;
  await assert.rejects(createOpenAIKeyRouter().fetch(env, url, { signal: control.signal }, {
    dispatch: async () => { calls++; control.abort(); return quota("insufficient_quota"); },
  }), { name: "AbortError" }); assert.equal(calls, 1);
  calls = 0;
  await createOpenAIKeyRouter().fetch(env, url, { body: new ReadableStream({ start(c) { c.close(); } }) }, {
    dispatch: async () => { calls++; return quota("insufficient_quota"); },
  }); assert.equal(calls, 1);
});
test("storage outages do not prevent safe quota failover; secrets cannot follow a redirect or third-party URL", async () => {
  let calls = 0;
  await createOpenAIKeyRouter().fetch(env, url, {}, {
    store: { get: async () => { throw Error("offline"); }, put: async () => { throw Error("offline"); } },
    dispatch: async () => { calls++; return calls === 1 ? quota("insufficient_quota") : new Response("ok"); },
  }); assert.equal(calls, 2);
  await assert.rejects(createOpenAIKeyRouter().fetch(env, "https://example.org/v1/responses"), /official HTTPS/);
});
