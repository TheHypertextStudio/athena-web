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
| `agent_session.kind`                 | `chat` \| `job` (default `job`). Athena chat lookup is personal; legacy workspace-shared chats remain registered-agent history.                                                                                                                                   |
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

- `execute`: call via the executor toolbox; Athena acts as the owner's current human Actor and a
  registered agent acts as its own Actor. Stamp `approvalStatus:'applied'` +
  `body.action.result`; write an `audit_event`; feed the `tool_result` back.
- `propose`: persist with `approvalStatus:'proposed'` + shared `proposalGroupId`; settle the
  session `awaiting_approval`; **stop**. Approval (`decideActivity` + a new
  `executeApprovedActions`) executes the stored `toolCall`, appends paired `tool_result`s,
  and re-enters the loop. A rejection feeds an `isError` tool_result back so Athena adapts
  (session continues); session-level reject keeps cancel semantics.
- `record_only`: persist as `mode:'suggestion'`; feed a synthetic "recorded, not executed"
  result so the model proceeds.

Elicitations are a Docket-side `ask_user` tool (deterministic, no MCP surface change).
Turn count is bounded by explicit `AGENT_MAX_TURNS`. Athena admission is per user, defaults to eight
simultaneous `running` sessions, and can be configured from 1–64 with
`ATHENA_MAX_CONCURRENT_RUNS`. Admission locks the stable owner user row and performs the active-run
count plus pending-to-running transition in one short transaction; provider and tool work begins
only after commit. Registered-agent admission remains workspace-scoped. SSE gains a DB-poll live
tail (restart-safe; Last-Event-ID resume).

## 7. Ghost projection (slices 5c/9 — shipped; see docs/design/ghost-grammar.md)

Pending proposals are **data the UI projects into real views**: a read endpoint groups
still-`proposed` activities by `proposalGroupId` and shapes each `toolCall` into a ghost
DTO keyed by surface (proposed tasks for a project / Today). Inline ghost edits PATCH the
stored `toolCall.input` before approval. Approval solidifies in place (stable
`view-transition-name`; no view swaps). Ghosts are visible only to approvers. Non-spatial
changes fall back to the session proposal card.

## 8. Remote MCP connections (slice 7 — shipped)

`mcpConnector` boundaries port (real: streamable-HTTP SDK client; mock: fixture registry
incl. a Sunsama server). Org-level rows: `integration.provider = 'mcp'`, alias
`^[a-z][a-z0-9_]{1,20}$` unique per org; connect = live `tools/list` health check ("never
report success when nothing happened"). The toolbox unions connections — Docket tools bare,
remote tools `<alias>__<name>` (collision-free by construction) — and remote tools without
`readOnlyHint: true` classify as writes (fail closed).

Workspace-owned remote MCP connections currently load only for registered agents. Athena's toolbox
exposes Docket tools alone until the personal connection ownership migration lands; it never
borrows a workspace credential as a substitute for a user-owned connection.

## 9. Entitlement (slice 6 — shipped)

`assertAgentSessionsEntitled(orgId)` at `driveSession` first-run — the single choke point
covering REST, the `trigger_agent` MCP tool, and proactive sweeps. Entitled =
`organization.lifecycleState ∈ {trialing, active}` (the trial IS the funnel). Typed
`AgentPlanRequiredError` (402, `agent_plan_required`) for the web upsell.

## 10. Testing doctrine

Everything runs with `APP_MODE=test`, zero API keys: scripted mock turns drive the real
loop; the mock Sunsama server backs the import flow; restart resilience is tested by
settling to `awaiting_approval`, constructing nothing in memory, approving, and re-entering
purely from the DB. Boundary adapters get pure translation tests with injected fakes.
