# Athena Agent — Engineering Spec

> **Status**: User-owned execution shipped; personal API and ambient experience migration active
> **Last Updated**: 2026-07-15
> **Companions**: `mcp-surface.md` (the tool catalog + auth MUSTs), `activity-feed.md` (the
> event substrate Athena consumes downstream), `permissions.md` §8 (agent authorization),
> `docs/core/mvp-plan.md` §4/§8.6 (the product vision)

Athena is Docket's first-party agent — positioned as a **next-generation digital chief of
staff**. Natural language is her primary medium; her scope is the user's whole plate
("create a plan to make sure I get more sleep" is as legitimate as "reschedule the
offsite"). Product-wise she is paid-plan gated and ~80% of her value is UX; this spec covers
the engine that UX stands on.

## Authorization invariant

Athena belongs to the user, never to a workspace. An Athena session persists the Better Auth
`ownerUserId` and may carry a `contextOrganizationId` only to focus the work. Context confers no
access. The in-process MCP server receives a first-party user principal, and every Docket tool call
resolves that user's current active human Actor and grants in the target workspace. Revocation and
new permissions therefore take effect on the next call or resume. Athena never receives an agent
Actor, role, grant, or independent authority; approval cannot supply authority the owner lacks.

Separately registered third-party agents keep the workspace-scoped `agent` + agent-Actor model.
Every runtime branch must discriminate `executorKind`; nullable ownership columns are not an
authorization signal.

## 1. The shape of the system

**One engine, many doors.** The home prompt box, the persistent personal Athena chat thread, and
task delegation all drive the same session substrate: an `agent_session` (`kind: 'chat'`
for the user's long-lived conversational thread, `kind: 'job'` for episodic delegated work), its
`session_activity` stream (what the UI renders), and its
`agent_session_transcript` (what the model resumes from).

**Two front doors, one service layer — literally.** Athena's loop connects an MCP SDK
client over `InMemoryTransport` to the **same `buildServer(ctx)`** that serves `/mcp`
(`apps/api/src/mcp/server.ts`). A tool added for Claude/Codex is instantly Athena's too;
drift is impossible by construction.

```
Athena loop (apps/api/src/agent/)                    third-party agents
  │  one provider turn ──▶ AgentTurnRuntime port       (Claude, Codex…)
  │  (boundaries: real Anthropic / scripted mock)            │
  │  tool_use                                                │ OAuth 2.1
  ▼                                                          ▼
MCP client ── InMemoryTransport ──▶ buildServer(ctx) ◀── /mcp endpoint
                                        │
                              scope layer + grant cascade
                                        │
                                  service layer ── @docket/db
```

## 2. The boundary port: one provider turn (slice 1 — shipped)

`packages/boundaries/src/ports/agent-turn.ts` — `AgentTurnRuntime.streamTurn({system,
messages, tools}) → AsyncIterable<TurnEvent>` (`thinking` / `text` / `tool_use` /
`turn_end`).

The port is deliberately **one turn**, not a session: the loop, tool dispatch, approval
gating, and resume are business logic that must be exercised as real code against a mock
_turn_, never hidden behind a mock _session_ (the old `AgentRuntime` port's flaw; it is
deleted when `runSession` swaps over in slice 5).

Key invariant: **`turn_end` carries the fully assembled assistant `TurnMessage`** —
including `thinking` block `signature`s — so the host appends it verbatim to the durable
transcript. Events and transcript can never disagree; the mock derives its event stream
_from_ its scripted message for the same reason.

- Real adapter: Anthropic Messages API, `claude-opus-4-8`, adaptive thinking
  (`real/agent-turn.ts`, pure translation in `agent-turn-translate.ts`).
- Mock adapter: replays scripted turns **indexed by the assistant-message count** of the
  input conversation — the persisted transcript itself is the resume cursor, so
  pause/resume replays deterministically. Runs past the script throw (a loop bug, surfaced).
- Fixtures: `SCRIPTED_TURNS` (think → propose write → summarize) and
  `SUNSAMA_IMPORT_TURNS` (read source → batch creates in ONE turn → summarize) let the
  whole firehose-onboarding proving flow run offline.
- Container: `agentTurn` key in `select.ts`; real iff `ANTHROPIC_API_KEY` is real-shaped
  and `APP_MODE ∉ {local, test}`.

## 3. Durable session state (slice 2 — shipped)

| Table / column                       | Purpose                                                                                                                                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_session_transcript`           | 1 row/session; `messages: TurnMessage[]` jsonb rewritten per turn **in the same transaction** as the turn's activity rows. Re-entry after a days-long approval or a restart rebuilds the provider conversation purely from this row.                              |
| `session_activity.proposal_group_id` | Every gated action proposed in one assistant turn shares a group id — the batch-approval handle ("approve all 40 imported tasks"). Indexed `(session_id, proposal_group_id)`.                                                                                     |
| `agent_session.executor_kind`        | `athena` for a user-owned executor or `registered_agent` for a workspace agent. Database checks enforce the corresponding exclusive owner shape.                                                                                                                  |
| `agent_session.owner_user_id`        | Canonical private owner for Athena sessions. `organization_id` and `agent_id` are null; `context_organization_id` is optional and never grants access.                                                                                                            |
| `agent_session.kind`                 | `chat` \| `job` (default `job`). Athena chat lookup is personal; registered-agent chat lookup remains workspace-scoped.                                                                                                                                           |
| `agent_session_run`                  | One durable execution generation and lease claim. `(session_id, generation)` is unique, `workflow_instance_id` is constrained to `sessionId:generation`, and a fresh `lease_token` fences the only worker allowed to consume the transcript or dispatch tools.    |
| `agent_session_dispatch`             | Payload-free enqueue/wake outbox. A unique run/action intent is transactionally persisted with generation admission or a human continuation, then short-lease claimed and retried by a bounded cron sweep until Worker `202` or operator attention.               |
| `integration_credential`             | AES-256-GCM ciphertext 1:1 with an `integration` (unique-indexed, cascade). The no-token-passthrough MCP MUST as schema: agents reach remote services only with the org's own sealed credential (`CREDENTIALS_ENCRYPTION_KEY`, explicit env — no hidden default). |

`SessionActivityBody.action` carries the executable payload: `toolCall {connection, tool,
input, toolUseId}` (what approval executes; `input` is editable until approved), `result
{content, isError}`, and `mode: 'proposal' | 'suggestion'`.

The canonical `TurnMessage`/`TurnContentBlock` Zod shapes live in `@docket/types`
(`agent.ts`); the boundaries port and the db `$type` both import them — the event-substrate
anti-drift pattern.

## 4. The internal principal (slice 3 — shipped)

`McpContext` is a **discriminated principal union** — `{kind:'user'}` (cookie/Bearer paths)
| `{kind:'agent'}` (`agentId`, `agentActorId`, `orgId`, `displayName`) — so every
identity-sensitive consumer decides explicitly what an agent means for it:

- `resolveActor`: agent → its own Actor, only within its one org (cross-org 404s,
  existence-hiding). Agents traverse the identical `canActor` grant cascade humans do.
- Cursor HMACs + task-store ownership: `principalKey` (pure helpers in `mcp/principal.ts`;
  kept out of `auth.ts` so tests' module graphs don't load env validation early).
- Prompts personalize with `principalDisplayName`; hub resources scope to the agent's org;
  the personal daily plan 404s (agents have no Hub).

`internalUserContext(ownerUserId)` is Athena's no-OAuth entry. It loads only the persisted user and
provides the full first-party scope set. It deliberately does not resolve or cache a workspace
Actor; `resolveActor` does that on each targeted tool call. `internalAgentContext(orgId, agentId)`
remains the registered-agent entry with fixed
`AGENT_SESSION_SCOPES = ['work:read','work:write','agents:run']` —
**deliberately never `connectors:link`** (linking external services stays a human act).
Scope is necessary-not-sufficient; grants still bind every call.

`ensureDefaultAgent` is retained only for registered-agent compatibility and provisioning tests.
Athena chat, delegation, prompt, proactive, loop, approval, and runner paths never call it.

## 5. The approval-policy engine (slice 4 — shipped)

`apps/api/src/agent/approval-policy.ts` — pure. `classifyTool` reads MCP tool
**annotations** (`readOnlyHint`) and **fails closed** (undeclared ⇒ write). `POLICY_TABLE`
keyed by `agent.approvalPolicy` for registered agents and the user's personal Athena approval mode.
Athena has no workspace agent policy; the personal mode is the authority-independent execution
ceiling:

| dial                          | read    | write                                 |
| ----------------------------- | ------- | ------------------------------------- |
| `suggest`                     | execute | record_only (never executes)          |
| `act_with_approval` (default) | execute | propose (approval executes + resumes) |
| `autonomous`                  | execute | execute (fully audited)               |

Reads always execute — the dial gates mutation, not observation. No tool-name lists.

## 6. The agentic loop (slice 5 — shipped)

`apps/api/src/agent/loop.ts` — `driveSession(orgId, sessionId)`, **re-entrant**: all state
is in the DB, so first run, resume-on-approve, resume-on-reply, and restart recovery are one
code path. Per turn: stream `agentTurn` events → persist activities (thinking→`thought`,
text→`response`, tool_use→`action`) → on `turn_end` append the assistant message to the
transcript in the same transaction → dispatch tool calls per the policy engine:

- `execute`: persist the call as `approved`, conditionally claim it as internal state `executing`,
  then call via the executor toolbox. Athena acts as the owner's current human Actor and a
  registered agent acts as its own Actor. Stamp `approvalStatus:'applied'` +
  `body.action.result`; write an `audit_event`; feed the `tool_result` back. A recovered
  `executing` write is never dispatched again automatically; the session parks for attention.
- `propose`: persist with `approvalStatus:'proposed'` + shared `proposalGroupId`; settle the
  session `awaiting_approval`; **stop**. Approval (`decideActivity` + a new
  `executeApprovedActions`) executes the stored `toolCall`, appends paired `tool_result`s,
  and re-enters the loop. The decision audit commits before execution admission. If the owner's
  concurrency ceiling rejects admission, the action remains `approved` and the session remains
  `awaiting_approval`; retrying that same activity, group, or latest-action approval skips a second
  decision/audit and competes for the generation lease again. Only the lease winner may advance
  `approved → executing`, so concurrent retries dispatch the tool once. A rejection feeds an
  `isError` tool_result back so Athena adapts (session continues); session-level reject keeps cancel
  semantics.
- `record_only`: persist as `mode:'suggestion'`; feed a synthetic "recorded, not executed"
  result so the model proceeds.

Elicitations are a Docket-side `ask_user` tool (deterministic, no MCP surface change). Replies carry
the provider `toolUseId`, making concurrent duplicate replies reject instead of appending competing
answers.

Every initial run, approval execution, reply resume, and lifecycle resume enters through the same
generation claim. The short transaction locks the stable Athena owner row, restores ownership from
the session, counts only fresh owner run leases, and either creates the next generation or recovers
an expired generation with an incremented attempt and a new fencing token. A fresh same-session
lease rejects duplicate callers. Each entry point supplies its legal source states, and only the
successful claim transitions the session to `running` or clears a prior terminal timestamp;
message, reply, lifecycle, and decision services never reopen execution first. Provider and MCP work
begins only after commit; no database lock is held across either call. Healthy workers renew their
lease indefinitely. Before transcript writes and MCP dispatch, the worker verifies its token is
still current, so a stale recovered worker cannot resume side effects. Transcript presence never
selects Athena's admission policy: a transcript-free Athena reply or lifecycle resume initializes
its first transcript only after winning a generation. The direct status-only compatibility fallback
is restricted to transcript-free registered-agent sessions.

Athena has no wall-clock or job-duration cap. `AGENT_MAX_TURNS` is one personal generation's
checkpoint quantum: reaching it completes that run record and continues from the durable transcript
without changing the session's `running` state. In the synchronous path the API claims
`generation + 1` directly. When the production-only `ATHENA_ASYNC_RUNNER_ENABLED` flag is on,
Docket instead persists the next queued generation and its payload-free dispatch intent before a
Cloudflare Workflow receives the opaque identity; Queue and Workflow never receive prompts, users,
credentials, or tool inputs. Approval, reply, resume, awaiting-input chat, and waiting-session
cancellation commit their wake intent with the human mutation. A signed every-minute Worker cron
recovers due intents in bounded batches with short leases and capped backoff. Approval and input
waits use durable Workflow events in repeated 365-day epochs, while Postgres remains the source of
truth. The signed boundary, resource names, recovery model, and operator commands live in
`docs/engineering/cloudflare-athena-execution.md`. Completion, explicit
pause/cancel, approval/input wait, or an actual error are the only settlement boundaries. Registered
agents retain the legacy terminal turn cap. `ATHENA_MAX_CONCURRENT_RUNS` defaults to eight and can be
configured from 1–64. Registered-agent admission remains workspace-scoped. SSE gains a DB-poll live
tail (restart-safe; Last-Event-ID resume).

## 7. Ghost projection (slices 5c/9 — shipped; see docs/design/ghost-grammar.md)

Pending proposals are **data the UI projects into real views**: a read endpoint groups
still-`proposed` activities by `proposalGroupId` and shapes each `toolCall` into a ghost
DTO keyed by surface (proposed tasks for a project / Today). Inline ghost edits PATCH the
stored `toolCall.input` before approval. Approval solidifies in place (stable
`view-transition-name`; no view swaps). Ghosts are visible only to approvers. Non-spatial
changes fall back to the session proposal card.

## 8. Remote MCP connections (personal ownership shipped)

`mcpConnector` boundaries port (real: streamable-HTTP SDK client; mock: fixture registry
incl. a Sunsama server). Org-level rows: `integration.provider = 'mcp'`, alias
`^[a-z][a-z0-9_]{1,20}$` unique per org; connect = live `tools/list` health check ("never
report success when nothing happened"). The toolbox unions connections — Docket tools bare,
remote tools `<alias>__<name>` (collision-free by construction) — and remote tools without
`readOnlyHint: true` classify as writes (fail closed).

Personal rows live in `personal_mcp_connection` with an owner-matched
`personal_mcp_credential`. They are connected once per Better Auth user, reusable by that user's
Athena in every workspace, and invisible to every other user. URL preview initializes the server
and returns its advertised visible name; the create and update contracts always include that
editable name. Bearer and OAuth material is sealed with AES-256-GCM and the composite credential
foreign key prevents a credential owner from differing from its connection owner.

`openToolbox({kind:'athena', ownerUserId})` loads only connected personal rows for that owner.
`openToolbox({kind:'registered_agent', organizationId, agentId})` continues loading only
workspace `integration.provider='mcp'` rows. A remote tool call uses the selected connection's
owner-matched credential. Docket tools remain independent: they resolve the Athena owner's current
human Actor and permissions in the target workspace on every call.

## 9. Personal API (shipped)

`/v1/me/athena` is the permanent user boundary. Every handler derives the owner from the Better
Auth request session and selects only `executor_kind='athena' AND owner_user_id=<caller>`; no input
schema accepts an owner id. The root and `/sessions` reads return product-ready summaries grouped
as `needs_you`, `working`, and `finished`, plus matching counts and the current personal chat.
Detail, activity, proposal, lifecycle, decision, reply, and SSE paths all reuse the same owner
predicate. Organization session routes remain compatibility doors and keep registered-agent
behavior unchanged.

`AthenaInvocationContext` supports optional workspace focus and these canonical source pointers:
task, project, initiative, program, calendar item, and Stream event. Creation loads the source,
derives its workspace, checks any supplied workspace for equality, and confirms the caller's active
membership and view access at that instant. Calendar items must be caller-owned and linked/shared
to the workspace; Stream events must concern the caller. The normalized context is stored with the
first user activity for later summaries. It remains attribution only: tools and approval resumes
reauthorize independently in the action's actual workspace, which may differ from the session's
initial focus.

The personal projection omits provider `thought` rows from JSON detail, activity lists, and SSE.
The durable transcript retains provider state required for correct continuation, while product
clients receive only user messages, application-visible progress, structured actions/results,
elicitations, and errors. SSE resumes after the exact persisted `Last-Event-ID`; it does not assume
random ULIDs created in the same millisecond are lexically ordered.

Local/test execution and every registered-agent compatibility route preserve synchronous `200`
settle responses. With the production asynchronous runner enabled, personal create, eligible chat
message, run, approval/rejection, reply, and resume mutations persist their admission or wake first
and return `202`; delivery failure leaves a retryable outbox row rather than losing the generation.
The visible parent session is `running` while its admitted generation is `queued`.
The temporary organization-scoped compatibility routes follow the same executor split and owner
privacy as `/v1/me/athena`. A chat already awaiting approval or canceled remains parked after a new
message and returns `200` without dispatch, matching the canonical personal route.

## 10. User-owned assignments and triggers

`athena_assignment` is a private delegation to an initiative, project, or task. It never changes an
initiative owner, project lead, task assignee, or task delegate, and it never creates an Athena
Actor. Creating an assignment confirms the user's current `contribute` access, writes a personal
inbox notice, and starts an `executorKind='athena'` session and fenced run with the Better Auth user
as `ownerUserId`. Initial, event-triggered, and scheduled assignment runs all enter the shared
personal admission path: production persists and dispatches an asynchronous generation, while
local/test execution uses the synchronous fallback. Multiple assignments are independent and do
not take entity writer leases.

`athena_trigger` belongs to the same user through an owner-matched composite foreign key. Event
triggers accept only events in the assigned entity's live subtree. Scheduled triggers run no more
frequently than every five minutes; every trigger has a five-minute-or-longer cooldown and is
claimed before execution. Each fire restores `ownerUserId`, resolves the current active human Actor,
and rechecks access to the assignment target. Missing membership, suspension, target deletion, or
permission loss pauses the assignment and disables all its triggers. The personal REST surface and
the `pause_athena_assignment_trigger` / `remove_athena_assignment_trigger` Docket tools match both
assignment and trigger to the current user, so Athena can manage no other person's automation.

Subtree membership is only trigger routing, never authorization. Before an event trigger claims its
cooldown or builds a prompt, it resolves the emitted subject by exact type, id, and organization and
requires the restored owner's current Actor to hold both `view` and the action's `contribute`
capability on that subject. An initiative association therefore cannot reveal an inaccessible
linked project or program. Denied subjects count only as a safe skipped outcome: no run is created,
and neither caller-supplied event titles nor subject titles enter the prompt. Allowed prompts use
the canonical database title resolved after authorization.

## 11. Fresh-database rollout

The user-owned executor model does not backfill legacy Athena data. Existing databases must be
reset and rebuilt from the complete migration chain. Migration `0041` adds the executor columns,
indexes, foreign keys, and exclusive-attribution checks, but contains no data updates or ownership
heuristics. Legacy sessions, runs, transcripts, chats, Athena agent rows, and connector credentials
are not supported by this rollout; users reconnect personal services after reset. Local development
uses `pnpm db:reset`; deployed environments start from an empty database. Migration `0042` adds the
fenced run lease token, deterministic workflow-id check, and internal `executing` action claim.
Migration `0043` creates the personal connection, credential, assignment, and trigger tables using
DDL only. It never inspects or backfills legacy integration credentials, sessions, or assignees;
users reconnect personal services after the required reset.

## 12. Entitlement (slice 6 — shipped)

`assertAgentSessionsEntitled(orgId)` at `driveSession` first-run — the single choke point
covering REST, the `trigger_agent` MCP tool, and proactive sweeps. Entitled =
`organization.lifecycleState ∈ {trialing, active}` (the trial IS the funnel). Typed
`AgentPlanRequiredError` (402, `agent_plan_required`) for the web upsell.

## 13. Personal ambient experience

Athena is one private, user-owned operations layer rather than a workspace destination or a chat
transcript. The app shell exposes a compact needs-you/working pulse and a contextual `Cmd/Ctrl+J`
dock on personal and workspace routes. Today, tasks, projects, initiatives, Stream, Calendar, and
Inbox pass optional workspace and source context through the same invocation contract; context
focuses work but never changes ownership or authority.

`/athena` is the canonical full surface. It groups personal work into Needs you, Working, and
Finished, keeps the objective and current decision ahead of chronology, and reuses the same
workbench as the dock and `?session=` deep links. Tool activity is rendered as a structured
`Service · Action` row with an outcome. Provider/tool identifiers and payloads remain inside an
explicit Technical details disclosure, and model reasoning is removed by the pure presentation
adapter before React receives the work log. Empty queues can start work directly. Legacy workspace
Athena and Agents URLs preserve the workspace as optional query context while redirecting here.

The web transport is temporarily isolated behind `PersonalAthenaTransport` and the shared typed
TanStack Query helpers until the generated client includes `/v1/me/athena`; components do not call
raw `api.v1.*` clients or hand-roll effect-based fetching.

## 14. Testing doctrine

Everything runs with `APP_MODE=test`, zero API keys: scripted mock turns drive the real
loop; the mock Sunsama server backs the import flow; restart resilience is tested by
settling to `awaiting_approval`, constructing nothing in memory, approving, and re-entering
purely from the DB. Race coverage holds provider turns open to prove duplicate-call exclusion and
heartbeat renewal, recovers expired leases, crosses multiple personal generations, races approval
decisions, and proves an `executing` action is not repeated. Boundary adapters get pure translation
tests with injected fakes.
