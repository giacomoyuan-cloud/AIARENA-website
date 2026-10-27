var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
async function hashText(t) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashText, "hashText");
const OFFICIAL_MODELS = {
  "grok-4.6": { provider: "xai", binding: "GROK_API_KEY", name: "Grok 4.6", maxTokens: 128000 },
  "gpt-6-astra": { provider: "openai", binding: "OPENAI_API_KEY", name: "GPT-6 Astra", maxTokens: 128000 },
  "gpt-5.6-sol": { provider: "openai", binding: "OPENAI_API_KEY", name: "GPT-5.6 Sol", maxTokens: 128000 },
  "claude-fable-5-1": { provider: "anthropic", binding: "ANTHROPIC_API_KEY", name: "Claude Fable 5.1", maxTokens: 64000 },
  "claude-opus-5": { provider: "anthropic", binding: "ANTHROPIC_API_KEY", name: "Claude Opus 5", maxTokens: 128000 },
  "gemini-3.8-flash": { provider: "google", binding: "GEMINI_API_KEY", name: "Gemini 3.8 Flash", maxTokens: 65536 },
  "gemini-3.1-pro-preview": { provider: "google", binding: "GEMINI_API_KEY", name: "Gemini 3.1 Pro", maxTokens: 65536 },
  "grok-imagine-image-2.0": { provider: "xai", binding: "GROK_API_KEY", name: "Grok Imagine Image 2.0", image: true },
  "gpt-image-2.5-sunburst": { provider: "openai", binding: "OPENAI_API_KEY", name: "GPT Image 2.5 Sunburst", image: true },
  "gemini-3.1-flash-image": { provider: "google", binding: "GEMINI_API_KEY", name: "Gemini 3.1 Flash Image", image: true }
};

var worker_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }
    const url = new URL(request.url);
    if (url.pathname === "/chats" && request.method === "POST") {
      let body2;
      try {
        body2 = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
      }
      const { password: password2, username, action, chatId, title, messages } = body2;
      const normalizedUsername = (username || "").trim().toLowerCase();
      let chatAuthOk = false;
      if (normalizedUsername && password2) {
        const userData = await env.MEMORY_KV.get("user:" + normalizedUsername);
        if (userData) {
          const parsed = JSON.parse(userData);
          chatAuthOk = parsed.hash === password2;
        }
      }
      if (!chatAuthOk) {
        const expectedH = await hashText(env.PASSWORD);
        if (!password2 || password2 !== expectedH) {
          return new Response(JSON.stringify({ error: "Wrong password" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        }
      }
      if (!normalizedUsername) {
        return new Response(JSON.stringify({ error: "Missing username" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
      const listKey = "chats:" + normalizedUsername + ":list";
      async function getList() {
        const raw = await env.BIZ_KV.get(listKey);
        return raw ? JSON.parse(raw) : [];
      }
      __name(getList, "getList");
      async function putList(list) {
        await env.BIZ_KV.put(listKey, JSON.stringify(list));
      }
      __name(putList, "putList");
      if (action === "list") {
        const list = await getList();
        return new Response(JSON.stringify({ chats: list }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
      if (action === "load") {
        if (!chatId) return new Response(JSON.stringify({ error: "Missing chatId" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        const data = await env.BIZ_KV.get("chats:" + normalizedUsername + ":" + chatId);
        return new Response(JSON.stringify({ messages: data ? JSON.parse(data) : [] }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
      if (action === "save") {
        if (!chatId || !messages) return new Response(JSON.stringify({ error: "Missing chatId or messages" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        await env.BIZ_KV.put("chats:" + normalizedUsername + ":" + chatId, JSON.stringify(messages));
        const list = await getList();
        const now = Date.now();
        const existing = list.find((c) => c.id === chatId);
        if (existing) {
          existing.updatedAt = now;
          if (title) existing.title = title;
        } else {
          list.unshift({ id: chatId, title: title || "\u65B0\u4F1A\u8BDD", updatedAt: now });
        }
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        if (list.length > 50) {
          const removed = list.splice(50);
          for (const r of removed) {
            await env.BIZ_KV.delete("chats:" + normalizedUsername + ":" + r.id);
          }
        }
        await putList(list);
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
      if (action === "delete") {
        if (!chatId) return new Response(JSON.stringify({ error: "Missing chatId" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        await env.BIZ_KV.delete("chats:" + normalizedUsername + ":" + chatId);
        let list = await getList();
        list = list.filter((c) => c.id !== chatId);
        await putList(list);
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (request.method === "POST" && url.pathname === "/admin/create-user") {
      let body2;
      try {
        body2 = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const { adminKey, username, password: password2 } = body2;
      if (adminKey !== env.ADMIN_KEY) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      if (!username || !password2 || password2.length < 8) return new Response(JSON.stringify({ error: "username and password (8+ chars) required" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const passHash = await hashText(password2);
      await env.MEMORY_KV.put("user:" + username.toLowerCase(), JSON.stringify({ hash: passHash, created: Date.now() }));
      return new Response(JSON.stringify({ ok: true, username: username.toLowerCase() }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (request.method === "POST" && url.pathname === "/auth") {
      let body2;
      try {
        body2 = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const { username, passwordHash } = body2;
      if (!username || !passwordHash) return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const userData = await env.MEMORY_KV.get("user:" + username.toLowerCase());
      if (!userData) return new Response(JSON.stringify({ error: "\u7528\u6237\u4E0D\u5B58\u5728" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const parsed = JSON.parse(userData);
      if (parsed.hash !== passwordHash) return new Response(JSON.stringify({ error: "\u5BC6\u7801\u9519\u8BEF" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (url.pathname === "/skills" && request.method === "GET") {
      const user = url.searchParams.get("user");
      const pass = url.searchParams.get("pass");
      if (!user || !pass) return new Response(JSON.stringify({ error: "missing params" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const ud = await env.MEMORY_KV.get("user:" + user.toLowerCase());
      if (!ud) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      if (JSON.parse(ud).hash !== pass) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const skills = await env.BIZ_KV.get("skills:" + user.toLowerCase());
      return new Response(JSON.stringify({ skills: skills ? JSON.parse(skills) : [] }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (url.pathname === "/skills" && request.method === "POST") {
      let body2;
      try {
        body2 = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const { username, password: password2, skills } = body2;
      if (!username || !password2 || !skills) return new Response(JSON.stringify({ error: "missing params" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const ud = await env.MEMORY_KV.get("user:" + username.toLowerCase());
      if (!ud) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      if (JSON.parse(ud).hash !== password2) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      await env.BIZ_KV.put("skills:" + username.toLowerCase(), JSON.stringify(skills));
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (request.method === "GET" && url.pathname === "/memory") {
      const user = url.searchParams.get("user");
      const pass = url.searchParams.get("pass");
      if (!pass || !user) return new Response(JSON.stringify({ error: "missing params" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      let memAuthOk = false;
      const memUserData = await env.MEMORY_KV.get("user:" + user.toLowerCase());
      if (memUserData) {
        const p = JSON.parse(memUserData);
        memAuthOk = p.hash === pass;
      }
      if (!memAuthOk) {
        const expectedHash = await hashText(env.PASSWORD);
        if (pass !== expectedHash) return new Response(JSON.stringify({ error: "auth" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
      const mem = await env.MEMORY_KV.get("mem:" + user);
      return new Response(JSON.stringify({ memory: mem || "" }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (request.method === "POST" && url.pathname === "/memory") {
      let body2;
      try {
        body2 = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const { password: password2, user, conversation } = body2;
      let memPAuthOk = false;
      if (user && password2) {
        const memPData = await env.MEMORY_KV.get("user:" + user.toLowerCase());
        if (memPData) {
          const pp = JSON.parse(memPData);
          memPAuthOk = pp.hash === password2;
        }
      }
      if (!memPAuthOk) {
        const expectedHash = await hashText(env.PASSWORD);
        if (!password2 || password2 !== expectedHash) return new Response(JSON.stringify({ error: "auth" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
      if (!user || !conversation) return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const existingMem = await env.MEMORY_KV.get("mem:" + user) || "";
      const extractPrompt = `You are a memory extraction system. Your job is to extract and maintain key facts about a user from their conversations.

EXISTING MEMORY:
${existingMem || "(empty)"}

NEW CONVERSATION:
${conversation}

RULES:
1. Extract key facts: name, profession, projects, preferences, technical skills, goals, personal details they shared
2. Merge with existing memory - update outdated info, add new info, remove contradicted info
3. Keep it concise: max 500 words, bullet point format
4. Only store facts, not opinions or conversation flow
5. Write in the same language the user predominantly uses
6. Do NOT store conversation content verbatim, only extracted facts
7. If the conversation has no useful personal info to extract, return the existing memory unchanged

OUTPUT: Return ONLY the updated memory text, nothing else.`;
      if (!env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "Anthropic 官方密钥尚未配置" }), { status: 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          redirect: "manual",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
            messages: [{ role: "user", content: extractPrompt }]
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error("Anthropic 官方记忆接口请求失败，HTTP " + res.status);
        const newMem = data.content?.find(block => block.type === "text")?.text || existingMem;
        await env.MEMORY_KV.put("mem:" + user, newMem);
        return new Response(JSON.stringify({ ok: true, memory: newMem }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
    }
    if (request.method === "GET" && url.pathname === "/usage") {
      const user = url.searchParams.get("user");
      const pass = url.searchParams.get("pass");
      const all = url.searchParams.get("all");
      if (!user || !pass) return new Response(JSON.stringify({ error: "missing params" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const ud = await env.MEMORY_KV.get("user:" + user.toLowerCase());
      if (!ud || JSON.parse(ud).hash !== pass) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const isAdmin = user.toLowerCase() === "oakleyyuen";
      const prefix = isAdmin && all === "1" ? "usage:" : "usage:user:" + user.toLowerCase() + ":";
      const keys = await env.BIZ_KV.list({ prefix });
      const result = {};
      for (const k of keys.keys) {
        const val = await env.BIZ_KV.get(k.name);
        result[k.name] = val ? JSON.parse(val) : null;
      }
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (url.pathname === "/topup" && request.method === "POST") {
      let body2;
      try {
        body2 = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const { username: tuUser, password: tuPass, pool, amount, date } = body2;
      if (!tuUser || !tuPass || !pool || !amount) return new Response(JSON.stringify({ error: "missing params" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const tuData = await env.MEMORY_KV.get("user:" + tuUser.toLowerCase());
      if (!tuData || JSON.parse(tuData).hash !== tuPass) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const tuKey = "topups:" + tuUser.toLowerCase() + ":" + pool;
      const tuExisting = JSON.parse(await env.BIZ_KV.get(tuKey) || "[]");
      tuExisting.push({ amount: parseFloat(amount), date: date || (/* @__PURE__ */ new Date()).toISOString() });
      await env.BIZ_KV.put(tuKey, JSON.stringify(tuExisting));
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (url.pathname === "/topup-edit" && request.method === "POST") {
      let teBody;
      try {
        teBody = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const { username: teUser, password: tePass, pool: tePool, index: teIndex, amount: teAmount } = teBody;
      if (!teUser || !tePass || !tePool || teIndex === void 0 || teAmount === void 0) return new Response(JSON.stringify({ error: "missing params" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const teData = await env.MEMORY_KV.get("user:" + teUser.toLowerCase());
      if (!teData || JSON.parse(teData).hash !== tePass) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const teKey = "topups:" + teUser.toLowerCase() + ":" + tePool;
      const teList = JSON.parse(await env.BIZ_KV.get(teKey) || "[]");
      if (teIndex < 0 || teIndex >= teList.length) return new Response(JSON.stringify({ error: "index out of range" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      teList[teIndex].amount = parseFloat(teAmount);
      await env.BIZ_KV.put(teKey, JSON.stringify(teList));
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (url.pathname === "/topups" && request.method === "GET") {
      const tuUser2 = url.searchParams.get("user");
      const tuPass2 = url.searchParams.get("pass");
      if (!tuUser2 || !tuPass2) return new Response(JSON.stringify({ error: "missing params" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const tuData2 = await env.MEMORY_KV.get("user:" + tuUser2.toLowerCase());
      if (!tuData2 || JSON.parse(tuData2).hash !== tuPass2) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const pools = ["xai-official", "anthropic-official", "openai-official", "google-official", "quick", "aipro", "ly", "ai-proxy", "mj"];
      const tuResult = {};
      for (const p of pools) {
        const raw = await env.BIZ_KV.get("topups:" + tuUser2.toLowerCase() + ":" + p);
        tuResult[p] = raw ? JSON.parse(raw) : [];
      }
      return new Response(JSON.stringify(tuResult), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (url.pathname === "/pool-spent" && request.method === "GET") {
      const psUser = url.searchParams.get("user");
      const psPass = url.searchParams.get("pass");
      if (!psUser || !psPass) return new Response(JSON.stringify({ error: "missing params" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const psData = await env.MEMORY_KV.get("user:" + psUser.toLowerCase());
      if (!psData || JSON.parse(psData).hash !== psPass) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const psRaw = await env.BIZ_KV.get("pool-spent:" + psUser.toLowerCase());
      return new Response(JSON.stringify({ spent: psRaw ? JSON.parse(psRaw) : {} }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (url.pathname === "/pool-spent" && request.method === "POST") {
      let psBody;
      try {
        psBody = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const { username: psUser2, password: psPass2, pool: psPool, amount: psAmount } = psBody;
      if (!psUser2 || !psPass2 || !psPool || psAmount === void 0) return new Response(JSON.stringify({ error: "missing params" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const psData2 = await env.MEMORY_KV.get("user:" + psUser2.toLowerCase());
      if (!psData2 || JSON.parse(psData2).hash !== psPass2) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const psKey = "pool-spent:" + psUser2.toLowerCase();
      const psExisting = JSON.parse(await env.BIZ_KV.get(psKey) || "{}");
      psExisting[psPool] = (psExisting[psPool] || 0) + parseFloat(psAmount);
      await env.BIZ_KV.put(psKey, JSON.stringify(psExisting));
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (request.method === "GET" && url.pathname === "/model-prices") {
      const mpUser = url.searchParams.get("user");
      const mpPass = url.searchParams.get("pass");
      if (!mpUser || !mpPass) return new Response(JSON.stringify({ error: "missing params" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const mpData = await env.MEMORY_KV.get("user:" + mpUser.toLowerCase());
      if (!mpData || JSON.parse(mpData).hash !== mpPass) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const prices = await env.BIZ_KV.get("model-prices:" + mpUser.toLowerCase());
      return new Response(JSON.stringify({ prices: prices ? JSON.parse(prices) : {} }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (request.method === "POST" && url.pathname === "/model-prices") {
      let body2;
      try {
        body2 = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const { username: mpUser2, password: mpPass2, prices } = body2;
      if (!mpUser2 || !mpPass2 || !prices) return new Response(JSON.stringify({ error: "missing params" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      const mpData2 = await env.MEMORY_KV.get("user:" + mpUser2.toLowerCase());
      if (!mpData2 || JSON.parse(mpData2).hash !== mpPass2) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      await env.BIZ_KV.put("model-prices:" + mpUser2.toLowerCase(), JSON.stringify(prices));
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (request.method === "GET" && url.pathname !== "/memory") {
      return new Response(JSON.stringify({ mode: "official", xai: !!env.GROK_API_KEY, openai: !!env.OPENAI_API_KEY, anthropic: !!env.ANTHROPIC_API_KEY, google: !!env.GEMINI_API_KEY, mj: false }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const { password, model, prompt, search, image = null, imageMime = null, images = null } = body;
    const allImages = images && images.length ? images : image ? [{ data: image, mime: imageMime || "image/jpeg" }] : [];
    const MAX_IMAGE_BASE64_LEN = 14 * 1024 * 1024;
    if (image && image.length > MAX_IMAGE_BASE64_LEN) {
      return new Response(JSON.stringify({ error: "\u56FE\u7247\u8FC7\u5927\uFF0C\u8BF7\u538B\u7F29\u540E\u518D\u8BD5\uFF08\u5EFA\u8BAE\u5C0F\u4E8E 10MB\uFF09" }), {
        status: 413,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    const authUserRaw = body.user || body.username || "";
    const authUser = authUserRaw.trim().toLowerCase() || null;
    let authOk = false;
    const authPass = body.password || body.passwordHash || null;
    if (authUser && authPass) {
      const userData = await env.MEMORY_KV.get("user:" + authUser);
      if (userData) {
        const parsed = JSON.parse(userData);
        const hashOfPass = await hashText(authPass);
        authOk = parsed.hash === authPass || parsed.hash === hashOfPass;
      }
    }
    if (!authOk) {
      const expectedHash = await hashText(env.PASSWORD);
      if (!authPass || authPass !== expectedHash) {
        return new Response(JSON.stringify({ error: "Wrong password" }), {
          status: 401,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }
    const modelConfig = Object.hasOwn(OFFICIAL_MODELS, model) ? OFFICIAL_MODELS[model] : null;
    if (!modelConfig) {
      const reason = String(model || "").startsWith("mj") || model === "swap-face"
        ? "Midjourney 未提供通用公开官方 API，本网站已停止中转调用"
        : "该模型未启用官方 API，请刷新后选择当前官方模型";
      return new Response(JSON.stringify({ error: reason }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (!env[modelConfig.binding]) {
      return new Response(JSON.stringify({ error: modelConfig.provider + " 官方密钥尚未配置：" + modelConfig.binding }), { status: 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    async function sendChunk(text) {
      await writer.write(encoder.encode("data: " + JSON.stringify({ t: text }) + "\n\n"));
    }
    __name(sendChunk, "sendChunk");
    async function sendDone() {
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    }
    __name(sendDone, "sendDone");
    async function sendModelName(name) {
      await writer.write(encoder.encode("data: " + JSON.stringify({ modelName: name }) + "\n\n"));
    }
    __name(sendModelName, "sendModelName");
    async function sendReasoning(r) {
      await writer.write(encoder.encode("data: " + JSON.stringify({ r }) + "\n\n"));
    }
    __name(sendReasoning, "sendReasoning");
    async function sendImage(b64, mime) {
      await writer.write(encoder.encode("data: " + JSON.stringify({ img: b64, mime }) + "\n\n"));
    }
    __name(sendImage, "sendImage");
    async function sendButtons(taskId, buttons) {
      await writer.write(encoder.encode("data: " + JSON.stringify({ mjButtons: { taskId, buttons } }) + "\n\n"));
    }
    __name(sendButtons, "sendButtons");
    async function sendUsage(inputTokens, outputTokens) {
      await writer.write(encoder.encode("data: " + JSON.stringify({ usage: { input: inputTokens, output: outputTokens } }) + "\n\n"));
    }
    __name(sendUsage, "sendUsage");
    async function sendCost(cost) {
      await writer.write(encoder.encode("data: " + JSON.stringify({ cost }) + "\n\n"));
    }
    __name(sendCost, "sendCost");
    async function recordUsage(modelId, inputTokens, outputTokens) {
      if (!inputTokens && !outputTokens) return;
      const username = authUser || "anonymous";
      const now = Date.now();
      const globalKey = "usage:global:official~" + modelId;
      const userKey = "usage:user:" + username + ":official~" + modelId;
      try {
        const [gRaw, uRaw] = await Promise.all([
          env.BIZ_KV.get(globalKey),
          env.BIZ_KV.get(userKey)
        ]);
        const g = gRaw ? JSON.parse(gRaw) : { input: 0, output: 0, calls: 0 };
        const u = uRaw ? JSON.parse(uRaw) : { input: 0, output: 0, calls: 0 };
        g.input += inputTokens || 0;
        g.output += outputTokens || 0;
        g.calls += 1;
        g.lastAt = now;
        u.input += inputTokens || 0;
        u.output += outputTokens || 0;
        u.calls += 1;
        u.lastAt = now;
        await Promise.all([
          env.BIZ_KV.put(globalKey, JSON.stringify(g)),
          env.BIZ_KV.put(userKey, JSON.stringify(u))
        ]);
      } catch (e) {
      }
    }
    __name(recordUsage, "recordUsage");
    async function recordFixedCost(modelId, cost) {
      if (!cost) return;
      const username = authUser || "anonymous";
      const now = Date.now();
      const globalKey = "usage:global:official~" + modelId;
      const userKey = "usage:user:" + username + ":official~" + modelId;
      try {
        const [gRaw, uRaw] = await Promise.all([
          env.BIZ_KV.get(globalKey),
          env.BIZ_KV.get(userKey)
        ]);
        const g = gRaw ? JSON.parse(gRaw) : { input: 0, output: 0, calls: 0, cost: 0 };
        const u = uRaw ? JSON.parse(uRaw) : { input: 0, output: 0, calls: 0, cost: 0 };
        g.calls += 1;
        g.cost = (g.cost || 0) + cost;
        g.lastAt = now;
        u.calls += 1;
        u.cost = (u.cost || 0) + cost;
        u.lastAt = now;
        await Promise.all([
          env.BIZ_KV.put(globalKey, JSON.stringify(g)),
          env.BIZ_KV.put(userKey, JSON.stringify(u))
        ]);
      } catch (e) {
      }
    }
    __name(recordFixedCost, "recordFixedCost");
    async function readOfficialStream(response, handle) {
      if (!response.body) throw new Error("官方接口未返回响应流");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      async function line(value) {
        if (!value.startsWith("data:")) return;
        const text = value.slice(5).trim();
        if (!text || text === "[DONE]") return;
        let event;
        try { event = JSON.parse(text); } catch { return; }
        if (event.type === "error" || event.error) throw new Error(event.error?.message || event.message || "官方接口返回流错误");
        await handle(event);
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() || "";
          for (const entry of lines) await line(entry);
        }
        pending += decoder.decode();
        if (pending.trim()) await line(pending);
      } finally { reader.releaseLock(); }
    }
    async function parseAnthropicStream(response) {
      let usage;
      await readOfficialStream(response, async event => {
        if (event.type === "message_start" && event.message?.usage) usage = { ...event.message.usage };
        if (event.type === "message_delta" && event.usage) usage = { ...usage, ...event.usage };
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") await sendChunk(event.delta.text);
        if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") await sendReasoning(event.delta.thinking);
      });
      return usage;
    }
    async function parseGeminiStream(response) {
      let usage;
      await readOfficialStream(response, async event => {
        if (event.usageMetadata) usage = event.usageMetadata;
        for (const part of event.candidates?.[0]?.content?.parts || []) {
          if (part.thought && part.text) await sendReasoning(part.text);
          else if (part.text) await sendChunk(part.text);
        }
      });
      return usage;
    }
    async function parseResponsesStream(response) {
      let usage;
      await readOfficialStream(response, async event => {
        if (event.type === "response.failed") throw new Error(event.response?.error?.message || "官方接口响应失败");
        if (event.type === "response.completed" && event.response?.usage) usage = event.response.usage;
        if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") await sendChunk(event.delta || "");
        if (event.type === "response.reasoning_summary_text.delta") await sendReasoning(event.delta || "");
      });
      return usage;
    }
    function buildAnthropicContent(prompt2, image2, imageMime2) {
      if (!allImages.length) return [{ type: "text", text: prompt2 }];
      const content = allImages.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mime, data: img.data } }));
      content.push({ type: "text", text: prompt2 });
      return content;
    }
    __name(buildAnthropicContent, "buildAnthropicContent");
    function buildGeminiParts(prompt2, image2, imageMime2) {
      if (!allImages.length) return [{ text: prompt2 }];
      const parts = allImages.map((img) => ({ inline_data: { mime_type: img.mime, data: img.data } }));
      parts.push({ text: prompt2 });
      return parts;
    }
    __name(buildGeminiParts, "buildGeminiParts");
    function buildOpenAIResponsesInput(prompt2, image2, imageMime2) {
      if (!allImages.length) return prompt2 || "";
      const content = allImages.map((img) => ({ type: "input_image", image_url: "data:" + img.mime + ";base64," + img.data }));
      content.unshift({ type: "input_text", text: prompt2 || "" });
      return [{ role: "user", content }];
    }
    __name(buildOpenAIResponsesInput, "buildOpenAIResponsesInput");
    async function fetchRetry(url, options) {
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetch(url, { ...options, redirect: "manual" });
        if (response.ok || ![429, 500, 502, 503, 504].includes(response.status)) return response;
        if (attempt === 0) {
          await response.body?.cancel();
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      return response;
    }
    async function getUpstreamError(res, prefix) {
      if (!res) return `${prefix}\uFF1A\u65E0\u54CD\u5E94`;
      let detail = "";
      try {
        const j = await res.json();
        detail = j?.error?.message || j?.error || j?.message || JSON.stringify(j);
      } catch (e1) {
        try {
          detail = await res.text();
        } catch (e2) {
          detail = "";
        }
      }
      if (detail && detail.length > 800) detail = detail.slice(0, 800) + "...";
      return `${prefix}\uFF08HTTP ${res.status}\uFF09${detail ? `\uFF1A${detail}` : ""}`;
    }
    __name(getUpstreamError, "getUpstreamError");
    async function callOfficialChat(config) {
      let endpoint;
      let headers;
      let payload;
      if (config.provider === "anthropic") {
        endpoint = "https://api.anthropic.com/v1/messages";
        headers = { "Content-Type": "application/json", Authorization: "Bearer " + env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" };
        payload = { model, max_tokens: config.maxTokens, stream: true, messages: [{ role: "user", content: buildAnthropicContent(prompt, image, imageMime) }] };
        if (search) payload.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
      } else if (config.provider === "google") {
        endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
        headers = { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY };
        payload = { contents: [{ parts: buildGeminiParts(prompt, image, imageMime) }], generationConfig: { maxOutputTokens: config.maxTokens } };
        if (search) payload.tools = [{ google_search: {} }];
      } else {
        const isXai = config.provider === "xai";
        endpoint = isXai ? "https://api.x.ai/v1/responses" : "https://api.openai.com/v1/responses";
        headers = { "Content-Type": "application/json", Authorization: "Bearer " + env[config.binding] };
        payload = { model, input: buildOpenAIResponsesInput(prompt, image, imageMime), stream: true, store: false, max_output_tokens: config.maxTokens };
        if (search) payload.tools = [{ type: "web_search" }];
      }
      const response = await fetchRetry(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!response?.ok) throw new Error(await getUpstreamError(response, config.provider + " 官方接口请求失败"));
      const usage = config.provider === "anthropic" ? await parseAnthropicStream(response)
        : config.provider === "google" ? await parseGeminiStream(response) : await parseResponsesStream(response);
      if (usage) {
        const input = usage.input_tokens ?? usage.promptTokenCount ?? 0;
        const output = usage.output_tokens ?? usage.candidatesTokenCount ?? 0;
        await recordUsage(model, input, output);
        await sendUsage(input, output);
      }
    }

    function ratioToGptSize(ratio) {
      if (["16:9", "4:3", "3:2", "2:1", "21:9"].includes(ratio)) return "1536x1024";
      if (["9:16", "3:4", "2:3", "1:2"].includes(ratio)) return "1024x1536";
      return ratio === "auto" ? "auto" : "1024x1024";
    }

    async function sendOfficialImages(data, defaultMime) {
      const generated = Array.isArray(data.data) ? data.data : [];
      if (!generated.length) throw new Error("官方接口没有返回图片");
      for (const item of generated) {
        if (!item.b64_json) throw new Error("官方接口没有返回所请求的 Base64 图片");
        await sendImage(item.b64_json, item.mime_type || defaultMime);
      }
    }

    async function callOfficialImage(config) {
      const cleanPrompt = String(prompt || "").trim();
      if (!cleanPrompt) throw new Error("请输入图片描述");
      const task = ["edit", "multi-edit"].includes(body.imageTask) ? body.imageTask : "generation";
      if (task === "edit" && allImages.length < 1) throw new Error("编辑图片需要 1 张参考图");
      if (task === "multi-edit" && (allImages.length < 2 || allImages.length > 5)) throw new Error("多图编辑需要 2–5 张参考图");
      const references = task === "generation" ? [] : allImages.slice(0, task === "edit" ? 1 : 5);
      const count = task === "generation" ? Math.max(1, Math.min(4, Number.parseInt(body.n || 1, 10) || 1)) : 1;
      const ratio = body.aspectRatio || "1:1";
      let endpoint;
      let headers;
      let requestBody;
      if (config.provider === "xai") {
        const quality = ["low", "medium", "auto"].includes(body.quality) ? body.quality : "auto";
        const resolution = ["1k", "2k"].includes(String(body.resolution).toLowerCase()) ? String(body.resolution).toLowerCase() : "1k";
        const payload = { model, prompt: cleanPrompt, aspect_ratio: ratio, resolution, quality, response_format: "b64_json" };
        endpoint = "https://api.x.ai/v1/images/" + (task === "generation" ? "generations" : "edits");
        if (task === "generation") payload.n = count;
        else {
          const images = references.map(source => ({ type: "image_url", url: `data:${source.mime || "image/jpeg"};base64,${source.data}` }));
          if (task === "edit") payload.image = images[0];
          else payload.images = images;
        }
        headers = { "Content-Type": "application/json", Authorization: "Bearer " + env.GROK_API_KEY };
        requestBody = JSON.stringify(payload);
      } else if (config.provider === "openai") {
        const quality = ["low", "medium", "high", "auto"].includes(body.quality) ? body.quality : "auto";
        const fields = { model, prompt: cleanPrompt, n: String(count), size: ratioToGptSize(ratio), quality, output_format: "png", safety_identifier: await hashText(authUser || "anonymous") };
        endpoint = "https://api.openai.com/v1/images/" + (task === "generation" ? "generations" : "edits");
        headers = { Authorization: "Bearer " + env.OPENAI_API_KEY };
        if (task === "generation") {
          headers["Content-Type"] = "application/json";
          requestBody = JSON.stringify({ ...fields, n: count });
        } else {
          requestBody = new FormData();
          for (const [name, value] of Object.entries(fields)) requestBody.append(name, value);
          for (const [index, source] of references.entries()) {
            const bytes = Uint8Array.from(atob(source.data), char => char.charCodeAt(0));
            const mime = source.mime || "image/jpeg";
            requestBody.append("image[]", new Blob([bytes], { type: mime }), "reference-" + index + (mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg"));
          }
        }
      } else {
        endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent";
        headers = { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY };
        const parts = references.map(source => ({ inlineData: { mimeType: source.mime || "image/jpeg", data: source.data } }));
        parts.push({ text: cleanPrompt });
        const imageSize = ["512", "1K", "2K", "4K"].includes(body.imageSize) ? body.imageSize : "1K";
        const payload = { contents: [{ parts }], generationConfig: { responseModalities: body.imageOnly ? ["IMAGE"] : ["TEXT", "IMAGE"], imageConfig: { aspectRatio: ratio, imageSize } } };
        if (["minimal", "high"].includes(body.thinkingLevel)) payload.generationConfig.thinkingConfig = { thinkingLevel: body.thinkingLevel };
        if (search) payload.tools = [{ google_search: {} }];
        requestBody = JSON.stringify(payload);
      }
      // Image generation is never retried automatically: a retry could duplicate billing.
      const response = await fetch(endpoint, { method: "POST", headers, body: requestBody, redirect: "manual" });
      if (!response.ok) throw new Error(await getUpstreamError(response, config.provider + " 官方图片接口请求失败"));
      const data = await response.json();
      if (config.provider === "google") {
        const parts = data.candidates?.[0]?.content?.parts || [];
        let imageCount = 0;
        for (const part of parts) {
          if (part.thought) continue;
          if (part.text && !body.imageOnly) await sendChunk(part.text);
          if (part.inlineData?.data) {
            imageCount++;
            await sendImage(part.inlineData.data, part.inlineData.mimeType || "image/png");
          }
        }
        if (!imageCount) throw new Error("Google 官方接口未返回图片：" + (data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || "请调整描述后重试"));
      } else await sendOfficialImages(data, config.provider === "xai" ? "image/jpeg" : "image/png");
      const usage = data.usageMetadata || data.usage;
      let tokenCallCounted = false;
      if (usage) {
        const input = usage.input_tokens ?? usage.promptTokenCount ?? 0;
        const output = usage.output_tokens ?? usage.candidatesTokenCount ?? 0;
        tokenCallCounted = !!(input || output);
        await recordUsage(model, input, output);
        await sendUsage(input, output);
      }
      const costTicks = Number(data.usage?.cost_in_usd_ticks || 0);
      if (costTicks > 0) {
        const cost = costTicks / 1e10;
        // recordUsage already counts this call when usage tokens are present.
        await recordImageCost(model, cost, tokenCallCounted);
        await sendCost(cost);
      }
    }

    async function recordImageCost(modelId, cost, alreadyCounted) {
      if (!alreadyCounted) return recordFixedCost(modelId, cost);
      try {
        const keys = ["usage:global:official~" + modelId, "usage:user:" + (authUser || "anonymous") + ":official~" + modelId];
        await Promise.all(keys.map(async key => {
          const existing = JSON.parse(await env.BIZ_KV.get(key) || "{}");
          existing.cost = (existing.cost || 0) + cost;
          await env.BIZ_KV.put(key, JSON.stringify(existing));
        }));
      } catch {}
    }

    (async () => {
      try {
        await writer.write(encoder.encode(": connected\n\n"));
        await sendModelName(modelConfig.name);
        if (modelConfig.image) await callOfficialImage(modelConfig);
        else await callOfficialChat(modelConfig);
      } catch (error) {
        let message = String(error.message || "官方接口请求失败");
        for (const binding of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GROK_API_KEY", "GEMINI_API_KEY"]) {
          if (env[binding]) message = message.split(env[binding]).join("[redacted]");
        }
        await sendChunk("\n\n[错误: " + message + "]");
      } finally {
        await sendDone();
        await writer.close();
      }
    })();
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
export { worker_default as default };
