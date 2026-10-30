# Continued website audit — 2026-10-30

Release: `20261030-deepaudit4`. Base: `4c187af` (includes the native Android release and the earlier history/billing fixes).

## Confirmed fixes

| Issue | Trigger and resulting fix | Evidence |
| --- | --- | --- |
| Stale project preview | Start a slow file preview, then leave the project. The old response previously reopened its contents in general chat. Preview revisions, account and scope checks now discard stale successes and errors; closing also clears retained download/content state. Later clicks win when responses finish out of order. | Browser reproduction with an 1800 ms response delay; four new preview tests fail on the original source and pass on the fixed source. |
| Same-name source ambiguity | Import `设计/说明.txt` and `财务/说明.txt`. The file list retained paths, but retrieval, full-reading prompts, source labels and the preview title reduced both to `说明.txt`. Full relative paths now follow each source. Named-path retrieval prefers the requested file. Original download filenames remain the actual basename. | Real production ZIP import before the fix; isolated real Worker tests inspect search results, full-reading batches and the official Sol request payload. |
| Upload resume collision and lost acknowledgements | Interrupted same-name/same-byte files in different directories shared an IndexedDB resume key. Keys now include the path and replacement identity, and the server validates those fields. Earlier browser keys migrate only after server confirmation. A replacement whose commit acknowledgement was lost can also finish without replacing or uploading it twice. | Stateful multipart/IndexedDB tests interrupt acknowledgements, import a colliding path, resume the original, and retry an already-committed replacement. |
| Valid empty ZIP members reported as corrupt | JSZip represents empty members without its usual compressed-data metadata. CRC checks now retain central-directory sizes/checksums, including Unicode filename fields. Empty members are identified as empty; useful siblings and valid Office packages continue. Forged checksums remain rejected. | Real production ZIP showed the incorrect error; STORE/DEFLATE, Office, corrupt-empty and Unicode-path regression cases pass. |
| Binary content indexed as text | Project text parsing accepted embedded control bytes that chat attachments already reject. The streamed parser now rejects binary control bytes, including bytes arriving after a completed indexing batch. The original remains recoverable while the failed index cannot enter retrieval. | Real parser tests with controls at the beginning and after 25 text segments. |
| Narrow breadcrumb wrapping | At 320 px, a long project name squeezed the `项目` return control into two vertical characters. The return control now retains its width and stays on one line. | Browser screenshot and DOM geometry at 320 px; page width equals viewport width. |

## Validation before release

- Full offline suite: **646 passed, zero failed**; no external network or paid models in this suite.
- Frontend build, two inline-script syntax checks and Worker dry-run pass.
- Browser validation uses the real UI with disposable local KV, SQLite actors and an in-memory R2 substitute. The helper and its Demo/Worst case/Empty/One data switch are excluded from published assets.
- The local scheduled-task flow covers a future single occurrence in Asia/Shanghai, pause and immediate execution. The synthetic provider is invoked once, and the result is stored as a project conversation. No production task is created.
- Before release, production upload/indexing, Unicode/special-character filenames, preview, byte-identical original download, nested same-name ZIP members and explicit unsupported-member reporting were checked in the dedicated QA project using synthetic documents only.

## Acceptance boundaries

Production post-release checks, paid calls and Cloudflare deployment identifiers are recorded in the task's separate release evidence after deployment. Any paid call must use **GPT-6.1 Sol / Low, Skills off**. Browser-width checks are not physical iPhone/Android acceptance. This audit does not assert that every possible path or future regression is absent.

## Follow-up live findings

Further acceptance found that legacy index response names could still replace full source paths. Retrieval and full-reading results now resolve names through the current project manifest, including when an older index response supplies only a basename.

A seventh issue was reproduced by removing and restoring a synthetic reference: the management dialog reflected the successful restoration, while the project home still showed two files instead of three. Material responses now refresh the active project's state and home. Delayed responses and errors from an earlier account or scope are ignored. Release `20261030-deepaudit5` preserves the scheduler and stable-layout changes merged meanwhile; its complete offline suite has **660 passing tests**.
