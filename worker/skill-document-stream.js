// Assemble the exact provider message for pause_turn while exposing only public
// text/thinking summaries. Tool inputs and thinking signatures stay server-side.
export async function readDocumentMessage(response, { message, signal, onBlock, onText, onThinking, onMeta }) {
  if (response.headers.get('content-type')?.includes('application/json')) {
    Object.assign(message, await response.json());
    for (const block of message.content || []) {
      await onBlock(block);
      if (block.type === 'text') await onText(block, true);
      if (block.type === 'thinking' && block.thinking) await onThinking(block.thinking);
    }
    message.complete = true;
    await onMeta(message);
    return;
  }
  if (!response.body) throw Error('Claude 官方文档接口未返回响应流，未自动重试。');
  const reader = response.body.getReader(), decoder = new TextDecoder(), inputs = new Map();
  const incomplete = () => Error('Claude 官方文档连接中断，已保留收到的内容，未自动重试，以免重复计费。');
  const limit = 8 * 1024 * 1024;
  let buffer = '', lines = [], size = 0;
  const abort = () => { reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  async function event(value) {
    if (value.type === 'error' || value.error) {
      const detail = String(value.error?.message || '上游处理失败').replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]').slice(0, 300);
      throw Error('Claude 官方文档流返回错误：' + detail + '。已保留收到的内容，未自动重试。');
    }
    if (value.type === 'message_start') {
      Object.assign(message, value.message, { content: [] });
      await onMeta(message);
    } else if (value.type === 'content_block_start') {
      if (!Number.isInteger(value.index) || value.index < 0 || value.index > 4096 || !value.content_block?.type) throw incomplete();
      const block = structuredClone(value.content_block);
      message.content[value.index] = block;
      await onBlock(block);
      if (block.type === 'text') await onText(block, false);
      if (block.type === 'thinking' && block.thinking) await onThinking(block.thinking);
    } else if (value.type === 'content_block_delta') {
      const block = message.content[value.index], delta = value.delta;
      if (!block || !delta) throw incomplete();
      if (delta.type === 'text_delta') {
        block.text = (block.text || '') + delta.text;
        await onText(block, false);
      } else if (delta.type === 'thinking_delta') {
        block.thinking = (block.thinking || '') + delta.thinking;
        await onThinking(delta.thinking);
      } else if (delta.type === 'signature_delta') block.signature = (block.signature || '') + delta.signature;
      else if (delta.type === 'input_json_delta') inputs.set(value.index, (inputs.get(value.index) || '') + delta.partial_json);
      else if (delta.type === 'citations_delta') (block.citations ||= []).push(delta.citation);
    } else if (value.type === 'content_block_stop') {
      const block = message.content[value.index];
      if (!block) throw incomplete();
      if (inputs.has(value.index)) {
        try { block.input = JSON.parse(inputs.get(value.index)); } catch { throw incomplete(); }
        inputs.delete(value.index);
      }
      if (block.type === 'text') await onText(block, true);
    } else if (value.type === 'message_delta') {
      Object.assign(message, value.delta);
      if (value.container) message.container = value.container;
      if (value.usage) {
        const previous = message.usage || {};
        message.usage = { ...previous, ...value.usage };
        // Counts are cumulative; merge nested counters, never sum snapshots.
        for (const key of ['cache_creation', 'server_tool_use']) if (previous[key] && value.usage[key]) message.usage[key] = { ...previous[key], ...value.usage[key] };
      }
      await onMeta(message);
    } else if (value.type === 'message_stop') {
      if (!message.stop_reason || inputs.size) throw incomplete();
      message.complete = true;
      await onMeta(message);
    } else if (value.type === 'ping') await onMeta({ ping: true });
    // Unknown future event types are intentionally ignored.
  }
  async function line(value) {
    if (!value) {
      if (lines.length) {
        const raw = lines.join('\n'); lines = []; size = 0;
        if (raw !== '[DONE]') {
          let item; try { item = JSON.parse(raw); } catch { throw incomplete(); }
          await event(item);
        }
      }
    } else if (value.startsWith('data:')) {
      const data = value.slice(5).trimStart(); size += data.length;
      if (size > limit) throw incomplete();
      lines.push(data);
    }
  }
  try {
    while (!message.complete) {
      signal?.throwIfAborted();
      const part = await reader.read();
      signal?.throwIfAborted();
      buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
      const ready = buffer.split(/\r?\n/); buffer = ready.pop();
      for (const value of ready) { await line(value); if (message.complete) break; }
      if (buffer.length > limit) throw incomplete();
      if (part.done) { if (buffer) await line(buffer); await line(''); break; }
    }
    if (!message.complete) throw incomplete();
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
