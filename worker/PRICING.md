# Official API usage and pricing

Checked 2026-10-30. Currency: USD. Token prices below are per **one million tokens**, for Standard, synchronous API service. The shared implementation is `arena-billing.js`, version `official-2026-10-30-v1`.

## Current conversation models

| Model | Ordinary input | Cache read | Output, including reasoning |
| --- | ---: | ---: | ---: |
| Claude Fable 5.1 | $10 | $0.25 | $50 |
| Claude Opus 5.5 | $4 | $0.20 | $20 |
| Claude Sonnet 5.5 | $2 | $0.10 | $10 |
| GPT-6 Astra | $10 | $1 | $50 |
| GPT-6.1 Sol | $2 | $0.10 | $10 |
| Grok 4.7 | $2 | $0.50 | $6 |
| Gemini 4 (`gemini-4-argon`) | $2 | $0.10 | $10 |

Sources: [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI](https://developers.openai.com/api/docs/pricing), [xAI](https://docs.x.ai/developers/pricing), [Google](https://ai.google.dev/gemini-api/docs/pricing).

GPT input **above 272,000** uses the long-context rate for the whole request: Astra $20 / $2 / $75; Sol $4 / $0.20 / $15, in input/cache/output order. Grok input **at or above 200,000** uses $4 / $1 / $12 for the whole request. Current Fable, Opus and Sonnet have no additional long-context surcharge.

Google advertises Gemini 4's rates from **2026-12-01** as $4 input, $0.20 cache read, $20 output. The receipt stores the rate card used, rather than recalculating saved expenses with today's price.

## Cache writes and background calls

| Model | Short cache write | Long cache write | Lifetimes |
| --- | ---: | ---: | --- |
| Fable 5.1 | $12.50 | $20 | 5 minutes / 1 hour |
| Opus 5.5 | $5 | $8 | 5 minutes / 1 hour |
| Sonnet 5.5 | $2.50 | $4 | 5 minutes / 1 hour |
| GPT-6 Astra | $12.50 | $25 | 30 minutes / 12 hours |
| GPT-6.1 Sol | $2.50 | $5 | 30 minutes / 12 hours |
| Haiku 5.5, input ≤100k | $0.125 | $0.20 | 5 minutes / 1 hour |
| Haiku 5.5, input >100k | $0.625 | $1 | 5 minutes / 1 hour |
| Historical Haiku 4.5 | $1.25 | $2 | 5 minutes / 1 hour |

GPT long-context cache-write rates are Astra $25 / $50 and Sol $5 / $10. Current utility `claude-haiku-5-5` input/cache/output rates are $0.10 / $0.01 / $0.50 through 100,000 total input tokens, and $0.50 / $0.05 / $2.50 above that threshold. Total input includes ordinary input, cache reads and cache writes, and the higher tier applies to the entire request. Historical `claude-haiku-4-5-20251001` remains $1 / $0.10 / $5; saved receipts are never repriced. Context summaries and memory extraction each keep a separate receipt; their expense can attach to the originating reply without relabeling their tokens as the selected conversation model's tokens.

Anthropic's `input_tokens` **excludes** cache reads and writes. Total input is ordinary input + `cache_read_input_tokens` + `cache_creation_input_tokens`. Cache creation is split by `cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`.

OpenAI's `input_tokens` **includes** cache reads and writes. Ordinary input subtracts both `cached_tokens` and `cache_write_tokens`. The `ttl_30m_tokens` and `ttl_12h_tokens` write counters are non-overlapping; the write total must not be charged again. Missing positive-input cache metadata leaves the input charge pending.

Sources: [Anthropic cache semantics](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [OpenAI cache semantics](https://developers.openai.com/api/docs/guides/prompt-caching).

## Images

Nano Banana 2.1 (`gemini-nano-banana-2.1`): input $1.50, text/reasoning output $7.50, image output $30 per million tokens. The documented square-image examples are 1K 1,120 image tokens ($0.0336), 2K 1,680 ($0.0504), 4K 3,780 ($0.1134). These are examples of the image-output component, not a fixed all-inclusive price per request.

Google output is `candidatesTokenCount + thoughtsTokenCount`. Image/text candidate counts come from `candidatesTokensDetails`; thoughts are charged at the text-output rate. Grounding retrieval content is not added as a guessed image-input charge. Missing modality metadata leaves the charge pending rather than pricing all output as image tokens.

Grok Image 2.0 (`grok-imagine-image-2.0`): reference input $0.01/image. Generated images: 1K Low $0.04, 1K Medium $0.06; 2K Low $0.06, 2K Medium $0.08. The actual expense comes from the returned `cost_in_usd_ticks`, rather than requested image count or these illustrative unit prices.

Sources: [Google image pricing](https://ai.google.dev/gemini-api/docs/pricing), [Google usage schema](https://ai.google.dev/api/generate-content#UsageMetadata), [xAI prices](https://docs.x.ai/developers/pricing), [xAI returned costs](https://docs.x.ai/developers/cost-tracking).

GPT Image 2.5 Sunburst and Flare: text input $5, image input $8, image output $30 per million tokens. Their Responses-tool cached input rates are $1.25 text / $2 image; direct Images API calls do not receive these discounts. OpenAI explicitly states that these cached quantities are **not exposed in the Responses output**, so even a returned image usage object cannot establish the precise image-input fee. The ledger keeps reported image counters, prices a reported image-output component, and leaves image-input expense pending.

The current image workflow also invokes GPT-6.1 Sol as an orchestrator. Each image request keeps both model meters separately; a batch sums all image-generation meters without relabeling Sol tokens as image tokens. Partial previews are not additional generations. Both successful and failed requests retain available usage. [OpenAI image cache accounting](https://developers.openai.com/api/docs/guides/image-generation#cached-input-pricing).

## Compatibility models still accepted by the backend

| Model ID | Input | Cache read | Output |
| --- | ---: | ---: | ---: |
| `claude-opus-5` | $5 | $0.50 | $25 |
| `gpt-5.6-sol` | $4 | $0.40 | $20 |
| `gemini-3.8-flash` | $0.75 | $0.075 | $3.75 |
| `gemini-3.1-pro-preview` | $2 | $0.20 | $12 |
| `gemini-3.1-flash-image` | $0.50 | n/a | Text/thinking $3; image $60 |

Opus 5 cache writes are $6.25 / $10. GPT-5.6 Sol cache writes are $5 / $10; above 272,000 input tokens its input/cache/output/write-short/write-long rates are $8 / $0.80 / $30 / $10 / $20. This is the promotional public rate verified on the checked date.

Gemini 3.1 Pro input above 200,000 uses $4 input, $0.40 cached input, $18 output. Google advertises Gemini 3.8 Flash's rates from 2027-01-01 as $1.50 / $0.15 / $7.50. No new model is enabled by adding its price to this compatibility table.

## Search and service tiers

OpenAI and Anthropic web search: $10/1,000 calls; xAI: $5/1,000 calls. Returned token usage already includes billable search-context tokens. Search calls use provider-reported counts or completed tool-call IDs, never the number of citations. xAI's actual returned monetary amount already includes tools, so tool fees are not added a second time.

Google Gemini 3+ search shares 5,000 free monthly requests across web/image search, followed by $14/1,000 queries. Multiple queries can occur in one request. A single response cannot establish the shared allowance remaining or the final billable quantity. The UI therefore shows the known token subtotal plus **pending search fees**, not a guessed zero or an invented final total.

Anthropic requests, including summaries and memory, explicitly set `service_tier: standard_only`. An unexpected non-Standard response is not priced as Standard. [Anthropic service tiers](https://platform.claude.com/docs/en/api/service-tiers) describes this control.

OpenAI requests explicitly set `service_tier: default`, which requests Standard pricing. The response's actual tier takes precedence: Fast/Priority 2x, Ultrafast 6x, Flex 0.5x token rates. Tool fees are not multiplied by the token service tier. `auto` without the effective tier is not assumed to mean Standard. Google returned service tiers use the model's documented multipliers; unknown tiers stay pending.

Sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [OpenAI service tiers](https://developers.openai.com/api/reference/python/resources/responses/methods/create), [Anthropic search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [xAI pricing](https://docs.x.ai/developers/pricing).

## Automatic skills and official document execution

Automatic skill selection, context summaries and memory extraction use Haiku 5.5 with `thinking: {type: "disabled"}`, `output_config: {effort: "low"}` and Standard-only service. No removed sampling parameters are sent. Every actual utility call is billed from its complete cache-aware usage, not a fixed charge per reply. The new tokenizer is measured by official usage counters; no guessed token multiplier is applied. Forced skill-selection tools are preserved; empty or refused memory responses cannot replace existing memory. [Official migration guide](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide), [Haiku prompting and thinking](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5). Official documents use the selected compatible Claude Fable, Opus or Sonnet model, with the configured compatible default used only for automatic routing from another provider. Every `pause_turn` continuation is a separate paid Messages request with its own immutable receipt, priced for the model that actually executes it. The reply groups all document-generation token counts and expenses; classifier, memory and summary tokens remain under their own model and purpose.

Claude code execution has an organization-wide allowance of **1,550 hours per month**. Beyond it, the price is **$0.05/hour/container**, with a **5-minute minimum**. Preloaded files can incur execution time even if the model does not call the tool. Current document requests do not qualify for the newer search/fetch tool exemption. Their response cannot establish the remaining shared allowance or billable time, so execution expense stays pending alongside the known token/search subtotal. It is not inferred from request latency, counted once per continuation as a new container, or assumed free.

Including `web_search_20260209` / `web_fetch_20260209` or later qualifies for the documented execution-fee exemption. The accounting adapter checks the tools actually sent; it does not infer an exemption just because a search switch is enabled. [Official execution pricing](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool).

## Receipts, totals and historical data

- Input/output come from provider counters, never text length. OpenAI/xAI output already contains reasoning; Google adds its separate thought counter once. Cumulative stream snapshots are merged, never summed as new calls.
- Each provider attempt has a unique receipt. Failed attempts retain returned usage, including an attempt preceding a retry. Missing final usage is shown explicitly. A ledger retry repeats only an idempotent database write, never a model request.
- xAI's integer ticks use 10,000,000,000 ticks/USD. Money is accumulated as integer USD picodollars, serialized as strings. No binary floating-point running total or display rounding changes a saved charge.
- The existing `CHAT_RUNS` SQLite binding hosts a private named billing object. Receipt insertion and total updates share a synchronous transaction. Duplicate IDs with identical data do not count twice; conflicting data cannot rewrite a saved receipt. No new binding or migration is required.
- Ledger outages retain immutable `billing:pending:` KV receipts. Reading the authenticated summary imports backups idempotently. Totals mean receipts already entered in the ledger; a receipt marked pending/unrecorded is shown accordingly.
- `POST /usage` requires the registered account's credentials and scopes receipts to their owner. Only the existing administrator can request global totals. Shared-password traffic cannot claim another registered account's financial ownership. `GET /pricing` makes no provider call.
- Only counters, amounts, model, dates, rate snapshots and receipt relationships are recorded. Provider keys, prompts, images and reply bodies are not copied into billing receipts.
- Existing chat history, `official~` KV aggregates, custom-price storage and manual-credit data remain untouched. Old rounded costs without original cache/tool/modality counters cannot be accurately reconstructed, so the new totals do not silently combine or rewrite them.

“Official amount” means money returned by the provider. “At official rates” means arithmetic from actual usage and the dated public rate card. Public-rate calculations do not incorporate account-specific credits, discounts, taxes or invoice adjustments.
