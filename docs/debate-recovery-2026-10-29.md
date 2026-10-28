# Debate recovery

A discussion now belongs to the server, with an immutable roster and a checkpoint per turn. The browser starts one idempotent job and reads absolute revisions. Reloading, disconnecting, or closing the viewer does not retry a model request. Explicit stop cancels the current turn and preserves prior answers.

The existing `CHAT_RUNS` SQLite Durable Object binding is reused, under separate account/project/chat names. No binding or migration change is required. An alarm claims one pending turn before calling a provider and schedules the next turn after saving it. Cloudflare alarms may be delivered more than once, so started turns are never silently reissued after process loss. Such turns become interrupted and require explicit retry or skip. Provider HTTP retries are disabled for these jobs only.

Controls retry one seat, skip a failed seat, continue remaining seats, or finish early. Operation IDs and expected attempt numbers deduplicate retried controls. Repairing an old seat retains later paid answers and marks affected later rounds as older conclusions. A progress bar and collapsible roster use the existing shell styling. Received prefixes survive reattachment; only newly received text uses the existing 15 graphemes/second display pace.

Non-incognito recovery checkpoints expire after seven days; saved chat history is retained. Incognito content remains in process memory only and cannot survive a server process restart. Credentials and provider keys are never stored in job tables. The existing account hash is retrieved only during each authorized execution; an account credential change pauses the job.

Acceptance: frontend suite, Worker suite, and bundled Worker recovery tests. A local browser fixture uses real request validation and SQLite state, synthetic providers, and zero external model calls. It covers mid-turn refresh, a 15-second viewer outage, second-seat failure, explicit retry, and completion of the remaining round. Provider call records confirm the completed first seat is never repeated. A 390 CSS-pixel iframe checks the recovery layout; this is not physical-device testing or live provider acceptance.

The fixture is `node scripts/debate-qa-server.mjs` on localhost port 4192, with its own synthetic account. It is excluded from the public Pages build. Evidence is kept under `/private/tmp/aiarena-debate-release` and the task's outputs directory.
