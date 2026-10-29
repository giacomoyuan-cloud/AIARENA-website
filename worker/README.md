# AI 助手 official API Worker

The browser remains on Cloudflare Pages. `worker.js` serves the existing `ai` Worker at `api.pickandcase.com` and keeps its existing login, chats, memory and KV bindings.

## Provider routes

| Models | API host | Existing secret binding |
| --- | --- | --- |
| Grok 4.7, Grok Imagine Image 2.0 | `api.x.ai` | `GROK_API_KEY` |
| GPT-6 Astra, GPT-6.1 Sol, GPT-5.6 Sol, GPT Image 2.5 Sunburst | `api.openai.com` | `OPENAI_API_KEY` |
| Claude Fable 5.1, Claude Opus 5.5, Claude Sonnet 5.5 (earlier Opus routes retained for compatibility); memory extraction with the existing Haiku model | `api.anthropic.com` | `ANTHROPIC_API_KEY` |
| Gemini 4 Argon, Nano Banana 2.1 (earlier Gemini image/chat routes retained for compatibility) | `generativelanguage.googleapis.com` | `GEMINI_API_KEY` |

There is no third-party fallback. Missing official keys produce a 503; provider errors reach the page. The Worker no longer references `QUICK`, `JIEKOU_API_KEY`, `HAJIMI_API_KEY` or `MJ_API_KEY`. Existing secret bindings are retained in Cloudflare and do not need to be deleted to stop their use.

The browser model menu offers current Claude Fable 5.1 / Opus 5.5 / Sonnet 5.5, Grok 4.7 and Gemini 4 Argon (`gemini-4-argon`). Gemini 4 understands images but outputs text; image creation uses a separate model. The image menu offers Grok Imagine 2.0 and Nano Banana 2.1 (`gemini-nano-banana-2.1`). Old Google image selections upgrade to Nano Banana 2.1; old conversation labels remain readable and old backend routes remain available to cached clients.

Nano Banana 2.1 forwards 1K/2K/4K, 14 aspect ratios, minimal/medium/high thinking (medium default), text+image or image-only output, and explicit off/web/image/web+image Google grounding. It does not expose 512px. Up to 14 references are supported; Grok supports 5. Current generation is limited by this website to 4 images for Grok and one image for Google; edit tasks return one image. Unsupported settings fail before a provider call, rather than silently changing size, quality or effort. Uploading references changes the browser task to edit/multi-edit instead of silently dropping those references.

Grok uses native `aspect_ratio`, `resolution` (1k/2k), `quality` (auto/low/medium), `n` and image/images edit fields. All 16 documented ratios are exposed. The November 2 retirement applies to the old `grok-imagine-image-quality` slug, not the quality parameter on Imagine 2.0.

Google edits preserve role/parts history and exact thought signatures. Response image bytes are stored once in `imgItems`; compact signed parts refer to them by index. The next edit rebuilds the native history. Each scope retains its own pending image edit; loading another chat clears that pointer. Incognito keeps this context in memory only and does not save it to chat storage. More than 20 prior image turns returns an explicit error; it does not silently truncate signed context. Grounded results expose containing-page attribution and Google's search suggestions in a sandboxed, scriptless iframe. Thinking token counts are included in Google output usage. No automatic image generation retries are performed.

See [the dated model/settings audit](../MODEL_SETTINGS_AUDIT.md) for official references and verification boundaries.

Midjourney has no generally available public official API. It is not shown in the active model menu. The already inactive legacy Kling route remains unavailable until an official integration and its credentials are configured.

## Deployment and verification

1. Check that each official account and its server region are supported by its provider.
2. Deploy the backend before publishing the changed browser page. The Wrangler configuration preserves the Worker name, custom domain, compatibility date, secrets and both existing KV namespaces, and retains the user-authorized US placement.
3. Verify model-list authentication from the actual deployed environment. The root GET response reports **key presence only**, not successful authentication or available credit.
4. Check text streaming, image generation/editing, and existing chat/memory functions. Do not infer a successful generation from a successful model-list request.
5. Publish the browser page after backend verification.

Authenticated text requests may set `maxOutputTokens` to an integer between 32 and the configured model ceiling. Omitting it retains the existing model default; it cannot increase that ceiling.

### Thinking effort and progress

Text chat requests opt in to provider-supplied public summaries: Anthropic uses adaptive thinking with `display: "summarized"`, Google Generate Content uses `includeThoughts: true`, and OpenAI Responses uses `reasoning.summary: "auto"`. Grok 4.7 already streams its public summaries; both documented xAI summary event names are accepted. Effort settings retain their selected values. Image request schemas and provider token ceilings are unchanged.

The page expands a received summary while the reply is running, appends it incrementally, and respects manual collapse and scrolling. No summary is fabricated when the provider sends none. The elapsed counter is labeled total time, including preparation and connection waits; after 45 seconds without new model content it says it is waiting for more content. Recovery connections are shown separately. Completed messages retain a collapsible summary, including saved chat and debate replies. Encrypted signatures and opaque reasoning payloads are not displayed.

Official references: [Claude thinking display](https://platform.claude.com/docs/en/build-with-claude/thinking#controlling-thinking-display), [Gemini Generate Content thought summaries](https://ai.google.dev/gemini-api/docs/generate-content/thinking#thought-summaries), [OpenAI reasoning summaries](https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries), and [xAI summarized reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning#summarized-reasoning-content).

Authenticated requests may set `effort`. Claude Fable 5.1, Opus 5.5 and Sonnet 5.5 accept `low`, `medium`, `high`, `xhigh`, and `max`, forwarded as `output_config.effort`. Grok 4.7 accepts `low`, `medium`, `high`, and `xhigh`, forwarded as `reasoning.effort`. Gemini 4 Argon accepts `low`, `medium`, and `high`, forwarded as the uppercase REST enum in `generationConfig.thinkingConfig.thinkingLevel`. Unsupported values are rejected before an upstream request. Omission preserves the provider default, including for cached clients. The browser remembers each model's selection separately and starts at the provider defaults: medium for Opus 5.5 and Gemini 4 Argon, high for Fable 5.1, Sonnet 5.5 and Grok 4.7. Higher effort can use more tokens and take longer; it is not a fixed time or spending budget.

Streaming `status` events reflect provider thinking, web search and answer events. The browser measures elapsed time locally and only displays thinking summaries returned by the provider, in a collapsed details section. It does not synthesize reasoning text or infer a search merely because the search option is enabled.

The shared Markdown renderer keeps currency literal, preserves repeated source lines, supports inline formatting in table cells, and escapes raw HTML. Check it with `node --test arena-markdown.test.cjs` from the repository root, in addition to the Worker tests.

New usage records include `official~` in their model key so earlier aggregate records are not reclassified as official traffic. Earlier records remain in place. Per-message cost amounts remain estimates, not provider billing records. Manual credit pools and cost settings have been removed; their old stored data is left untouched.

Run the offline routing and streaming tests with:

```sh
node --test arena-*.test.cjs worker/*.test.mjs
```

These tests mock provider responses and do not charge any provider account. Never commit API key values or local `.dev.vars` files.

Cloudflare placement labels such as `aws:us-east-1` are geographic references for Cloudflare's own data centers. They do not move the Worker into AWS or require an AWS account. The current configuration retains the US placement authorized by the user. Placement alone does not establish that a provider accepts requests.

### Optional OpenAI transport through Cloudflare AI Gateway

The default OpenAI transport calls `api.openai.com`. The optional `OPENAI_GATEWAY_ID` setting uses the existing OpenAI key through the Worker's Cloudflare `AI` binding. Creating the gateway and adding that binding require authorization and are not configured automatically by this source change.

The gateway must require authentication. The Worker requests no request/response logging, no cache, no automatic gateway retries, and no fallback to Cloudflare-managed provider credentials (`cf-aig-no-wholesale: true`). Responses streaming and image multipart uploads retain the provider's native schema. A missing binding or provider rejection produces an error; the Worker never falls back to an aggregator.

The native binding transport follows [Cloudflare's official Agents SDK implementation](https://github.com/cloudflare/agents/blob/main/packages/agents/src/models/core/transport.ts).

## Official references

- [OpenAI Responses streaming](https://developers.openai.com/api/docs/guides/migrate-to-responses#7-update-streaming-consumers)
- [OpenAI image generation and editing](https://developers.openai.com/api/docs/guides/image-generation)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Grok reasoning effort](https://docs.x.ai/developers/model-capabilities/text/reasoning)
- [xAI Responses](https://docs.x.ai/developers/rest-api-reference/inference/chat)
- [xAI image request settings](https://docs.x.ai/developers/model-capabilities/images/prompting-guide)
- [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini 4 Argon API and thinking levels](https://ai.google.dev/gemini-api/docs/generate-content/latest-model)
- [Cloudflare placement](https://developers.cloudflare.com/workers/configuration/placement/)
- [Midjourney API availability](https://docs.midjourney.com/hc/en-us/articles/32013696484109-Community-Guidelines)

## Source and activity rendering

Anthropic search queries/results and citation deltas, and Responses search items/URL annotations, are forwarded as separate metadata. Only HTTP(S) source URLs without embedded credentials are linked. Encrypted search content and encrypted citation indexes are omitted. The client stores citation and public activity metadata with the message and renders source chips, focus/hover preview cards, and expandable activity rows. Source previews use returned metadata and do not fetch arbitrary websites. Existing cached clients may ignore the additional stream fields.

## Account display and login name

The initial public login and display name is `Oakley`. If `user:oakley` is absent, Oakley resolves to the existing account's historical KV keys. A separately registered Oakley account takes precedence. Account storage IDs never change when the public login name changes.

The left account menu opens 账号设置. A signed-in user can upload a square avatar, set a separate display name, rename their login, or set a new password without an additional verification step. Leaving the password field empty preserves the password. `POST /account` authenticates the existing account on both reads and writes. The browser hashes a new password before sending it and updates its current session only after success. Old password hashes no longer authenticate after replacement. Only the current public login is accepted by `/auth` after a rename; stable account IDs continue to identify existing authenticated sessions and all historical data. Login aliases remain reserved to their original owner, including retired aliases, and collisions are rejected. These KV-backed name reservations are not a globally transactional username registry; KV's propagation behavior applies.

Display names and avatar data are stored in a separate account profile in BIZ_KV. Avatars accept PNG, JPEG or WebP source files up to 5 MB, crop to a square and re-encode at 256 pixels in the browser. The Worker rejects external image URLs, SVG, invalid signatures and oversized payloads. Profile responses never include password hashes. No model calls, email/SMS checks, account-data migration or extra service bindings are involved.

## Projects and bounded context

Projects use the existing KV bindings and registered account authentication. Every project metadata, file, index, conversation, summary and memory key includes the account and project ID. Ownership is checked before access; ordinary chat continues to use its existing general keys. Global Skills and general memory are not injected into a project. Archives and removed materials can be restored through the UI.

The new browser sends one current question, up to eight recent messages and at most 7,000 recent characters. The Worker combines that bounded recent context with the stored original conversation. It condenses older portions incrementally (up to 12,000 source characters and 800 summary output tokens per pass), then retrieves up to three exact older excerpts with a total limit of 2,200 characters. Summary coverage is fingerprinted so editing an older branch does not reuse a stale summary. Summarization uses the existing official Haiku route; failure uses a clearly labeled extractive note. The original chat records are retained, including beyond the old 50-chat limit. This is lossy context selection, not a claim that every request is equivalent to resending all history. The reply's context disclosure shows which sources were included. Incognito requests do not read or write saved chats, memories or summaries.

Project material uploads accept Word, text PDF, Excel, PPTX, text and common structured-text files. The browser extracts text; scanned PDFs require OCR before upload. Limits are 8 MB per file, 400,000 extracted characters, 15 active files and 40 MB of active files per project. Original files are retained for download and their text can open in a right-hand pane. The Worker uses a lexical term index to retrieve up to three relevant 1,600-character chunks. It does not load the original file for model retrieval, transmit the full project library every turn, or pretend that this is semantic search. Reworded queries or missing extracted text can cause a missed match.

The frontend consumes upstream SSE text events immediately and coalesces DOM rendering only to the next animation frame. It does not add a simulated typewriter queue. The stream sets `no-transform` and identity encoding; provider thinking/search latency is still visible before text begins. Stop aborts the client stream and upstream fetch; it cannot undo tokens already generated by the provider.

## Mobile connection recovery

Ordinary signed-in text chats use authenticated `POST /chat-runs` actions (`start`, `events`, `status`, `stop`). The `CHAT_RUNS` SQLite Durable Object owns one generation per account/project/chat, independently of the phone's streaming subscription. A stable request ID makes lost start acknowledgements idempotent. Each response event has a monotonic ID; reconnection replays only unseen events. Ten-second heartbeats cover long thinking/search gaps. Returning to the foreground or restoring connectivity reconnects the observer; it does not send the question to the model again. Only the explicit Stop action cancels the running provider request.

OpenAI chat generations start in the existing Durable Object's alarm handler, rather than inheriting the initiating browser request's execution context. Live verification on this deployment confirmed both GPT-6 Astra and GPT-6.1 Sol replies through this path after HTTP-initiated calls returned a region error. The queued payload stays in memory; no account credential or provider key is stored with the alarm. Stopping before dispatch makes no provider request, duplicate alarms do not repeat a generation, and a process restart reports interruption instead of replaying a paid call. Existing chat IDs, bindings and other providers' dispatch paths are preserved.

The server saves the question and answer placeholder before calling the provider, checkpoints partial output in its original chat, and saves terminal output and citations even if the phone stays offline. A reloaded signed-in page can reopen the pending chat using a session-local pointer containing IDs only and follow its saved progress. Normal tasks retain their recovery log for 24 hours; their ordinary chat history is retained as before. Incognito bodies and recovery events remain in memory only and do not create saved chats. Account password hashes and API keys are never persisted in task storage.

Each generation has a 14-minute ceiling within the Durable Object background lifetime. A server process restart preserves recorded events and marks the task interrupted rather than automatically repeating a potentially paid model call. The old direct SSE routes remain compatible and gain heartbeats; image generation and multi-round debate still use those routes. Existing project ownership, account authentication, provider routing, model/effort settings, memory boundaries, KV namespaces and placement are unchanged.

Deploy the Worker with `worker/wrangler.jsonc` before publishing the new frontend. The configuration adds only the `CHAT_RUNS` binding and the `chat-runs-v1` SQLite class migration. Preserve existing secret values and bindings. Verify observer cancellation, loss of a start acknowledgement, duplicate event replay, background/foreground, reload, explicit Stop, account/project isolation and incognito storage with the included recovery tests. Physical iPhone suspension still requires hardware acceptance; responsive browser dimensions are not device proof.

Run all offline routing, context, isolation, file and incremental-stream checks from the repository root:

```sh
npm --prefix worker test
```

`arena-context.js` is the canonical shared context implementation. Run `node worker/sync-shared-context.mjs` after changing it; the test script verifies that the single-file Worker copy matches.

## Input composition and prompt inspection

The composer and login fields ignore Enter actions during IME composition, including Safari's composition-end-before-keydown sequence with key code 229. Shift+Enter and mobile Enter retain newline behavior.

The account menu's “提示词与记忆” dialog edits the current scope's system prompt and shows its memory separately. `POST /system-prompt` supports authenticated `get`, `save` and `reset`; prompts are nonempty text of up to 12,000 UTF-16 code units. General prompts use an account key in BIZ_KV; project prompts use an owned-project key. The Worker reads the saved prompt for every subsequent scoped chat, including incognito, and supplies it to each official provider's system/instructions field. A saved general prompt replaces the browser's ordinary default; explicitly selected Skills/coding modes supplement it. Projects ignore general prompts and Skills, retain their isolation rule, and append their project instructions. Reset affects only the requested prompt key. Existing memories, project instructions and account credentials are unchanged. Reading or saving settings makes no model call. This is a view of current settings, not a stored full-request snapshot; recent messages, old summaries, retrieved excerpts, material fragments and provider tool descriptions can also contribute to an actual request.

Project and chat pins use separate per-account KV keys, so setting a pin does not rewrite the project catalog or conversation content. Authenticated `POST /projects` and `POST /chats` accept `action: "pin"`, a resource ID and a boolean `pinned`; list responses add `pinned: true` only to pinned entries. Chat pins are scoped to the general conversation list or their owning project. The frontend keeps separate temporary in-memory project lists per account while refreshing them. KV is eventually consistent across locations, so a pin may take time to appear in another region.
