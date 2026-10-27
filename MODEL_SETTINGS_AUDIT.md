# Model and settings audit · 2026-10-27

This audit covers the active Claude/Grok/Gemini chat menu and the two current image models. Official capabilities and account access are separate: a valid model and request schema cannot establish that a particular key has model access or paid quota.

| Model | Official effort levels | Actual outbound field |
| --- | --- | --- |
| Gemini 4 Argon · `gemini-4-argon` | low / medium (default) / high | `generationConfig.thinkingConfig.thinkingLevel`, uppercase REST enum |
| Claude Fable 5.1 · `claude-fable-5-1` | low / medium / high (default) / xhigh / max | `output_config.effort` |
| Claude Opus 5.5 · `claude-opus-5-5` | low / medium (default) / high / xhigh / max | `output_config.effort` |
| Claude Sonnet 5.5 · `claude-sonnet-5-5` | low / medium / high (default) / xhigh / max | `output_config.effort` |
| Grok 4.7 · `grok-4.7` | low / medium / high (default) / xhigh | `reasoning.effort`, Responses API |

Gemini 4 has no max/xhigh setting, and Grok 4.7 has no max. The menus and server validation enforce those differences. Claude retains its adaptive thinking default, including at xhigh/max. Output ceilings leave room for thinking: 128,000 for Claude/Grok and 65,536 for Gemini 4. Effort affects provider behavior; it does not guarantee a fixed amount of reasoning or a particular result on every question.

[Gemini 4 specifications](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon), [Google REST thinking enum](https://ai.google.dev/api/generate-content#ThinkingLevel), [Claude model overview](https://platform.claude.com/docs/en/models/overview), [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort), [Grok reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning).

## Image controls

| Setting | Nano Banana 2.1 | Grok Imagine 2.0 |
| --- | --- | --- |
| Exact ID | `gemini-nano-banana-2.1` | `grok-imagine-image-2.0` |
| Resolution | 1K / 2K / 4K → `imageConfig.imageSize` | 1k / 2k → `resolution` |
| Composition | 14 documented ratios → `imageConfig.aspectRatio` | 16 documented ratios → `aspect_ratio` |
| Thinking / quality | minimal / medium (default) / high → `thinkingConfig.thinkingLevel` | auto / low / medium → `quality` |
| Search | Off / web / image / both → `google_search.searchTypes` | No search control; unsupported by image endpoint |
| Output | Text+image / image only → `responseModalities` | Base64 image output |
| References | 1 for edit, 2–14 for multi-image edit | 1 for edit, 2–5 for multi-image edit |
| Subsequent editing | Native signed conversation history | New edit request with the selected source image |
| Style presets | Actual prompt prefix, explicitly labelled as such | Described in the user's prompt |

Nano Banana 2.1 is Google's current efficient image-generation/editing model, replacing the prior Nano Banana 2 / Gemini 3.1 Flash Image in this UI. “Latest efficient model” does not mean it surpasses every premium image model on every task. 512px belongs to the previous model and is removed from the new model's controls. Google image model responses retain their encrypted signatures for the next edit, without exposing thought content in the UI.

Grok's current image model remains Imagine 2.0. The older `grok-imagine-image-quality` model slug retires on November 2; the quality parameter on 2.0 remains supported. The UI uses the explicit current ID, so it does not rely on a model redirect.

[User-provided Google image guide](https://ai.google.dev/gemini-api/docs/image-generation?hl=zh-cn), [Nano Banana 2.1 specification](https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1), [GenerateContent image guide and signed editing](https://ai.google.dev/gemini-api/docs/generate-content/image-generation), [xAI image generation](https://docs.x.ai/developers/model-capabilities/images/generation), [xAI multi-image editing](https://docs.x.ai/developers/model-capabilities/images/multi-image-editing), [xAI model retirement clarification](https://docs.x.ai/developers/migration/imagine-image-quality-nov-2).

## Interface review

| Before | After | Why |
| --- | --- | --- |
| Large wrapping chip grid | Compact two-column form, native selects and short radio segments | Many supported ratios no longer expand the entire panel |
| Changing an option could close the panel | Delegated change handlers update state without replacing focused controls | Multiple settings can be changed in one visit |
| Google settings were not retained | Per-provider settings persist across reloads | The summary and next request use the saved selection |
| Chat search toggle implicitly controlled image search | Explicit Google image grounding selector; chat toggle hidden in image mode | A selected image-search mode has an unambiguous request mapping |
| Reference uploads could be ignored in generation mode | Uploads select the appropriate edit task | Attached images reach the provider |
| Send installed another click handler during dispatch | One stable handler dispatches send or stop according to current state | The first send click cannot immediately cancel its own request |

Keyboard Escape returns focus to the trigger. Controls have labels and visible keyboard focus. The panel is constrained to the viewport, with a compact phone layout and no motion needed to select settings. Image settings are disabled during an active request so edits apply clearly to the next request.

## Verification

- Standard Node tests exercise actual browser request code through the Worker to intercepted official provider requests. They iterate every exposed image ratio/size/effort/grounding/quality/count and all chat effort levels, assert fields and hosts, and verify invalid settings fail before a paid call.
- Signed image history is tested through serialization and reconstruction, including exact signature bytes. Tests also cover image/web attribution and Google thinking-token accounting.
- Existing login, account mapping, project isolation, memory/history, streaming, credential redaction and redirect tests remain part of the suite.
- Full-page DOM acceptance additionally checks actual setting events, persistence, focus, send, the prompt prefix, and a generated image's subsequent signed edit using synthetic fixtures. Those checks use simulated provider responses and incur no provider charge.
- Live acceptance is recorded separately. Successful deployment, a configured-key indicator, and offline contract tests are not proof of successful paid generation. Google text/image success, returned dimensions, live grounding and real multi-turn visual consistency must be verified with a funded account. Advanced output quality cannot be established merely by a short connectivity prompt.

Not implemented by this image UI: video-to-image input, provider Files API uploads and alternative premium Google image models. The UI does not advertise these as enabled.
