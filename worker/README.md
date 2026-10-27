# AI 助手 official API Worker

The browser remains on Cloudflare Pages. `worker.js` serves the existing `ai` Worker at `api.pickandcase.com` and keeps its existing login, chats, memory and KV bindings.

## Provider routes

| Models | API host | Existing secret binding |
| --- | --- | --- |
| Grok 4.7, Grok Imagine Image 2.0 | `api.x.ai` | `GROK_API_KEY` |
| GPT-6 Astra, GPT-5.6 Sol, GPT Image 2.5 Sunburst | `api.openai.com` | `OPENAI_API_KEY` |
| Claude Opus 5.5, Claude Sonnet 5.5 (earlier Fable/Opus routes retained for compatibility); memory extraction with the existing Haiku model | `api.anthropic.com` | `ANTHROPIC_API_KEY` |
| Gemini 4 Argon, Gemini 3.1 Flash Image (earlier Gemini 3 chat routes retained for compatibility) | `generativelanguage.googleapis.com` | `GEMINI_API_KEY` |

There is no third-party fallback. Missing official keys produce a 503; provider errors reach the page. The Worker no longer references `QUICK`, `JIEKOU_API_KEY`, `HAJIMI_API_KEY` or `MJ_API_KEY`. Existing secret bindings are retained in Cloudflare and do not need to be deleted to stop their use.

The browser model menu uses a deployment allowlist for Claude, Grok and Gemini 4 Argon (`gemini-4-argon`). Gemini 4 supports image understanding with text output; it does not generate images. The image menu separately offers Grok Image 2.0 and Gemini 3.1 Flash Image, including generation, single-image editing and 2–5 reference image editing. Gemini image settings forward 512px/1K/2K/4K resolution, aspect ratio, thinking level and image-only output to the existing official Google route. Historical conversation labels remain readable for compatibility. Cached requests using `grok-4.6` upgrade to `grok-4.7`; returned model names and new usage records identify 4.7. Earlier Claude and Gemini 3 backend routes remain available for compatibility.

Midjourney has no generally available public official API. It is not shown in the active model menu. The already inactive legacy Kling route remains unavailable until an official integration and its credentials are configured.

## Deployment and verification

1. Check that each official account and its server region are supported by its provider.
2. Deploy the backend before publishing the changed browser page. The Wrangler configuration preserves the Worker name, custom domain, compatibility date, secrets and both existing KV namespaces, and retains the user-authorized US placement.
3. Verify model-list authentication from the actual deployed environment. The root GET response reports **key presence only**, not successful authentication or available credit.
4. Check text streaming, image generation/editing, and existing chat/memory functions. Do not infer a successful generation from a successful model-list request.
5. Publish the browser page after backend verification.

Authenticated text requests may set `maxOutputTokens` to an integer between 32 and the configured model ceiling. Omitting it retains the existing model default; it cannot increase that ceiling.

### Thinking effort and progress

Authenticated requests may set `effort`. Claude Opus 5.5 and Sonnet 5.5 accept `low`, `medium`, `high`, `xhigh`, and `max`, forwarded as `output_config.effort`. Grok 4.7 accepts `low`, `medium`, `high`, and `xhigh`, forwarded as `reasoning.effort`. Gemini 4 Argon accepts `low`, `medium`, and `high`, forwarded as `generationConfig.thinkingConfig.thinkingLevel`. Unsupported values are rejected before an upstream request. Omission preserves the provider default, including for cached clients. The browser remembers each model's selection separately and starts at the provider defaults: medium for Opus 5.5 and Gemini 4 Argon, high for Sonnet 5.5 and Grok 4.7. Higher effort can use more tokens and take longer; it is not a fixed time or spending budget.

Streaming `status` events reflect provider thinking, web search and answer events. The browser measures elapsed time locally and only displays thinking summaries returned by the provider, in a collapsed details section. It does not synthesize reasoning text or infer a search merely because the search option is enabled.

The shared Markdown renderer keeps currency literal, preserves repeated source lines, supports inline formatting in table cells, and escapes raw HTML. Check it with `node --test arena-markdown.test.cjs` from the repository root, in addition to the Worker tests.

New usage records include `official~` in their model key so earlier aggregate records are not reclassified as official traffic. Earlier records remain in place. Per-message cost amounts remain estimates, not provider billing records. Manual credit pools and cost settings have been removed; their old stored data is left untouched.

Run the offline routing and streaming tests with:

```sh
node --test arena-models.test.cjs arena-markdown.test.cjs worker/worker.test.mjs
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

The public login and display name is `Oakley`. Existing sessions normalize the legacy name without changing their password hash. If `user:oakley` is absent, requests using Oakley resolve to the existing account and its historical KV keys. A separately registered Oakley account takes precedence to avoid account collisions. No credential records are rewritten.

## Projects and bounded context

Projects use the existing KV bindings and registered account authentication. Every project metadata, file, index, conversation, summary and memory key includes the account and project ID. Ownership is checked before access; ordinary chat continues to use its existing general keys. Global Skills and general memory are not injected into a project. Archives and removed materials can be restored through the UI.

The new browser sends one current question, up to eight recent messages and at most 7,000 recent characters. The Worker combines that bounded recent context with the stored original conversation. It condenses older portions incrementally (up to 12,000 source characters and 800 summary output tokens per pass), then retrieves up to three exact older excerpts with a total limit of 2,200 characters. Summary coverage is fingerprinted so editing an older branch does not reuse a stale summary. Summarization uses the existing official Haiku route; failure uses a clearly labeled extractive note. The original chat records are retained, including beyond the old 50-chat limit. This is lossy context selection, not a claim that every request is equivalent to resending all history. The reply's context disclosure shows which sources were included. Incognito requests do not read or write saved chats, memories or summaries.

Project material uploads accept Word, text PDF, Excel, PPTX, text and common structured-text files. The browser extracts text; scanned PDFs require OCR before upload. Limits are 8 MB per file, 400,000 extracted characters, 15 active files and 40 MB of active files per project. Original files are retained for download and their text can open in a right-hand pane. The Worker uses a lexical term index to retrieve up to three relevant 1,600-character chunks. It does not load the original file for model retrieval, transmit the full project library every turn, or pretend that this is semantic search. Reworded queries or missing extracted text can cause a missed match.

The frontend consumes upstream SSE text events immediately and coalesces DOM rendering only to the next animation frame. It does not add a simulated typewriter queue. The stream sets `no-transform` and identity encoding; provider thinking/search latency is still visible before text begins. Stop aborts the client stream and upstream fetch; it cannot undo tokens already generated by the provider.

Run all offline routing, context, isolation, file and incremental-stream checks from the repository root:

```sh
npm --prefix worker test
```

`arena-context.js` is the canonical shared context implementation. Run `node worker/sync-shared-context.mjs` after changing it; the test script verifies that the single-file Worker copy matches.
