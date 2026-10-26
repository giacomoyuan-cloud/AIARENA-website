# AI Arena official API Worker

The browser remains on Cloudflare Pages. `worker.js` serves the existing `ai` Worker at `api.pickandcase.com` and keeps its existing login, chats, memory, price settings and KV bindings.

## Provider routes

| Models | API host | Existing secret binding |
| --- | --- | --- |
| Grok 4.6, Grok Imagine Image 2.0 | `api.x.ai` | `GROK_API_KEY` |
| GPT-6 Astra, GPT-5.6 Sol, GPT Image 2.5 Sunburst | `api.openai.com` | `OPENAI_API_KEY` |
| Claude Fable 5.1, Claude Opus 5; memory extraction with the existing Haiku model | `api.anthropic.com` | `ANTHROPIC_API_KEY` |
| Gemini 3.8 Flash, Gemini 3.1 Pro, Gemini 3.1 Flash Image | `generativelanguage.googleapis.com` | `GEMINI_API_KEY` |

There is no third-party fallback. Missing official keys produce a 503; provider errors reach the page. The Worker no longer references `QUICK`, `JIEKOU_API_KEY`, `HAJIMI_API_KEY` or `MJ_API_KEY`. Existing secret bindings are retained in Cloudflare and do not need to be deleted to stop their use.

Midjourney has no generally available public official API. Its option is disabled instead of being sent through a third party. The already inactive legacy Kling route remains unavailable until an official integration and its credentials are configured.

## Deployment and verification

1. Check that each official account and its server region are supported by its provider.
2. Deploy the backend before publishing the changed browser page. The Wrangler configuration preserves the Worker name, custom domain, compatibility date, secrets and both existing KV namespaces. It does not request a placement change. Verify production behavior before deciding whether any server-region change is necessary.
3. Verify model-list authentication from the actual deployed environment. The root GET response reports **key presence only**, not successful authentication or available credit.
4. Check text streaming, image generation/editing, and existing chat/memory functions. Do not infer a successful generation from a successful model-list request.
5. Publish the browser page after backend verification.

New usage records include `official~` in their model key so earlier aggregate records are not reclassified as official traffic. Earlier records remain in place. User-entered prices remain estimates; this migration does not replace provider billing records.

Run the offline routing and streaming tests with:

```sh
node --test worker/worker.test.mjs
```

These tests mock provider responses and do not charge any provider account. Never commit API key values or local `.dev.vars` files.

Cloudflare placement labels such as `aws:us-east-1` are geographic references for Cloudflare's own data centers. They do not move the Worker into AWS or require an AWS account. Such a placement hint is not a requirement for this integration and is not configured in this change.

## Official references

- [OpenAI Responses streaming](https://developers.openai.com/api/docs/guides/migrate-to-responses#7-update-streaming-consumers)
- [OpenAI image generation and editing](https://developers.openai.com/api/docs/guides/image-generation)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [xAI Responses](https://docs.x.ai/developers/rest-api-reference/inference/chat)
- [xAI image request settings](https://docs.x.ai/developers/model-capabilities/images/prompting-guide)
- [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Cloudflare placement](https://developers.cloudflare.com/workers/configuration/placement/)
- [Midjourney API availability](https://docs.midjourney.com/hc/en-us/articles/32013696484109-Community-Guidelines)
