# AI 助手 official API Worker

The browser remains on Cloudflare Pages. `worker.js` serves the existing `ai` Worker at `api.pickandcase.com` and keeps its existing login, chats, memory and KV bindings.

## Project materials

Projects have a saved **按需检索 / 全文阅读** switch, independent of model thinking intensity. Retrieval is the default: SQLite FTS searches this account's current project, and at most three matching excerpts (4,800 characters total) are sent with source filenames and page/row locations. A miss is reported honestly; it never means the whole file was reviewed.

Full reading submits every indexed text segment in batches, then combines the reading notes for the final answer. Progress and additional provider usage are visible. Reading calls use the selected model at Low when supported, without web search or Skills. Completed batches can be reused for an unchanged source revision, question and project context for seven days; cached batches are not billed as fresh calls. After 24 fresh reading calls in one execution window, a resumable progress message replaces the answer: retry continues completed work rather than claiming the unread remainder was processed. Incognito does not persist reading notes; very long incognito reviews require normal mode before any paid reading starts. Reading notes may omit details, and Office charts/images, scanned pages, external links and uncached formulas are not silently treated as parsed text.

New project originals use the private `PROJECT_DOCUMENTS` R2 binding (`ai-assistant-project-files`). Multipart uploads resume acknowledged parts after the original file is reselected. Text extraction runs in a browser worker with acknowledged index batches and no base64 copy of the whole original. PDF, DOCX, XLSX/XLS, additional Office/OpenDocument formats and text/code formats are supported. Project uploads no longer use the old 8 MB / 40 MB / 15-file / 400,000-character / 200-page application limits; actual browser, Worker, R2 and SQLite capacities still apply. ZIP import keeps the existing archive safety bounds; native document-generation tools retain their own per-request original-file limits. Project PDFs first extract their text layer, then use GPT-6.1 Sol to recognize scan-only or low-text image pages, including verifying blank pages. OCR uses high-detail one-page PDF inputs (bounded raster fallback for unusually large pages), caches completed page results, records provider usage, and stops on the first interruption so continuation does not repeat completed paid pages. Failed or uncertain pages remain visibly partial; empty or failed documents never claim completed full reading. Existing R2 originals can be processed again without re-upload, and an atomic replacement index preserves the prior index if a repair fails. The browser must remain open during parsing; after interruption, use Continue recognition to resume from stored originals and cached pages.

Original bytes are downloaded only through authenticated Worker routes. R2 public access stays disabled. Existing KV files remain readable, and project/account authorization precedes original transfer or index access. Soft removal and replacement preserve recoverability. No embedding/model call is made merely to upload or index a file. See [R2 limits](https://developers.cloudflare.com/r2/platform/limits/) and [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

## Provider routes

| Models | API host | Existing secret binding |
| --- | --- | --- |
| Grok 4.7, Grok Imagine Image 2.0 | `api.x.ai` | `GROK_API_KEY` |
| GPT-6 Astra, GPT-6.1 Sol, GPT-5.6 Sol, GPT Image 2.5 Sunburst / Flare | `api.openai.com` | `OPENAI_API_KEY` |
| Claude Fable 5.1, Claude Opus 5.5, Claude Sonnet 5.5 (earlier Opus routes retained for compatibility); memory extraction with the existing Haiku model | `api.anthropic.com` | `ANTHROPIC_API_KEY` |
| Gemini 4 Argon, Nano Banana 2.1 (earlier Gemini image/chat routes retained for compatibility) | `generativelanguage.googleapis.com` | `GEMINI_API_KEY` |

There is no third-party fallback. Missing official keys produce a 503; provider errors reach the page. The Worker no longer references `QUICK`, `JIEKOU_API_KEY`, `HAJIMI_API_KEY` or `MJ_API_KEY`. Existing secret bindings are retained in Cloudflare and do not need to be deleted to stop their use.

The browser model menu offers current Claude Fable 5.1 / Opus 5.5 / Sonnet 5.5, Grok 4.7 and Gemini 4 Argon (`gemini-4-argon`). Gemini 4 understands images but outputs text; image creation uses a separate model. The image menu offers GPT Image 2.5 Sunburst / Flare, Grok Imagine 2.0 and Nano Banana 2.1 (`gemini-nano-banana-2.1`). Old Google image selections upgrade to Nano Banana 2.1; old conversation labels remain readable and old backend routes remain available to cached clients.

OpenAI images use the official Responses image-generation tool with GPT-6.1 Sol as the orchestrator and the selected Sunburst/Flare model in the tool. Provider requests use the same isolated US dispatch already verified for ordinary Sol/Astra conversations. The existing encrypted key and bindings are reused. `store:false` and explicit image/history inputs support continued editing without depending on stored provider responses. No image request is automatically retried.

The OpenAI controls cover generation, single/multiple references, continued edits, painted or imported PNG masks, 1–10 independent variants, 0–3 partial previews, auto/custom dimensions up to the documented 4K pixel limits, all six quality settings, PNG/JPEG/WebP, transparency, compression, and auto/low moderation. Resolution cards retain dimensions and show proportional frames; custom frames update during input and selection uses borders and fill without checkmarks. Supported reference uploads retain their original bytes, dimensions and alpha. App limits remain 10MB per reference, 16MB for a prepared request including history, and 20 prior image turns; oversized context fails before a paid request. The mask is applied to the first current reference, before any historical images, with matching PNG dimensions and an alpha channel.

Partial previews are never stored as finished images. Completed images, revised prompts and generation settings remain available after reload, including when a later variant fails. Image billing is token-based; do not interpret a manually saved per-image price or mainline token usage as the actual image charge. The UI identifies the separate orchestrator usage and directs users to OpenAI billing when image-token charges are unavailable. The API may return fewer previews than requested, and masks guide editing without guaranteeing an exact pixel boundary. See [OpenAI's image guide](https://developers.openai.com/api/docs/guides/image-generation), [Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst) and [Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare).

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

Authenticated text requests may set `maxOutputTokens` to an integer between 32 and the configured model ceiling. Omitting it uses the highest documented budget configured in `arena-token-limits.js`; it cannot increase that ceiling. Token capacity does not change the user's selected reasoning effort.

The read-only `GET /model-limits` endpoint returns the same registry used by the request builder. It starts no generation and reports no credentials or account balances. Official specifications checked on 2026-10-30:

| Selected text models | Context / maximum input | Maximum output |
| --- | --- | --- |
| Claude Opus 5.5, Sonnet 5.5, Fable 5.1, Opus 5 | 1,000,000 shared tokens | 128,000 thinking and text tokens |
| GPT-6 Astra, GPT-6.1 Sol, GPT-5.6 Sol | 1,050,000 shared; input at most 922,000 | 128,000 |
| Grok 4.7 | 500,000 shared | 128,000 documented default; xAI does not publish a separate higher hard ceiling |
| Gemini 3.8 Flash, 3.1 Pro | 1,048,576 input | 65,536 |
| Gemini 4 Argon | 1,048,576 shared | Up to the remaining window, with long decode |

Sources: [Claude context and output](https://platform.claude.com/docs/en/build-with-claude/context-windows), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [Grok context](https://docs.x.ai/developers/models/grok-4.7), [Grok output default](https://docs.x.ai/developers/model-capabilities/text/best-practices), [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [Gemini 3.1 Pro](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview), [Gemini 4 Argon](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon), [long decode](https://ai.google.dev/gemini-api/docs/long-decode).

Argon requests above 65,536 use one background Interactions API request. Google manages its decoding hops; reconnects use only GET on the same interaction and the last event ID, including IDs on status events. Creation is never automatically retried. Output is capped at the shared window minus the counted input and a 1,024-token reserve. At least 65,536 tokens are reserved for output before compacting history. Stop cancels that existing interaction. A Worker restart never recreates it and requests cancellation of the abandoned interaction. Background execution requires provider storage, so incognito keeps the non-stored GenerateContent transport and its 65,536 output limit. Normal background interactions follow Google's retention policy; this site does not silently opt incognito into that storage.

### Thinking effort and progress

Text chat requests opt in to provider-supplied public summaries: Anthropic uses adaptive thinking with `display: "summarized"`, Google Generate Content uses `includeThoughts: true`, and OpenAI Responses uses `reasoning.summary: "auto"`. Grok 4.7 already streams its public summaries; both documented xAI summary event names are accepted. Effort settings retain their selected values. Image request schemas and provider token ceilings are unchanged.

The page expands a received summary while the reply is running, appends it incrementally, and respects manual collapse and scrolling. No summary is fabricated when the provider sends none. The elapsed counter is labeled total time, including preparation and connection waits; after 45 seconds without new model content it says it is waiting for more content. Recovery connections are shown separately. Completed messages retain a collapsible summary, including saved chat and debate replies. Encrypted signatures and opaque reasoning payloads are not displayed.

Official references: [Claude thinking display](https://platform.claude.com/docs/en/build-with-claude/thinking#controlling-thinking-display), [Gemini Generate Content thought summaries](https://ai.google.dev/gemini-api/docs/generate-content/thinking#thought-summaries), [OpenAI reasoning summaries](https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries), and [xAI summarized reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning#summarized-reasoning-content).

Authenticated requests may set `effort`. Claude Fable 5.1, Opus 5.5 and Sonnet 5.5 accept `low`, `medium`, `high`, `xhigh`, and `max`, forwarded as `output_config.effort`. Grok 4.7 accepts `low`, `medium`, `high`, and `xhigh`, forwarded as `reasoning.effort`. Gemini 4 Argon accepts `low`, `medium`, and `high`, forwarded as the uppercase REST enum in `generationConfig.thinkingConfig.thinkingLevel`. Unsupported values are rejected before an upstream request. Omission preserves the provider default, including for cached clients. The browser remembers each model's selection separately and starts at the provider defaults: medium for Opus 5.5 and Gemini 4 Argon, high for Fable 5.1, Sonnet 5.5 and Grok 4.7. Higher effort can use more tokens and take longer; it is not a fixed time or spending budget.

Streaming `status` events reflect provider thinking, web search and answer events. The browser measures elapsed time locally and only displays thinking summaries returned by the provider, in a collapsed details section. It does not synthesize reasoning text or infer a search merely because the search option is enabled.

The shared Markdown renderer keeps currency literal, preserves repeated source lines, supports inline formatting in table cells, and escapes raw HTML. Check it with `node --test arena-markdown.test.cjs` from the repository root, in addition to the Worker tests.

New usage uses immutable, per-request receipts and atomic SQLite totals through the existing `CHAT_RUNS` binding. Input/output counts come from provider usage metadata; there is no character-based estimate or frontend price override. xAI's returned monetary amount is shown as the official amount; other requests show the calculation from the dated public rate card. Cache reads/writes, reasoning, image modalities, search and background Haiku calls are accounted for separately. Missing usage or unresolved Google search fees are shown as pending, never as a free request. Historical `official~` aggregates and old manual-price data remain untouched and are not included in the new totals. See [PRICING.md](PRICING.md).

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

## Projects and full-history-first context

Projects use the existing KV bindings and registered account authentication. Every project metadata, file, index, conversation, summary and memory key includes the account and project ID. Ownership is checked before access; ordinary chat continues to use its existing general keys. Global Skills and general memory are not injected into a project. Archives and removed materials can be restored through the UI.

The browser sends the current branch's complete original text history, including pasted text. The Worker merges it with the owning account's stored originals and respects edit boundaries. There is no eight-message, 7,000-character or per-answer clipping policy. Safely small requests use a conservative byte upper bound; near capacity, native token-counting endpoints check input without starting generation. OpenAI counts use the existing US transport. Only when the request exceeds its model-specific input budget does the Worker replace the oldest complete messages with extractive notes and relevant exact excerpts. It keeps the largest fitting suffix of whole messages; it never silently clips the current question or a long answer. There is no additional paid summarizer call. If counting fails or the current question alone cannot fit, it fails before generation and retains the original. Shared windows reserve output space and 1,024 tokens for framing. Project material retrieval stays selective rather than resending the whole library. The reply disclosure distinguishes full history from compacted history and shows the model capacity. Incognito does not read or write saved chats, memories or summaries. The transport envelope is 24 MiB of question/history JSON and at most 8 MiB of text characters; the actual model budget is checked independently.

Chat attachments and project materials share a file reader for text PDF, DOCX, Excel (XLSX/XLS/XLSM/XLSB/ODS), PPTX, ODT/ODP, Markdown, structured text and source code. UTF-8, BOM-marked UTF-16 and GB18030 text are accepted. ZIP uploads expand in the browser, retain member paths, and explicitly report skipped or unreadable entries. A chat ZIP stays one original attachment for native document processing; project ZIPs store each readable document separately. ZIPs are limited to 20 MB compressed, 100 entries and 100 MB expanded, with CRC, actual-output, traversal and symlink checks. Nested ZIPs must be uploaded separately. Chat attachment text is limited to 40,000 characters per round to fit the existing request contract. Native document-tool transport remains limited to five files and 20 MiB per round. The legacy KV project-upload compatibility endpoint retains 400,000 characters, 15 active files and 100 MiB total; the new R2 project-upload path does not impose those application limits. Scanned project PDFs are recognized by GPT-6.1 Sol; chat attachment extraction still requires a readable text layer or the separate native document flow. Original files are retained for download and their text can open in a right-hand pane. The Worker uses a lexical term index to retrieve up to three relevant 1,600-character chunks. It does not load the original file for model retrieval or transmit the full project library every turn. Reworded queries or missing extracted text can cause a missed match.

The frontend consumes upstream SSE text events immediately and coalesces DOM rendering only to the next animation frame. It does not add a simulated typewriter queue. The stream sets `no-transform` and identity encoding; provider thinking/search latency is still visible before text begins. Stop aborts the client stream and upstream fetch; it cannot undo tokens already generated by the provider.

## Mobile connection recovery

Ordinary signed-in text chats use authenticated `POST /chat-runs` actions (`start`, `events`, `status`, `stop`). The `CHAT_RUNS` SQLite Durable Object owns one generation per account/project/chat, independently of the phone's streaming subscription. A stable request ID makes lost start acknowledgements idempotent. Each response event has a monotonic ID; reconnection replays only unseen events. Ten-second heartbeats cover long thinking/search gaps. Returning to the foreground or restoring connectivity reconnects the observer; it does not send the question to the model again. Only the explicit Stop action cancels the running provider request.

OpenAI chat generations start in the existing Durable Object's alarm handler, rather than inheriting the initiating browser request's execution context. Live verification on this deployment confirmed both GPT-6 Astra and GPT-6.1 Sol replies through this path after HTTP-initiated calls returned a region error. The queued payload stays in memory; no account credential or provider key is stored with the alarm. Stopping before dispatch makes no provider request, duplicate alarms do not repeat a generation, and a process restart reports interruption instead of replaying a paid call. Existing chat IDs, bindings and other providers' dispatch paths are preserved.

The prepared OpenAI Responses request is additionally dispatched by a fresh, private US-jurisdiction object through the same `CHAT_RUNS` binding. The caller consumes the enqueue response and waits for provider headers before opening the private response stream; public chat observers never subscribe to this object. This covers ordinary saved chats and legacy direct Responses requests as well as incognito and debate calls; merely deferring the original conversation object was insufficient in live ordinary-chat verification. Provider status and SSE bytes are preserved, header waits are bounded, cancellation aborts the provider, and an ambiguous transport failure is not automatically replayed. Prepared prompts, API keys and private response buffers are never written to this object's storage. The existing conversation objects and saved history remain in place.

The server saves the question and answer placeholder before calling the provider, checkpoints partial output in its original chat, and saves terminal output and citations even if the phone stays offline. A reloaded signed-in page can reopen the pending chat using a session-local pointer containing IDs only and follow its saved progress. Normal tasks retain their recovery log for 24 hours; their ordinary chat history is retained as before. Incognito bodies and recovery events remain in memory only and do not create saved chats. Account password hashes and API keys are never persisted in task storage.

Chat generation no longer has a fixed 14-minute wall-clock cutoff. Thinking can continue until the provider finishes or the user explicitly stops it; upstream failures and the per-run 64 MiB recovery-log bound still terminate a run. Long replies are stored in Unicode-safe 64,000-character metadata rows to stay below SQLite row limits; archived runs retain their own chunks. Provider token limits and Cloudflare runtime limits still apply. A process restart marks the run interrupted and never repeats a potentially paid request automatically. Chat runs also disable automatic retries of retryable provider HTTP responses: starting a new attempt requires an explicit user action.

Starting another run in the same chat atomically archives the previous run's metadata and events by `runId`. Authenticated `status`, `events` and `stop` requests for that old ID read its own record; stopping an old run cannot stop the current one. Repeating an old `start` returns the old result rather than issuing another provider call. Recovery records expire separately, 24 hours after each run's last terminal update; retries neither reset that retention period nor erase other runs early. Ordinary chat history remains independent of recovery-log expiry. Existing single-run SQLite records are upgraded in place. This change does not recreate logs already overwritten by older versions. Incognito runs are not archived, and credentials are never saved in these tables.

New events have server receipt timestamps. Saved replies retain the first/last reasoning and text times, provider request ID when supplied, and Claude's stop reason and message-stop signal. Claude usage is checkpointed as it arrives, marked `partial: true` until final usage is received; a cancelled run's partial count is not a final bill. Aggregate usage is recorded only once on successful completion.

The old direct SSE routes remain compatible; image generation and multi-round debate still use those routes. Project ownership, authentication, model/effort settings, memory boundaries, KV namespaces and placement are unchanged.

Run the combined backend/frontend regression suite without network access from the repository root:

```sh
npm run test:offline
```

The guard blocks fetch, HTTP/HTTPS, TCP/TLS, HTTP/2 and WebSocket connections unless a test explicitly replaces them with an in-process fixture. Tests advance a virtual clock beyond 14 minutes; they do not spend 14 real minutes or call a paid model. They verify completion, Stop, failed-run replay after retry/restart, per-run expiry, atomic rollback, account/project boundaries and incognito storage. These are offline logic checks, not a claim of real-model production acceptance.

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

Legacy/chat large-upload handling (20261030-upload20m1): each source document or ZIP can be up to 20 MiB. The new standalone R2 project uploader described above is independent of this limit. Large project originals are stored as bounded base64 segments with a manifest written last, preserving legacy originals. Previews read metadata only; downloads stream the original JSON field in bounded segments. Native document uploads stream multipart data and recoverable chat execution reuses its in-memory payload to avoid extra complete-file body copies.
