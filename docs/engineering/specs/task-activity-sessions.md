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
updates remain expandable. Ordinary change lists show every action directly; each row expands its
before/after content. Only sequences longer than ten changes fold their middle, keeping the first
three and latest three visible. A count must never replace the action summaries. A field change first shows its
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

## Entity history is the primary model

Activity should explain what happened for, by and in relation to the entity. A session is secondary
correlation and attribution, never a destination that replaces the work history. The reference is
GitHub's readable chronological action rows: ordinary actions stay visible; unusually long
sequences and large diffs may disclose further detail. Activity prose and timestamps use the app's
normal typeface.

The intended history includes recorded metadata/content changes, discussion, related work and
mentions or linked conversations from connected sources. Source identity and a usable source link
must stay attached to imported activity, with source permissions enforced before pagination.
Related discussion is evidence of activity, not proof the task advanced or finished.

Current coverage is narrower: this route projects creation, task comments, recorded changes,
meaningful child/dependency changes, timers and task-bound question/failure notices. Existing
mention/resource edges and normalized external events are separate sources; Slack/Discord mentions
are not yet projected into this task timeline. That requires explicit entity correlation, visibility,
source links and deduplication rather than importing an integration's full message stream.

## Contribution content and lossless field consolidation

A contribution's visible body comes from saved work, not from its correlation key. Revised
descriptions show the recorded new content; metadata shows the value transition; relationships
name the actual recorded direction and subject. Full before/after values and exact timestamps
remain expandable. A written task update is optional and is never generated from session chat.
The heading describes the recorded actions, not inferred purpose, completion or delegation.
Performer and available authority labels come from existing verified provenance.

Within one contribution, repeated scalar edits to the same subject and field may consolidate into
an earliest-before to latest-loaded-after transition. Each recorded edit remains in that field's
history. Consolidated transitions are ordered at their latest source position so recent edits
remain visible when long lists fold. Relationship and unknown-field changes stay distinct so different links cannot collapse
into one record. Consolidation never crosses a human interruption or an authority/session boundary.
Long lists disclose only their middle and preserve their recorded order when expanded. Counts
refer to underlying loaded edits, not a fabricated session total. A content preview may shorten a
long description visually, with the full recorded text available through its change disclosure.

## A session contains a period of work; it owns nothing

Agent identity, work-session context and recorded activities are distinct. A session groups a
period of related work and may reference multiple workspace entities. Entity responsibility and
assignment remain on the entity. Each record retains its own performer, authorizing principal,
source and timestamp; the session never replaces those fields or grants authority. A session may
have its own access policy or initiating principal; that is independent of responsibility for any
entity it touches.

This follows the useful separation in [Linear's agent interaction model](https://linear.app/developers/agent-interaction)
between an agent, a session and its emitted activities. Docket's entity timeline still projects
intentional discussion and recorded work; execution chatter remains in the session surface.
External Codex/MCP work can originate outside Docket and needs no delegated job or final report.
Native lifecycle state is separate from the historical projection and is never inferred from an
external correlation key, a period of silence or a rendered contribution.

The displayed interval is explicitly the first-to-last recorded activity in the loaded contribution,
not a claimed start/end of execution or proof of continuous work. A single record remains a point
in time. A different performer starts another chronological contribution with its own attribution,
even when the underlying session identity is shared. An agent's authorizing person is not confused
with its displayed authorship, so OAuth comments and mutations from the same performer still group.
Legacy connection metadata remains labeled as connection activity rather than a declared work run.
