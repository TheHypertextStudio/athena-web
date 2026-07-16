# User-Owned Ambient Athena

## Product invariant

Athena belongs to the user, never to a workspace. A workspace is an execution context that Athena
may read or modify only through the requesting user's current permissions. Athena never receives an
independent workspace Actor, role, grant, or capability. Permission and membership changes take
effect on the next tool call, approval, or resumed execution.

Athena's conversation, work log, preferences, assignments, and remote MCP connections are private
to their owner. Changes applied to shared workspace data remain visible through the normal resource
and audit surfaces. Audit records attribute authority to the user's Actor and identify Athena as the
execution origin.

## Execution model

The durable session substrate supports two executor kinds:

- `athena`: owned by a Better Auth user and optionally focused on one workspace or Docket object.
- `registered_agent`: the existing workspace-scoped third-party agent model.

Athena sessions persist `ownerUserId`; they do not persist an Athena `agentId`. The loop constructs
an internal user MCP context from that owner. Every Docket tool resolves the owner's current human
Actor in the target workspace and runs the normal permission engine. Approval never grants a
capability the owner lacks. The approval decision authorizes execution policy only; the underlying
tool call is authorized again when it runs.

Athena has no wall-clock or job-duration limit. The per-user run ceiling is a concurrency control,
not a deadline, and healthy personal work may continue indefinitely. Execution leases detect
abandoned workers and renew for as long as the worker remains healthy. `AGENT_MAX_TURNS` may define
one durable generation's checkpoint quantum, but reaching it never settles Athena work as failed or
completed; the next generation continues from persisted state.

Athena has one personal persistent chat across Docket. Episodic work may have an optional workspace
and source-object context, but ownership remains personal and a single session may act in more than
one workspace when the user has access.

## Personal API

Authenticated personal routes live under `/v1/me/athena`; they never accept an owner id from a
path, query, or body. The root read returns the current personal chat, counts, and session summaries
grouped into `needs_you`, `working`, and `finished`. Session detail, activity, proposals, lifecycle,
and SSE routes expose only rows whose persisted `ownerUserId` matches the request session. The
existing organization routes remain as compatibility doors and keep registered-agent behavior.

Invocation context is optional and consists of a workspace plus an optional source pointer. When a
source is supplied, the API loads the canonical row, derives its workspace, requires any supplied
workspace to match, and confirms that the caller has an active human Actor there before creating
the session. Calendar sources must be owned by the caller and associated with the stated workspace;
Stream events must belong to that workspace and concern the caller. Context is attribution and
prompt focus only. It never grants authority, and every later tool call resolves the owner's current
workspace access again.

The persistent chat is selected by owner and newest chat creation time, never by workspace. Starting
a fresh chat creates a new current row without deleting or rewriting the owner's older private chat
history. Personal routes may keep the existing synchronous runner response while execution is
in-process; they must not claim asynchronous dispatch until a real dispatcher exists.

Remote MCP connections used by Athena are user-owned. Operational integrations that genuinely
belong to a shared workspace remain workspace-owned. A personal connection can be used from any
Athena session owned by the same user.

## Experience

Athena is an ambient operating layer, not a chat destination. Docket exposes three depths:

1. A compact shell pulse and contextual actions embedded in Today, tasks, projects, initiatives,
   Stream, Calendar, and Inbox.
2. A contextual dock that opens with `Cmd/Ctrl+J`, preserves the current object, and lets the user
   direct or supervise work without leaving the page.
3. A full `/athena` workspace with a dense personal queue, selected workbench, and result/context
   rail for continuous asynchronous work.

The queue groups work into `Needs you`, `Working`, and `Finished`. The workbench leads with the
objective and any decision required, followed by a concise progress log, structured tool activity,
and an outcome receipt. Messages are work-log entries, not chat bubbles. Raw model reasoning is not
rendered. Tool calls name the connection and outcome in plain language, with raw identifiers and
JSON available only under technical details.

Athena is not an independent assignee. `Have Athena handle this` keeps the user responsible and
creates a user-owned delegation or assignment targeting the relevant initiative, project, or task.

## Privacy and attribution

Only the owner may enumerate, read, steer, approve, pause, or cancel personal Athena work. Other
workspace members can see resulting shared records and audit events only when their normal access
allows it. They cannot see prompts, transcripts, progress logs, connection metadata, or private
results.

Applied Docket actions use the owner's Actor as the authorization and audit Actor. Audit metadata
records `executionOrigin: 'athena'`, `athenaSessionId`, and `requestedByUserId`; product surfaces
render this as `Athena, for you`.

## Database rollout

This ownership change requires a fresh database. Development and rollout environments must reset
their existing databases and replay the full migration chain; this implementation does not migrate
or preserve legacy Athena sessions, chats, runs, transcripts, agent rows, assignments, or connector
credentials.

Local environments use `pnpm db:reset`; deployed environments provision an empty database before
replaying migrations.

No ownership is inferred from an initiator, agent name, workspace, or historical connection. Users
connect personal services again after reset, ensuring credentials are never guessed or silently
shared. Migration `0041` defines only the fresh executor schema and its constraints; `0042` adds
durable execution fencing; schema-only `0043` creates personal MCP connections, assignments, and
assignment-scoped triggers without backfill or credential inference.
