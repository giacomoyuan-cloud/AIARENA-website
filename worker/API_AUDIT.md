# Official provider API migration

The Worker routes active chat and image models to these provider APIs:

| Provider | API host | Secret binding |
| --- | --- | --- |
| Anthropic | `api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenAI | `api.openai.com` | `OPENAI_API_KEY` |
| xAI | `api.x.ai` | `GROK_API_KEY` |
| Google | `generativelanguage.googleapis.com` | `GEMINI_API_KEY` |

The active model IDs are listed in `worker.js`. Chat, image generation and supported image editing use the matching provider's credentials. Anthropic memory extraction uses the same official Anthropic binding.

The Worker does not reference the legacy aggregator credentials or endpoints and never falls back to an aggregator when an official provider fails. Unused legacy secrets can remain encrypted in deployment settings without being used by this code. Midjourney is disabled because a generally available public official API is unavailable; the already inactive legacy Kling route is not enabled by this migration.

An optional OpenAI transport can use an authenticated Cloudflare AI Gateway with the same OpenAI key. It requires explicit configuration and an AI binding. Its requests disable logging, caching, gateway retries and Cloudflare-managed credential fallback. The default transport continues to call the provider's own host.

## Verification boundaries

- The root status response reports whether secret bindings are configured. It does not authenticate those keys or check account balances.
- Model-list authentication establishes neither available credit nor successful text or image generation. Verify the selected models with actual requests from the deployed environment.
- Provider authentication, account, quota and region errors are shown to the page. Routing to an official API cannot restore an account's credit or eligibility.
- Offline tests cover provider routing, authentication headers, streaming and usage parsing, image payloads, redirect rejection, error redaction, isolated historical usage and the optional gateway transport.
- Operational diagnostics and account-specific acceptance records are kept privately. This document contains no account balances, secret values or live account-status claims.

Existing login, chat history, memory, storage bindings and price settings are retained. New official usage uses the `official~` prefix, so historical usage is not relabeled or overwritten. Website budget estimates are separate from provider billing records.

See [deployment and interface references](README.md) for deployment order, configuration and official documentation.
