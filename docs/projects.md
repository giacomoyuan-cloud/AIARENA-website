# Project workspace

The Projects navigation opens a full page with search, ordering, creation, pins, rename, archive and restore. Pinned projects also appear in the sidebar. A project's home reuses the actual conversation composer and has separate sections for instructions, editable project memory, context files, imported folders and scheduled tasks. Opening an existing project conversation restores the normal conversation view. No alternate provider or synthetic data is shipped in the UI.

Conversation menus in both the sidebar and the project home support opening a window, pinning, rename, project assignment, grouping and deletion. The composer's attachment menu also provides project assignment. A moved conversation retains its messages and citations but carries no account or project memory to its destination. Running conversations cannot be moved. Destination content is written and checked before source removal; old-scope save receipts reject delayed browser saves. A same-ID destination gets a new ID rather than being overwritten. Custom titles survive normal autosaves. Groups are account and scope specific.

Folder selection imports supported documents selected through the browser. Nested relative paths are retained, hidden and unsupported files are counted as skipped, and reimport replaces a matching active path while retaining the previous version among removed files. Existing limits remain 15 active documents, 8 MB per file and 40 MB per project. This grants no ongoing filesystem access and does not let the server execute local commands. No native desktop working-directory capability is claimed.

## Scheduled tasks

`POST /schedules` requires a registered account. The `PROJECT_SCHEDULES` SQLite Durable Object binding points to `ProjectScheduler`, with the additive `project-schedules-v1` migration. Deploy the Worker configuration before releasing the frontend. Keep existing bindings, migrations and secrets.

Tasks support one-time, daily, weekday and weekly execution with an explicit IANA time zone; Asia/Shanghai is the default. A one-time date uses the device's local time and is converted to an absolute timestamp. Tasks are created with stable IDs, can be edited, paused, resumed, run immediately or deleted, and retain twenty execution receipts. Up to thirty tasks can be stored per account. No tasks are created by installing this feature. Templates only prefill an editor. An explicit save enables recurring normal model usage.

The account's actor owns alarms independently of any browser connection. Each execution verifies its account and project, retrieves the account credential only in memory and uses the existing scoped chat/provider pipeline. Results and partial errors become ordinary conversations in the selected project or general scope. Execution is marked running before a model call; an interrupted actor is marked failed rather than repeating a potentially billed call. Archived projects stop their associated executions before model access. DST gaps skip the nonexistent local time. KV conversation indexes retain the platform's existing eventual-consistency and concurrent-write limitations.

## Validation

Run `npm test`, `npm --prefix worker test` and `npm run build`. Added backend tests cover moves, collisions, failure preservation, late saves, ownership, rename persistence, scoped groups, partial settings edits, folder replacement, credential-free scheduling, recurrence and DST, pause/edit/delete, browser-independent alarms, partial failures and restart behavior.

For local browser acceptance, `node scripts/projects-qa-server.mjs` serves `http://127.0.0.1:4193/` with disposable `qa-reader / offline-fixture` data. It exercises the real Worker routes and actor implementations against synthetic providers. `/__evidence` exposes only synthetic execution evidence. This helper and tests are excluded from the published `dist-site` allowlist. Browser and synthetic-provider checks do not constitute physical-device or paid-model acceptance.

## PDF recognition

Project uploads retain their original private R2 file. PDF.js extracts selectable text in a browser worker. Pages without text, and low-text pages containing images, are recognized by the fixed `gpt-6.1-sol` model through the existing official OpenAI transport, independently of the conversation model. A PDF page is copied into a separate PDF input with high visual detail; oversized individual pages use a bounded JPEG rendering. There is no new whole-project size or page-count limit.

Completed OCR pages are cached per immutable original and page number. Blank pages are explicitly verified; incomplete, refused or uncertain results cannot claim complete reading. OCR usage is recorded separately as `document-ocr`. The UI discloses the model and normal usage. Old unreadable, partial or interrupted PDFs have a Continue recognition button that downloads the saved original and resumes. Keep the browser open while parsing. A fresh repair uses a generation-bound staging index; successful commit replaces the index atomically, and failures retain the prior readable index. Removed files and other accounts/projects cannot invoke OCR against the original. No credentials, PDF prompts or page images enter the billing ledger.
