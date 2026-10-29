# Project and general conversation navigation

Release: `20261030-projectscope1`

Clicking a global sidebar destination now exits the active project before applying
the destination action. Project-home chat actions remain inside their project.
The application restores each account and scope's own conversation, draft,
attachments, image-editing mask, quote, mode, and sidebar list. A project home preserves unsent input
while preparing a new conversation, including original upload bytes used by Skills.

Delayed project, conversation-list, and memory responses cannot replace a newer
navigation choice. Pending saves are shared between competing scope switches;
a failed save keeps the original view. Scope changes also update navigation and
pinned-project indicators. Empty conversations center the welcome/composer group,
and a project chat's context bar stays at the top.

## Validation

- `npm test`: full frontend suite passes, including 13 scope/navigation regression cases.
- `npm --prefix worker test`: full server suite passes, including server-side project,
  account, memory, retrieval, and conversation isolation checks.
- Browser acceptance uses the real frontend and Worker with an in-memory KV,
  SQLite-backed Durable Objects, and synthetic model streams. No production
  credentials, user records, or paid model calls are used.
- General draft and attachment -> project A -> general -> project A: each side
  restores its own input and shows only its own history.
- Provider-input inspection: project A receives its project instructions, memory,
  retrieved file, and attachment, without the general attachment. General chat
  receives its own attachment, without project A's memory or materials.
- Project B opens with an independent empty draft, attachments, and history.
- Exit, new conversation, and repeated general-chat navigation checked at desktop,
  390 x 844, and 320 x 568 viewport sizes. No horizontal overflow or input lock
  remains. These are browser viewport checks, not physical-phone tests.

Existing server access checks and provider routing remain unchanged.
