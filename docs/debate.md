# Debate behavior

Each participant has a seat ID independent of its model. Free discussion supports 2–6 seats, role discussion 2–4, and 2v2 two per side. The same model can fill any number of seats. Configuration is snapshotted before a run and locked until it ends or the user stops it.

The user chooses 1–3 rounds (default 2). Round 1 collects independent positions without peer answers. Round 2 shares the same completed round-1 snapshot with every seat for cross-examination. Optional round 3 revises conclusions from round 2. Teams alternate who starts, and other modes rotate the first seat. The optional summary is one additional request. The UI states the maximum request count; there are no automatic model retries. Two consecutive failed requests stop the run, and each request has a 180-second timeout. Failed or interrupted text is excluded from peer evidence.

Only the current plan's explicit transcript is sent. Requests set `chat.historyEndUid: null` and an empty incoming history so the Worker cannot silently merge saved conversation messages back into an independent opening. Account/project memory and retrieved project materials keep their existing scope. Transcript excerpts are marked and bounded to 24,000 characters; the submitted topic and attached text must fit 16,000 characters. Summaries separate agreement, disagreement, uncertainty and next steps; majority agreement is not treated as verification.

Selectors use the site's surfaces and typography, with labelled combobox/listbox semantics, arrow keys, Home/End, type-ahead, Enter/Tab to confirm and Escape to cancel. A single popup is open at a time; it uses the top layer and stays within the visual viewport. Actual assistive-technology and physical-device compatibility still require device testing.

Pins update the visible state synchronously. Writes are serialized per account/scope/item and coalesce repeated clicks to the latest absolute value. Failures restore the last confirmed state. Cached and in-flight list snapshots cannot acknowledge a newer write; they must observe it in a request begun after that write settled. Server KV propagation can still vary between regions.

References informing these choices:

- [AutoGen group-chat orchestration and termination](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/selector-group-chat.html)
- [Multiagent debate research](https://arxiv.org/abs/2305.14325)
- [WAI-ARIA select-only combobox interaction](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/)

Verification: `npm test`, Pages staging, and a local browser fixture using an in-memory copy of the Worker. The fixture injects delayed/failed pin saves, model errors and synthetic streaming. It records selected model IDs, independent seat IDs, round context and cancellation. These fixtures validate orchestration, not real model answer quality.
