# Task activity sessions

Task Activity keeps one ascending chronological record. Explicitly correlated agent work appears
in discrete session containers, with authored updates prominent and mechanical changes disclosed.
Human comments remain in their original position. A session that contributes again after another
actor appears as a continuation. Loading another page extends adjacent contributions without
creating duplicate containers or dropping entries.

## Protocol and identity

Native Athena execution uses its durable agent session identity. External integrations may send a
stable, non-secret work key through `Docket-Activity-Session` on authenticated REST requests or
`params._meta["io.docket/activity-session"]` on MCP tool calls. The key is 1–128 ASCII letters,
digits, dots, underscores, colons or hyphens. Reuse it across calls and reconnects for the same work;
choose a new key for a new work session. A session can touch multiple workspace entities; each
entity shows only the records relevant to its own activity. It is correlation metadata, never an authorization token,
proof of delegation, request idempotency key, or replacement for MCP transport sessions.

The server records this key in provenance, scopes the public grouping identity to the task,
authority, authenticated client/performer and channel, and returns an opaque digest. It never
returns raw MCP transport session handles. Missing explicit keys may fall back to the existing
recorded MCP connection identity, labeled as a connection rather than a delegated assignment.
Missing provenance stays ungrouped. Native session activity and native mutation provenance use
the same grouping identity. Untrusted keys cannot join another caller's work or alter permissions.
Malformed keys fail before the mutation; cookie-authenticated human requests cannot opt into agent
identity through this header. Native session identity takes precedence over external metadata.

## Consolidation and disclosure

The latest authored update within each chronological contribution is shown in full. Earlier
updates and every individual field change remain expandable. A field change first shows its
concise label and destination; long description before/after content lives one disclosure deeper.
Counts describe the entries loaded at the selected filter, never claim a session-wide total.
Grouping does not manufacture a result, lifecycle state, human acceptance or delegation claim.
Existing live delegated-work controls remain available independently of partially loaded history.

No generative summary runs at read time. Integrations consolidate information by posting a
substantive task comment under the same explicit work key. Native execution uses the same task
comment and mutation writers for intentional work updates. A session may contain only mutations,
only comments, or both; no final update or session completion is required. Ordinary agent
conversation, thoughts, tool calls and proposals remain in session history. Task-bound questions,
durably linked answers and failures may also appear as work notices. Provider/tool errors use application-owned copy. Session grouping is additive to
the existing activity response and uses existing provenance JSON, so no data backfill is needed.

## Integration example

A tool call can attach correlation metadata without adding it to domain tool arguments:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "comment",
    "arguments": {
      "orgId": "<workspace-id>",
      "subjectType": "task",
      "subjectId": "<task-id>",
      "body": "The creative brief is ready. Final exports still need venue confirmation."
    },
    "_meta": { "io.docket/activity-session": "creative-request-42" }
  }
}
```

Use that same metadata on the mutations the update describes. REST OAuth clients send
`Docket-Activity-Session: creative-request-42` on those writes instead. Repeated keys correlate
records; they do not deduplicate writes. Keep using the API's existing idempotency contract.

Each activity entry may include `session: { id, kind, title }`. Clients must treat `id` as opaque
and group adjacent matching identities after concatenating loaded pages. Native message entries
also carry `sessionEvent` (`update`, `question`, `error`, or `change`). Questions and errors stay
visible alongside the latest update; these historical labels do not claim a gate is still open.
No client-supplied metadata can set native session identity or a delegation/acceptance state.

## Authority and historical response compatibility

Comment correlation uses `createdBy`, the stored authority, independently of `authorId`, which is
the displayed performer and may be null for OAuth clients. External records with no stored
authority stay ungrouped. Native session identity still comes from durable execution.

New executor responses carry `author: "athena"` (the existing executor-role marker); participant
replies carry `author: "user"`. An unmarked historical response can be identified as a participant
reply only through an elicitation with the same session and exact tool-use reference. Otherwise
it remains in session history, excluded from task Activity, and cannot replace a consolidated task
update. Explicit authorship on an ordinary session response does not make it a task comment.
Neither a role nor a correlation key establishes a verified person's name.

Only entries with a recorded field change contribute to the changes count. Thoughts and action
proposals remain in session history, whether the tool was read-only, unapproved, rejected or
executed. Task Activity does not expose an execution transcript or count proposals as changes. Disclosed
changes preserve their subject, exact timestamp and full before/after values.
