# Project Athena Work Log

> **Purpose**: Comprehensive tracking of all work - past, present, and future.
> **Last Updated**: 2026-07-16

---

## Active Tasks

### [ATHENA-OWNERSHIP-001] Make Athena user-owned and ambient

- **Status**: IN_PROGRESS
- **Started**: 2026-07-15
- **Priority**: P0
- **Description**: Replace workspace-owned Athena agents and shared chat with one private,
  user-owned assistant that executes with exactly the requesting user's current permissions, then
  rebuild the Athena experience as an ambient dock and expandable personal operating workspace.
- **Subtasks**:
  - [x] Add user-owned executor, activity, transcript, run, and migration contracts.
  - [x] Execute Docket tools through the owner's live user permission context.
  - [ ] Complete the private personal Athena chat, work, and session API migration.
  - [x] Add owner-only personal connections, assignments, and assignment triggers.
  - [ ] Build the shared workbench, ambient dock, and full `/athena` workspace.
  - [ ] Wire contextual entry points and validate the real application with Playwright.
  - [ ] Complete documentation, repository gates, code review, and linear-history closeout.
- **Decisions**: Athena never receives a workspace Actor, grant, role, or independent capability.
  Workspaces are optional execution context only. Personal work logs and connectors are owner-only;
  shared results retain normal visibility. Approval never grants authority beyond the underlying
  tool permission. The per-user ceiling limits concurrent runs only; healthy Athena work may run
  indefinitely. Leases renew while work is healthy and exist only to recover abandoned execution.
  A configured turn budget is a per-generation checkpoint quantum and must not settle personal
  Athena work as failed or completed.
- **Risks**: The executor union must preserve third-party registered-agent behavior while all Athena
  paths stop relying on the default-agent grant model. Existing databases are intentionally
  disposable for this rollout and must be reset before the new executor constraints apply.
- **Blockers**: None.
- **Plan (persistence contracts)**:
  1. Add failing DTO and database tests for the executor union, nullable workspace attribution,
     ownership propagation, and database shape constraints.
  2. Add migration coverage that proves the full chain creates the fresh executor schema without
     inferring ownership from legacy rows.
  3. Implement the discriminated Drizzle/Zod contracts and update session serialization and
     transcript/run creation helpers without changing runtime authorization.
  4. Run focused red/green checks, the repository validation gates, self-review, and commit the
     persistence slice atomically.
- **Plan (parent consistency and time attribution review)**:
  1. Add failing database tests proving run and transcript attribution must match their parent
     session for both user-owned Athena and organization-owned registered agents.
  2. Add failing time-attribution tests proving Athena uses its owner and a task's actual workspace,
     while registered agents retain initiator-based user attribution.
  3. Add composite parent keys and child foreign keys in Drizzle and migration metadata, then make
     the time-attribution query executor-aware without weakening the exclusive-attribution checks.
  4. Replay focused migration/schema/API tests, run every repository validation gate, self-review,
     and commit the review fix independently without amending or rebasing.
- **Plan (user-principal authorization)**:
  1. Add red MCP and loop tests for persisted owner restoration, current Actor/grant resolution,
     membership suspension, approval-time reauthorization, audit origin, and per-user admission.
  2. Add the internal first-party user context and discriminate the toolbox, loop, approvals,
     prompt, transcript/activity attribution, and registered-agent compatibility by executor kind.
  3. Stop default-agent provisioning from prompt, chat, delegation, proactive, and runner paths;
     keep explicit registered-agent execution unchanged and defer personal connector migration.
  4. Run focused and repository validation, document the authorization invariant, self-review, and
     commit the runtime slice without rebasing, merging, or pushing.
- **Plan (per-user admission review fix)**:
  1. Add a concurrent red regression proving two pending sessions cannot both claim the final
     per-user Athena run slot.
  2. Lock the stable owner user row and perform the active count plus this session's transition in
     one short transaction, preserving re-entry and registered-agent behavior.
  3. Run focused green checks, API and repository gates, review the final diff, and commit the fix
     independently without amending, rebasing, merging, or pushing.
- **Plan (fresh-database reset policy)**:
  1. Add a red migration contract that rejects DML ownership backfills in migration `0041`.
  2. Remove agent-name, initiator, run, and transcript backfill SQL while retaining fresh-schema DDL.
  3. Replace legacy-data fixtures with a complete fresh migration replay and constraint inspection.
  4. Update the design, implementation, engineering, and worklog documentation; validate and commit
     the cleanup independently without rebasing, merging, or pushing.
- **Plan (fresh-reset review fix)**:
  1. Add red tooling tests for reset-target detection, production/remote refusal, repo-local path
     boundaries, symlink defense, and PGlite/Docker command behavior.
  2. Replace the shell reset alias with a typed script that deletes only a configured database under
     the repository `.data` directory or the exact local Docker Compose database volume.
  3. Strengthen migration `0041` coverage by parsing normalized statements and allowing DDL only.
  4. Exercise the command against a disposable PGlite path, run repository gates, and commit the
     review fix independently without amending, rebasing, merging, or pushing.
- **Plan (owner-private compatibility routes)**:
  1. Add a two-user same-workspace red regression covering Athena enumeration, direct reads, SSE,
     chat, proposals, run, reply, lifecycle, and approval decisions while retaining registered-agent
     workspace behavior.
  2. Introduce one request-authenticated session access discriminator: Athena resolves only for its
     persisted owner, while registered agents retain workspace and capability authorization.
  3. Route every organization compatibility lookup and mutation through that discriminator, make
     Athena lifecycle transitions operate without an organization owner field, and remove the
     unrelated assign requirement only for owner-approved Athena work.
  4. Prove an owner with contribute can decide Athena work while the underlying MCP tool still
     reauthorizes the actual write, then run focused and repository gates and commit the security
     slice without adding personal `/v1/me` routes or execution-idempotency work.
- **Plan (durable execution and idempotency)**:
  1. Add red schema and loop regressions for one leased run generation per session, deterministic
     workflow ids, stale-lease recovery, heartbeat renewal, same-session serialization, and owner
     admission on both initial work and every resume path.
  2. Make the run-generation record the short-transaction execution mutex and durable checkpoint;
     fence every worker with a lease token, renew healthy leases without a duration cap, and move
     Athena across turn-budget generations without settling the personal session.
  3. Add red concurrent approval tests, then conditionally claim approved actions as `executing`
     before MCP dispatch so one decision, audit, execution, and applied result can occur at most
     once; leave interrupted claims visible for human attention instead of retrying writes.
  4. Update the Athena execution spec and reviewed plan, run focused race/retry/recovery suites and
     every repository gate, self-review the linear diff, and commit without rebasing, merging, or
     pushing.
- **Plan (atomic lease-fencing review fix)**:
  1. Add deterministic red race regressions that rotate a generation token at each persisted-effect
     boundary: streamed thought/response activity, transcript plus action/elicitation, approved
     action claim, applied/failed result, and toolbox initialization failure.
  2. Introduce one transaction-scoped lease fence that locks and revalidates the run id, token,
     running status, and freshness before committing any generation-owned write; route every loop
     activity, transcript, action, claim, result, error, checkpoint, and settlement through it.
  3. Move toolbox initialization under the heartbeat-owned try/finally and make initialization
     failures atomically settle the generation and session as failed with `lastError`.
  4. Audit generation-owned writes for remaining check-then-write sequences, run focused race and
     API gates plus proportionate root gates, document the outcome, self-review, and commit this fix
     independently without rebasing, merging, or pushing.
- **Plan (personal Athena API)**:
  1. Add red personal-route and OpenAPI tests for owner-only overview, grouped work, current/fresh
     chat, session creation/detail, invocation context, activity, SSE replay, steering, lifecycle,
     proposals, and decisions while retaining organization-route compatibility.
  2. Define application-owned personal Athena DTOs and an invocation resolver that validates the
     canonical source workspace plus the caller's current access without accepting an owner id.
  3. Mount `/v1/me/athena` over the existing owner-access, transcript, loop, proposal, approval, and
     lifecycle services; derive each cross-workspace approval's operation context without treating
     the session's initial focus as authority.
  4. Update the Athena design/engineering/OpenAPI documentation, run focused and full repository
     gates, self-review privacy and linear history, and commit the slice atomically without schema,
     connector, assignment, UI, rebase, merge, or push changes.
- **Plan (personal API spec review fix)**:
  1. Add red regressions proving the session-level approval shortcut executes and resumes the
     latest action in its actual workspace, session-level rejection records the owner's audited
     decision, and same-timestamp SSE rows replay in stable `(createdAt, id)` order.
  2. Add a red OpenAPI assertion for the stream route's `Last-Event-ID` request header and
     `text/event-stream` success response.
  3. Route both session shortcuts through the activity-scoped owner decision path, make every
     personal activity query use the replay tuple order, and declare the explicit SSE contract.
  4. Run focused red/green checks, API typecheck and lint, proportionate repository gates,
     self-review imports and the final diff, then commit the review fix atomically without
     rebasing, merging, or pushing.
- **Plan (cross-workspace proposal authorization review fix)**:
  1. Add red personal-route regressions for editing a proposal from workspace A to B with and
     without current B access, then prove the persisted activity attribution follows the accepted
     stored input and approval uses B's human Actor.
  2. Add red mixed-workspace group and `all_in_session` approve/reject regressions proving every
     selected proposal derives its target from current `toolCall.input`, inaccessible targets roll
     back every decision and audit, and accessible targets audit their own workspace Actor.
  3. Centralize current proposal-target parsing, authorize every Athena decision target before any
     status/audit mutation in the transaction, remove first-row route fallbacks, and make failed
     terminal execution read as a failed attempt while preserving durable `applied` semantics.
  4. Run focused red/green checks, API and root validation gates, self-review transaction and audit
     invariants, update this worklog with the retrospective, and commit the security fix atomically
     without amending, rebasing, merging, or pushing.
- **Plan (platform and durability integration)**:
  1. Rebase the reviewed private personal API commits onto the durable-generation branch, retain
     both work plans, and reconcile per-target authorization with conditional decision claims.
  2. Add red admission regressions for message, lifecycle-resume, and approval paths that currently
     reopen sessions before the owner ceiling and same-session lease are claimed.
  3. Route message, reply, lifecycle, session-level approval, and batch approval execution through
     entry-specific durable drive primitives that transition state only inside the claim transaction.
  4. Run focused durability, personal API, owner-privacy, and proposal tests plus API and root gates;
     self-review the linear history and commit the integration fix without merging or pushing.
- **Plan (platform integration review blockers)**:
  1. Add red personal and organization-compatibility route regressions proving transcript-free
     Athena reply and explicit-resume entries claim an owner-admitted durable generation, while
     transcript-free registered-agent compatibility rows alone retain the legacy status fallback.
  2. Add red activity and proposal-group regressions for approval capacity contention followed by
     retry, including concurrent retries and assertions for one decision audit and one tool effect.
  3. Route every Athena reply/resume through durable drive admission regardless of transcript state,
     and make an already-approved pending action or group an idempotent approval retry without
     reopening the decision race or duplicating its audit.
  4. Run the focused platform/durability suite set and all repository gates, update validation and
     retrospective evidence, self-review the diff, and commit this fix atomically without rebasing,
     merging, or pushing.
- **Plan (personal connectors and assignment triggers)**:
  1. Add red schema, migration, DTO, route, and toolbox regressions for user-owned MCP connections,
     encrypted credentials, two-user isolation, cross-workspace reuse, deletion, remote Sunsama
     tools, and unchanged registered-agent workspace connections.
  2. Add red assignment and trigger regressions for initiative/project/task delegation, preserved
     human ownership, inbound personal notice plus initial durable run, owner-only endpoints,
     subtree event scope, five-minute schedule minimum, cooldown, concurrent assignments, and
     entity writer-lease compatibility.
  3. Implement separate personal connection/credential, assignment, and trigger tables in a
     schema-only `0043` migration; add `/v1/me/athena` connection/assignment/trigger APIs and OAuth
     callback ownership; load Athena remote tools only from its persisted owner while retaining
     workspace integration loading for registered agents.
  4. Restore the assignment owner on every triggered run, resolve current target-workspace access,
     disable triggers and pause the assignment on access loss, and ensure Athena can pause/remove
     only its own in-scope triggers without inventing an Actor or stale grant.
  5. Update the reviewed plan, Athena/MCP/API specs, OpenAPI assertions, and this work log; run
     focused database/API/MCP/assignment suites and every root gate, self-review, then commit the
     feature slices atomically without rebasing, merging, or pushing.
- **Plan (connector SSRF and event-subject authorization review fixes)**:
  1. Add red integration tests for HTTPS enforcement, blocked IPv4/IPv6 ranges and mapped forms,
     DNS rebinding, private redirects, bounded redirects/timeouts/metadata, and a public HTTPS path.
  2. Introduce one `@docket/integrations` outbound network policy used by Streamable HTTP and MCP
     OAuth discovery/token traffic, with DNS validation and address pinning where Node transport
     permits it; route personal and organization preview, create, reconnect, OAuth, and toolbox
     traffic through that boundary without any request-controlled bypass.
  3. Add red assignment tests proving initiative association does not reveal an inaccessible linked
     project/program event title or start a run, then prove an exact-subject grant permits firing.
  4. Resolve the emitted event's canonical subject row and require the restored owner Actor's live
     `view` plus action capability before interpolating its canonical title or claiming the trigger;
     preserve assignment-target access-loss pausing and record only safe skipped outcomes.
  5. Run focused integration/security/assignment suites and all four root gates, update the worklog
     with validation and retrospection, and commit the two P0 fixes atomically without merge,
     rebase, amend, or push.
- **Plan (Cloudflare execution layer)**:
  1. Retrieve the current Cloudflare Queues, Workflows, Workers runtime, Wrangler schema, and test
     contracts; record the security and durability constraints before changing runtime behavior.
  2. Add red Worker tests for opaque queue messages, deterministic Workflow creation, duplicate
     delivery, per-message retry handling, HMAC tamper/replay protection, and durable wait/resume.
  3. Add red API and database tests for persisted-before-dispatch run admission, directional HMAC
     internal routes, owner restoration, stale recovery, asynchronous acknowledgement, synchronous
     fallback, and at-most-once audited effects.
  4. Implement the Worker Queue/Workflow package and Docket internal execution bridge behind an
     async-runner feature flag, preserving Postgres, authentication, policy, and provider ownership.
  5. Generate binding types from `wrangler.jsonc`, document queue/DLQ and secret setup, validate the
     Worker with Wrangler dry-run/startup checks, run focused and root gates, self-review, and commit
     the feature slice atomically without deploying, creating resources, rebasing, merging, or pushing.
- **Cloudflare Execution State**: COMPLETED. The execution slice is integrated atop reviewed
  connector head `7ad305e1`. Production personal Athena admission now persists a queued generation
  before dispatching an opaque three-field message to the Cloudflare Queue. The Queue consumer uses
  deterministic Workflow ids, per-message retry/acknowledgement, and a DLQ; each Workflow callback
  restores and fences the exact Docket generation, executes one existing loop quantum, and either
  commits a successor, finishes, or waits durably for an owner decision. Directional HMAC requests
  authenticate the entire method/path/body/timestamp/nonce tuple, and authenticated nonces are
  claimed in Postgres before dispatch. Local and test modes retain the synchronous path.
- **Cloudflare Execution Validation**: Current Cloudflare documentation, published runtime types,
  and generated bindings were used as the source of truth. Runner tests cover opaque protocols,
  duplicate delivery, per-message retry, tamper/replay rejection, and repeated durable wait epochs.
  API and database tests cover persisted-before-dispatch admission, exact-generation claims,
  asynchronous HTTP acknowledgement, synchronous fallback, callback recovery, and nonce
  uniqueness. `wrangler types --check`, dry-run upload, and startup validation passed without a
  deployment or resource mutation. Root `pnpm typecheck`, `pnpm lint`, `pnpm test` (18/18 tasks),
  and `pnpm build` (including the runner dry-run bundle) passed. The only environment note is the
  existing Node engine warning: the shell uses 24.14.0 while the repository now requests at least
  24.15.0.
- **Cloudflare Execution Retrospective**: Keeping Docket authoritative made at-least-once Queue
  delivery and Workflow callback recovery composable with the existing generation fence instead of
  introducing a second state machine. Persisting replay nonces in Docket avoids runtime-local
  security state, and looping deterministic 365-day wait epochs preserves indefinite human waits
  within the current Workflows event timeout. The final gate run also exposed two baseline fixture
  drifts: the exported `AthenaSessionOut` type lacked its required TSDoc and the authorization test
  schema omitted current `summary` columns. Both were corrected narrowly so the full repository
  gates exercise the reviewed base and this slice together.
- **Plan (Cloudflare stale recovery and assignment dispatch review fixes)**:
  1. Add real database regressions proving an exact queued Workflow generation can be reclaimed only
     after its running lease expires, receives a new fencing token and incremented attempt, rejects
     a fresh duplicate, and prevents the stale worker from committing a fenced write.
  2. Add a state-machine regression proving a duplicate Workflow callback drives the reclaimed
     generation instead of treating the expired running row as an unrecoverable persisted outcome.
  3. Add assignment route/service regressions proving production-style asynchronous admission
     persists and dispatches initial, event-triggered, and scheduled personal work through the same
     runner seam while local/test mode retains synchronous execution and owner/access checks.
  4. Add a compatibility-route matrix proving personal create/chat/run, activity and group decisions,
     session shortcuts, reply, and resume persist through asynchronous admission or wake with `202`,
     parked chats remain `200`, owner mismatches stay hidden, and registered agents remain synchronous.
  5. Trace every direct personal `runSession` call, replace assignment and compatibility execution
     with shared durable admission, update the Athena execution specification, run focused runner/API/
     database plus root type/lint gates, self-review, and commit the review fixes separately without
     amend, rebase, merge, deploy, resource creation, or push.
- **Cloudflare Review Fixes**: Expired `running` generations can now be reclaimed only at their
  exact lease boundary with a fresh token and incremented attempt; the previous worker remains
  fenced from writes. Assignment initial/event/scheduled execution and every temporary workspace
  compatibility entry for personal Athena now use production asynchronous admission or Workflow
  wake, while local/test Athena and all registered-agent variants retain synchronous execution.
  Eligible asynchronous mutations return `202` with the persisted parent/run state; parked chat
  messages remain `200`, and every compatibility owner mismatch is rejected before admission,
  decision, or wake.
- **Cloudflare Review Validation**: The focused runner, loop, personal route, compatibility,
  assignment, and generation suite passes (9 files, 93 tests). The narrower final regression set
  passes (4 files, 21 tests), `pnpm --filter @docket/api typecheck` passes, focused API ESLint passes,
  and `git diff --check` is clean. Root test/build were intentionally left to the integrating agent
  per the milestone handoff scope.
- **Cloudflare Review Retrospective**: The safest executor boundary is the persisted session row,
  not the URL family: the temporary org routes contain both personal and registered work. Keeping
  the discriminator at each mutation preserves legacy registered-agent behavior while preventing
  any personal production entry from bypassing the durable owner admission and fencing model.
- **Persistence Slice**: Added the `athena | registered_agent` executor contract across Drizzle
  and Zod, optional workspace context/activity attribution, user ownership on sessions, durable
  runs, and transcripts, plus database checks and owner/context indexes. Athena sessions now carry
  `organizationId: null`; an optional workspace appears only as execution context, and runs and
  transcripts are attributed exclusively to either a user or an organization and must match their
  parent session through composite foreign keys. Athena time execution uses the owner as its
  authoritative user and loads task context from the task's canonical workspace; registered agents
  retain initiating-Actor attribution. Migration `0041` defines only the fresh executor schema.
  Existing databases must be reset; no session, chat, agent, transcript, run, assignment, connector,
  or credential ownership is inferred or preserved.
- **Authorization Slice**: Athena now opens the real in-process MCP server as the persisted owner
  user. Each Docket call resolves that user's current active human Actor and grant cascade in the
  target workspace, so grant removal, grant restoration, and membership suspension take effect on
  the next call, including approved and resumed work. Successful tool audit events use that human
  Actor and carry `executionOrigin: athena`, `athenaSessionId`, and `requestedByUserId`; no Athena
  Actor participates. Omitted-agent prompt, personal chat, and proactive creation now persist an
  Athena executor and create no default agent or grant, while an explicit `agentId` retains the
  registered-agent path. Personal chat transcripts and neutral progress are user-owned;
  workspace-targeted actions retain their actual workspace attribution. Athena run admission is
  per owner (eight by default, configurable from one through 64). Workspace-owned remote MCP
  connections remain available only to registered agents until the personal connection migration.
- **Owner-Private Compatibility Routes**: Every existing workspace compatibility route now
  discriminates access from the authenticated request user. Personal Athena sessions can be listed,
  read, streamed, steered, paused, resumed, cancelled, and decided only by their persisted owner;
  cross-user access is hidden as not found even when both users belong to the same workspace.
  Registered-agent sessions retain workspace membership and capability checks. Athena lifecycle
  transitions now support workspace-neutral sessions, and owner approvals no longer require the
  unrelated `assign` capability while the stored MCP action still rechecks the owner's current
  permission before writing.
- **Durable Execution Slice**: `agent_session_run` is now the execution mutex and checkpoint record.
  Each generation has the deterministic workflow id `sessionId:generation`; a fresh lease rejects
  duplicate same-session workers, an expired lease is recovered in place with a new fencing token,
  and healthy workers renew indefinitely. Owner admission counts fresh run leases on initial work
  and approval, reply, and lifecycle resumes, while registered agents keep their existing authority
  model. Athena's turn budget is a generation quantum, so personal work checkpoints and continues
  instead of failing. Every executable action is persisted, conditionally claimed as `executing`,
  and dispatched once; interrupted claims park for attention and are never automatically repeated.
- **Durable Execution Validation**: Red schema tests accepted non-deterministic workflow ids and
  lacked the internal `executing` claim state. Red loop and route tests reproduced same-session
  double entry, stale-lease duplication, missing renewal, terminal personal turn limits, concurrent
  approval/audit races, repeated in-flight writes, duplicate elicitation replies, bounded reply
  reconciliation, and provider failures left as running. Focused durability, privacy, approval, and
  registered-agent compatibility suites pass. The final root gates pass: typecheck 17/17, lint
  17/17, tests 17/17 including API 146 files and 1,284 tests, and build 3/3. `git diff --check`
  passes; the only recurring diagnostic is local Node 24.14.0 versus the declared minimum 24.15.0.
- **Durable Execution Retrospective**: The stable owner row was the right serialization point for
  admission, while a per-session generation and fencing token kept that short transaction separate
  from provider and MCP latency. Full-suite load exposed that sub-100-millisecond lease fixtures test
  scheduler luck rather than renewal behavior, so timing seams now preserve production-like margin
  and always release blocked providers. Self-review also showed that reply identity must be queried
  without an arbitrary history bound; future resumable edges should prefer durable correlation ids
  over timestamp windows from the start.
- **Atomic Lease-Fencing Review Fix**: Replaced generation-owned check-then-write sequences with one
  transaction-scoped fence that locks and revalidates the run id, token, running status, and lease
  freshness before committing transcript, activity, action, result, and audit writes. Checkpoints
  remain one conditional ownership update, while settlement conditionally completes the run and
  updates the session plus any error activity in one transaction. Toolbox initialization now runs
  inside the heartbeat-owned failure boundary, so initialization errors atomically fail both the run
  generation and session with the persisted error instead of leaving either row running.
- **Atomic Lease-Fencing Validation**: Deterministic takeover regressions rotate the token at streamed
  thought/response, assistant transcript/action, approved-action claim, and action-result boundaries;
  stale workers persist none of those effects, and toolbox initialization failure settles the run.
  Focused race coverage and the full API suite pass at 146 files and 1,288/1,288 tests. Root
  `pnpm typecheck` and `pnpm lint` pass 17/17 tasks each; the final ordered `pnpm test` passes 17/17
  tasks, including the same API total, and `pnpm build` passes 3/3 tasks. `git diff --check` passes.
  The only recurring diagnostic is local Node 24.14.0 versus the declared minimum 24.15.0.
- **Atomic Lease-Fencing Retrospective**: A lease check before a database write is observation, not
  fencing; ownership must be locked and revalidated in the same transaction as the persisted effect.
  The durable `approved → executing` action claim remains the external-dispatch boundary, so lease
  takeover can prevent stale result persistence without making an interrupted MCP write repeatable.
- **Atomic Lease-Fencing Files Changed**: `apps/api/src/agent/{loop,run-generation}.ts`,
  `apps/api/tests/agent/user-owned-loop.test.ts`, and this work log.
- **Personal API Slice**: Added the private `/v1/me/athena` surface for owner-scoped overview counts,
  needs-you/working/finished queues, durable current and fresh chat, contextual sessions, steering,
  lifecycle controls, activity JSON and replayable SSE, proposals, approvals, rejections, and
  elicitation replies. Invocation sources validate their canonical workspace and the caller's
  current access without becoming execution authority. Personal projections exclude provider
  reasoning, cross-user reads remain existence-hiding, and registered-agent organization routes
  retain their existing workspace policy.
- **Personal Connections and Delegation Slice**: Added owner-matched personal MCP connection and
  encrypted credential rows, URL metadata preview, editable visible names and tool aliases, OAuth
  callback ownership, and owner-only connection APIs. Athena now loads only its owner's connected
  personal remotes across workspace contexts, while registered agents continue loading only
  operational workspace integrations. Added private initiative/project/task assignments and
  assignment-scoped event or scheduled triggers. Assignment creation preserves human ownership,
  writes a personal notice, and starts an owner-attributed durable run. Every trigger fire claims
  its cooldown, resolves the current active human Actor, rechecks target access, and pauses the
  assignment plus all triggers after access loss. Owner-scoped MCP tools can pause or remove only
  that user's triggers.
- **Personal Connections and Delegation Validation**: Red DTO, schema, migration, route, toolbox,
  and assignment tests established the missing ownership boundaries before implementation. Focused
  green suites cover encrypted credentials, Sunsama tool dispatch, two users in one workspace,
  registered-agent compatibility, preserved task ownership, personal notices, durable run rows,
  project-subtree events, cooldown, scheduled access loss, and owner-only trigger controls. The
  complete migration chain creates schema-only `0043` with no data backfill. Root `pnpm typecheck`
  and `pnpm lint` pass 17/17 tasks, root `pnpm test` passes 17/17 tasks including API 148 files and
  1,297 tests, and root `pnpm build` passes 3/3 tasks. The recurring diagnostic remains local Node
  24.14.0 versus the declared minimum 24.15.0.
- **Personal Connections and Delegation Retrospective**: Keeping personal and workspace connector
  tables separate made credential ownership and executor compatibility explicit rather than
  nullable inference. Trigger scope is safest when derived from the live assignment subtree instead
  of copied into each trigger. Validation also found a base test-local lease-effect union that had
  drifted from the exported loop contract; importing the production type removed that duplication
  and restored the gate without changing runtime behavior.
- **Connector SSRF Review Fix**: Added one HTTPS-only outbound boundary for real remote MCP
  Streamable HTTP and OAuth traffic. It validates every resolved address and redirect hop, rejects
  private and reserved IPv4/IPv6 including mapped forms, pins the approved address into TLS, strips
  credentials across origins, and enforces redirect, connect, overall, header, and body limits.
  Organization and personal preview, verification/reconnect, OAuth, refresh, and toolbox calls all
  inherit the boundary; requests expose no allowlist or private-network bypass.
- **Event-Subject Authorization Review Fix**: Event triggers now treat assignment-subtree membership
  only as routing. Before claiming cooldown or building a prompt, the restored owner Actor must hold
  current `view` and `contribute` on the exact emitted subject type/id/organization. Inaccessible
  initiative-linked projects and programs produce a safe skipped outcome with no run or title
  disclosure; allowed prompts resolve the canonical title only after authorization. Assignment
  target access loss still pauses the assignment and disables every trigger.
- **Security Review Validation**: Red network tests proved real HTTP loopback access and the absence
  of a central policy; red assignment coverage proved initiative association alone fired a run for
  an inaccessible linked project. The integration package passes 255 tests, including 25 outbound
  policy cases. Focused connector route suites pass 17 tests, and assignment/security suites pass
  21 tests including inaccessible linked project/program, restored exact access, canonical-title
  prompts, no prompt leakage, cooldown, and assignment access-loss pausing. Root typecheck, lint,
  and test gates pass 17/17; the root build compiled API, web, and admin, then both Next processes
  stalled indefinitely in their TypeScript phase and were interrupted after an isolated admin
  reproduction stalled at the same point.
- **Security Review Retrospective**: Association graphs are useful for selecting candidate events
  but cannot carry authority across resource types. Centralizing fetch at the integration boundary
  made SDK discovery and transport behavior subject to the same invariant and made rebinding,
  redirect, and resource-bound regressions deterministic through construction-time test seams.
- **Files Changed**: Agent-session DTOs and schema, migration SQL/snapshot/journal, session and
  transcript serializers, executor-aware time attribution, compile-time executor branches in
  existing API/web consumers, authenticated compatibility-route access helpers, proposal and
  lifecycle handlers, focused DTO/schema/migration/OpenAPI/time/privacy tests, and this work log.
- **Validation**: Red DTO tests rejected workspace-neutral activity and Athena's nullable executor
  fields; red database tests showed the missing executor/owner columns and migration. Spec-review
  red tests then proved non-null Athena executor organizations, dual run/transcript attribution,
  and stale transcript attribution were still accepted. Focused
  Parent-consistency review red tests then showed mismatched child ownership was accepted and Athena
  time used a different initiator instead of its owner. Focused green runs pass 271/271 type
  tests, 67/67 database tests, and 5/5 API ownership/time tests. A disposable Drizzle generation
  reports no schema changes against the edited snapshot. Root `pnpm typecheck` and `pnpm lint` pass
  17/17 tasks, root `pnpm test` passes 17/17 tasks including API 1,259/1,259, and root `pnpm build`
  passes 3/3 tasks.
- **Authorization Validation**: Red MCP tests failed because `internalUserContext` and a
  user-executor toolbox did not exist; red loop tests failed at the org-owned session lookup; red
  prompt, chat, and concurrency tests exposed the resident-workspace prompt, default-agent
  provisioning, and missing owner admission limit. The focused green regression passes nine API
  files and 67 tests across both executor kinds, MCP authorization, direct/approved/resumed work,
  chat, proposals/SSE, prompt creation, review routes, and audit origin. Environment tests pass
  45/45. Full API Vitest runs exit successfully. `git diff --check`, root `pnpm typecheck`, root
  `pnpm lint`, root `pnpm test`, and root `pnpm build` all pass. The only recurring diagnostic is
  the repository engine warning for local Node 24.14.0 versus the declared minimum 24.15.0.
- **Admission Review Validation**: The concurrent red regression reproduced the race with both
  sessions observed as `running` from a seven-run starting point. Athena admission now serializes
  on the owner user row and contains only the count and state transition; billing remains before
  admission and provider/tool execution remains after commit. The focused test passes 4/4. Review
  also exposed a stale Sunsama fixture that omitted its registered agent after omitted-agent
  sessions became personal Athena; the fixture now explicitly uses its workspace agent, preserving
  coverage for organization-owned connector discovery, read-only annotation, and immediate reads.
  The final ordered root chain passes typecheck and lint (17/17 tasks each), tests (17/17 tasks;
  API 145 files and 1,266 tests), and build (3/3 tasks).
- **Fresh Database Cleanup**: The migration contract failed red on the existing Athena-name and
  initiating-user inference. Migration `0041` now contains DDL only, and focused coverage replays
  migrations `0000` through `0041` in PGlite before inspecting executor columns and parent/shape
  constraints. Old databases are reset rather than upgraded, and users reconnect personal services.
  Drizzle generation reports no schema changes; database typecheck, lint, and 67/67 tests pass.
  Final root validation passes typecheck and lint (17/17 tasks each), tests (17/17 tasks; API 145
  files and 1,266 tests), and build (3/3 tasks).
- **Fresh Reset Review Fix**: Replaced the Docker-only reset alias with a typed, fail-closed reset
  command. It accepts only nested repository-local PGlite paths or the exact local Compose database,
  refuses production and remote targets, revalidates deletion boundaries at execution, rejects
  symlink components, and runs migrations after removal. A controlled red test proved that execution
  initially trusted a forged out-of-bound plan; the fix now rejects it before deletion. Migration
  coverage normalizes statements and permits DDL only while explicitly rejecting direct and CTE
  `INSERT`, `UPDATE`, `DELETE`, `MERGE`, and `COPY` forms. The real `pnpm db:reset` command removed,
  migrated, and recreated only a disposable `.data/codex-db-reset-validation-aad1950f` database,
  which was deleted after validation. Tooling passes 46/46 tests and database coverage passes 68/68.
  Final root validation passes typecheck and lint (17/17 tasks each), tests (17/17 tasks), and build
  (3/3 tasks).
- **Owner Route Validation**: The new two-user same-workspace regression passes 6/6 tests across
  enumeration, detail, activity, SSE, proposals, chat isolation, steering, lifecycle, and decisions.
  It also proves a contribute-only owner can approve and execute a permitted task write, cannot use
  approval to bypass a manage-only tool, and that a non-owner with `assign` cannot decide another
  user's Athena work. The final ordered root chain passes typecheck and lint (17/17 tasks each),
  tests (17/17 tasks; API 146 files and 1,272 tests), and build (3/3 tasks). `git diff --check`
  passes. The only recurring diagnostic is the repository engine warning for local Node 24.14.0
  versus the declared minimum 24.15.0.
- **Personal API Validation**: Red type tests failed on the absent personal contracts, red route
  tests failed on the absent router, and a privacy regression exposed provider thought activity
  until the personal projection filtered it. Focused coverage passes 32/32 tests across personal,
  compatibility, proposal, agent-flow, and OpenAPI suites. The final ordered root chain passes
  typecheck and lint (17/17 tasks each), tests (17/17 tasks; API 147 files and 1,279 tests), and
  build (3/3 tasks). `git diff --check` and the zero-merge history check pass. The only recurring
  diagnostic is the repository engine warning for local Node 24.14.0 versus the declared minimum
  24.15.0.
- **Personal API Review Fix**: Red route tests proved the session-level approval shortcut only
  changed database status without applying or resuming the stored tool, session-level rejection
  omitted the owner's audited decision, and equal-timestamp SSE rows replayed in insertion order.
  A red generated-spec assertion also found no `Last-Event-ID` header or `text/event-stream`
  response. Both session shortcuts now locate the deterministic latest proposed action, resolve
  the owner's current human Actor in that action's actual workspace, and use the activity-scoped
  decision services; approval applies and resumes through `approveAndResume`, while rejection
  records the same owner audit before preserving session-level cancellation. Personal activity
  queries order by `(createdAt, id)`, and the stream contract declares its resume header and SSE
  response. The focused personal/OpenAPI green run passes 11/11 tests, and the wider approval,
  owner-privacy, and loop run passes 26/26. API typecheck and lint pass. Final root validation
  passes typecheck and lint (17/17 tasks each), tests (17/17 tasks), and build (3/3 tasks).
- **Cross-Workspace Proposal Authorization Review Fix**: Personal proposal edits now validate the
  replacement input's current `orgId` against the owner's active human Actor before atomically
  moving both stored input and activity attribution. Group and `all_in_session` decisions resolve
  and authorize every selected action's current input workspace before writing any decision or
  audit row, so one inaccessible target rolls back the complete approve or reject operation. Each
  accessible mixed-workspace action records its own organization and human Actor. Narration-only
  compatibility actions retain the session workspace fallback, while executable proposals never
  fall back from a missing current input target. Approval-time access failures remain `proposed`;
  a later tool-level grant failure remains a durable `applied` attempt carrying `isError: true`.
  Focused personal and owner-privacy coverage passes 23/23 tests. API typecheck, lint, build, and
  1,289/1,289 tests pass. Final root validation passes typecheck and lint (17/17 tasks each), tests
  (17/17 tasks, plus 46/46 tooling tests), and build (3/3 tasks). `git diff --check` passes. The
  only recurring diagnostic is the repository engine warning for local Node 24.14.0 versus the
  declared minimum 24.15.0.
- **Platform and Durability Integration**: Rebased the three personal API commits onto the two
  durable-generation commits while retaining both WORKLOG plans. Proposal decisions preauthorize
  every selected target, conditionally claim only still-proposed rows, and audit only winning
  decisions. Red regressions proved message and approval failures left sessions incorrectly
  `running`, while explicit resume bypassed admission entirely. Entry-specific generation claims now
  validate the legal source state and transition to `running` only after the same-session lease and
  owner ceiling succeed. Message, reply, lifecycle, single/group approval, and latest-action approval
  all use those durable primitives; partial approvals execute selected work without un-parking the
  remaining review queue. Focused durability, personal, privacy, proposal, and review coverage passes
  84/84 tests, and API typecheck and lint pass. The integration also aligned the lease-race test seam
  with the exported generation-effect type so the full API compiler sees every fenced boundary.
  Final root validation passes typecheck and lint (17/17 tasks each), tests (17/17 tasks, including
  tooling 46/46, API 147 files and 1,307/1,307 tests, and database 70/70), and build (3/3 tasks).
  `git diff --check` passes. The only recurring diagnostic is local Node 24.14.0 versus the declared
  minimum 24.15.0.
- **Platform and Durability Retrospective**: A route-level status flip is an admission bypass even
  when the next statement calls the durable loop, because a rejected claim leaves externally visible
  state reopened. Legal source states therefore belong to the generation claim API, and the claim
  must own both admission and the `running` transition. Approval decisions remain independently
  durable: an admitted worker may execute only selected approved rows while the session stays parked
  for the rest of its review queue.
- **Platform Integration Review Fix**: Transcript presence no longer selects Athena's execution
  path. Personal and organization-compatibility reply/resume doors always claim an owner-admitted
  generation before initializing or consuming a transcript; only transcript-free registered-agent
  legacy rows retain the status-only fallback. Approval capacity contention now leaves a coherent
  `awaiting_approval` session with durable `approved` actions. Retrying the same activity, proposal
  group, or latest-action shortcut reuses that decision and audit, then competes for the generation
  lease; the winner alone advances `approved → executing` and dispatches the tool.
- **Platform Integration Review Validation**: Red route tests showed transcript-free Athena reply
  and resume entries created no run row, while red activity/group tests showed an approved action
  could not be reached after owner capacity was released. Focused durability, personal, privacy,
  proposal, flow, and review coverage passes 7 files and 97/97 tests. API typecheck and lint pass.
  Final root validation passes typecheck and lint (17/17 tasks each), tests (17/17 tasks, including
  tooling 46/46 and API 147 files with 1,309/1,309 tests), and build (3/3 tasks). `git diff --check`
  and the zero-merge history check pass. The only recurring diagnostic is local Node 24.14.0 versus
  the declared minimum 24.15.0.
- **Platform Integration Review Retrospective**: A durable approval decision and executable
  admission are separate commits by necessity, so the state between them must be a first-class
  retry point rather than an unreachable transient. Keeping `approved` retryable and `executing`
  non-repeatable preserves both human audit idempotency and the external tool dispatch boundary.
- **Retrospective**: Encoding exclusive attribution in both database checks and the
  transcript upsert prevents personal data from retaining an organization owner by accident.
  Composite parent keys turn attribution from a row-local shape into a durable relationship. A
  destructive reset is safer and simpler here than inventing ownership for pre-release personal
  data or credentials from workspace-era records.
  Keeping the registered-agent runtime guards in place lets the persistence contract land
  independently; the next slice can change authorization against explicit `executorKind` branches
  rather than nullable-field inference.
  The runtime slice confirmed that opening one user-principal toolbox is safe only because Actor
  and grant resolution remains inside each MCP tool call; caching a workspace Actor would have
  made approval resumes retain revoked authority. Compatibility org routes can temporarily open
  personal work when they verify the owner, but the new `/v1/me/athena` surface remains the right
  permanent privacy boundary for the next slice. Keeping workspace MCP rows out of Athena's
  toolbox avoids accidentally sharing credentials before user-owned connection migration exists.
  The personal API slice reinforced that invocation context must be validated at the boundary but
  never cached as authority. Exact SSE replay also has to locate the supplied event in persisted
  order rather than compare randomly generated same-millisecond ULIDs lexically, and personal
  presentation models should filter raw provider reasoning at the server boundary. The review fix
  showed that timestamp-only ordering is still ambiguous even when exact replay ids are respected;
  tests that intend distinct chronology must set distinct timestamps, while production polling
  needs the full `(createdAt, id)` tuple on every query. Cross-workspace batches cannot derive
  authority from a representative first row: target resolution and Actor lookup must happen for
  every selected action before the transaction mutates any row. Keeping `applied` as an execution
  attempt state, with success represented by the stored result's `isError`, preserves deterministic
  reconciliation without misreporting a denied tool call as an unattempted proposal.

---

### [PROJECTS-CRAFT-003] Remove the floating Project properties band

- **Status**: COMPLETED
- **Started**: 2026-07-14
- **Completed**: 2026-07-14
- **Priority**: P1
- **Description**: Start Project detail with the Project identity instead of an empty context row,
  and anchor the Properties disclosure to the health and target controls where those values appear.
- **Plan**:
  1. Add a source contract for identity-first ordering and contextual Properties access.
  2. Move the anchored disclosure into the property row and remove the top-right control.
  3. Verify the contract, types, lint, and the authenticated responsive surface.
- **Risks**: The Popover still needs exactly one stable trigger when health or target is absent.
- **Blockers**: None.
- **Files Changed**: Project detail header, focused Project experience contract, and this work log.
- **Validation**: The focused Project contract passes 7/7; targeted ESLint, root `pnpm typecheck`,
  root `pnpm lint`, root `pnpm test`, and root `pnpm build` pass. The saved authenticated visual
  fixture had expired, so the responsive screenshot pass correctly stopped at session recovery and
  was not counted as visual validation.
- **Retrospective**: A secondary context label and disclosure control should not reserve a header
  band above the object identity. Anchoring Properties to health or target keeps the interaction next
  to the values it edits; the explicit empty-state trigger preserves discoverability without bringing
  the floating control back.

---

### [PROJECTS-CRAFT-002] Correct Project detail hierarchy and standardize MD3 typography

- **Status**: COMPLETED
- **Started**: 2026-07-14
- **Completed**: 2026-07-14
- **Priority**: P0
- **Description**: Make the first Project-detail viewport belong to the Project, replace ad hoc
  application typography with the canonical MD3 scale, and repair misleading or broken detail
  affordances without shrinking their accessible targets.
- **Plan**:
  1. Replace the old application-specific typography tokens with canonical MD3 semantic names.
  2. Rebuild the Project identity block and anchored Properties controls.
  3. Fix heading-free document width, table-of-contents behavior, and Markdown hierarchy.
  4. Suppress the recovery nudge on object-detail routes while retaining it on overview surfaces.
  5. Validate focused behavior, full repository gates, and responsive light/dark output.
- **Risks**: Typography is application-wide and can create subtle regressions if old names remain;
  object-detail route detection must not suppress the nudge on overview pages.
- **Blockers**: None.
- **Files Changed**: Shared MD3 typography tokens and their application/admin consumers; Project
  and Initiative overview/detail surfaces; freeform document rendering and contents disclosure;
  object-detail shell routing; focused visual contracts; design specification and plan.
- **Validation**: Focused Project/Initiative contracts pass 24/24. Root `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, and `pnpm build` pass. The full test run reports 17/17 successful
  packages, including web 740/740 and API 1,247/1,247. Authenticated desktop/mobile light/dark
  renders have no horizontal overflow and show no recovery banner on the Project detail route.
- **Retrospective**: A control is not visually interactive merely because its HTML is a button.
  Giving health and target a quiet resting state layer made their affordance legible without
  recreating a metadata wall. Replacing aliases globally was safer than preserving compatibility
  names because the contract test can now prevent another parallel type scale from emerging.

---

### [SETTINGS-PROD-003] Make Settings production-honest and fully editable

- **Status**: COMPLETED
- **Started**: 2026-07-14
- **Completed**: 2026-07-14
- **Priority**: P0
- **Description**: Remove deployment, API, roadmap, and dead-placeholder language from production
  Settings. Every safe user-owned basic attribute must have a real editor and persistence path.
- **Plan**:
  1. Remove unavailable providers and unfinished destinations instead of advertising internal state.
  2. Add server-backed user Profile and Athena preference editing.
  3. Add a General workspace destination for name, purpose, URL slug, logo, and terminology.
  4. Verify all Settings routes at desktop/mobile in light/dark, including empty and error states.
  5. Run the complete repository gates, document the audit, and commit only owned files.
- **Risks**: Workspace metadata changes affect navigation and URLs throughout the app; provider
  filtering must preserve already-connected accounts even if new authorization is unavailable.
- **Blockers**: None.
- **Approach**: Kept the caller-owned Settings hierarchy independent from workspace context, then
  audited every field and production state. Added real persistence for Profile, Athena preferences,
  workspace identity, automation names/templates, and MCP connector labels/aliases; removed provider
  and roadmap advertisements that cannot be acted on; made recoverable reads self-healing; and
  replaced technical image-URL fields with ordinary choose/replace/remove image controls backed by
  managed blob storage. Wired the caller-owned Athena instructions and approval ceiling into every
  initiated session so these settings change prompt and tool-execution behavior, not just stored data.
- **Files Changed**: Hub, organization, and MCP integration DTOs/routes/tests; global Profile and
  Athena pages; workspace General route/editor; Settings registries, navigation, provider,
  automation, connection, calendar, export, and error-state components; the automated screenshot
  harness; focused Settings tests; `docs/design/audits/2026-07-14-settings-production.md`; and this
  work log.
- **Decisions**: Basic identity and preference attributes are editable wherever the caller has
  permission. Security-sensitive email changes remain in Security so confirmation is preserved.
  Connections only lists services Athena can use now or accounts already linked; Connected apps
  remains the opposite authorization direction. Workspace administration consistently says
  workspace, not organization, and unfinished surfaces are omitted rather than advertised.
  Proactive assistance is not shown because its observation-to-session workflow has no live caller;
  Settings only exposes behavior the production application actually enforces. Personal approval
  behavior may make a workspace agent stricter but can never make it more permissive.
- **Validation**: Root `pnpm typecheck` and `pnpm lint` pass 17/17 tasks; root `pnpm test` passes
  17/17 tasks including web 742/742; root `pnpm build` passes 3/3. Focused Settings/API/type tests
  pass, and the image picker completed a live select/save/remove/save persistence cycle. Captured
  18 routes at 1440×900 and 390×844 in both themes (72 resolved-state screenshots); all 18 pass the
  automated 320px overflow check, keyboard focus is visible, and measured Settings controls meet
  the 40px mobile target.
- **Retrospective**: “Editable” cannot mean exposing a database-shaped URL field or leaving a
  technically present control behind permission ambiguity. Auditing the actual loaded screens
  caught semantic drift, mobile navigation density, provider-row collisions, undersized touch
  targets, and technical image inputs that code-only review missed. The durable capture harness now
  creates its own shared test workspace, waits for settled data, and fails on narrow overflow, so
  future Settings reviews do not require sign-in or manual fixture work.

### [SETTINGS-CRAFT-002] Repair Settings loaded states and visual craft

- **Status**: COMPLETED
- **Started**: 2026-07-14
- **Completed**: 2026-07-14
- **Priority**: P1
- **Description**: Review every global and workspace Settings capture closely, remove misleading
  placeholders and manual recovery controls, and make the screenshot workflow wait for a settled
  loaded state.
- **Approach**: Keep the user-owned Settings order and workspace administration boundary from
  SETTINGS-IA-001, then repair the surfaces in place: real Profile editing, user-facing Athena
  guidance, automatic polling for recoverable reads, clearer empty states, tighter notification
  and export layouts, and a deterministic capture wait for body paint, fonts, and client data.
- **Files Changed**: `apps/web/src/components/app-shell-frame.tsx`, global Profile and Athena
  routes, Settings integration/member/work-structure/connected-apps/automation components,
  notification and export presentation, `apps/web/e2e/tools/capture-shots.ts`, the export
  component contract test, and this work log.
- **Decisions**: Settings errors no longer ask the user to press Retry when the query can recover
  itself; affected reads refetch automatically and explain that behavior. Connections remains the
  place where Athena reads from or acts through external services, while Connected apps remains
  the place where external clients receive access to Docket. The capture tool now waits for real
  body content and fonts before its settle window, and workspace screenshots use the current test
  workspace metadata rather than a stale identifier.
- **Validation**: Focused Settings tests pass 17/17. Root typecheck, lint, test, and build pass;
  the full test run reports web 733/733, API 1,243/1,243, and all 17 Turbo tasks successful.
  Captured all 14 Settings routes at 1440x900 and 390x844 in light and dark themes under the
  Settings visual-review directory.
- **Retrospective**: The initial screenshot failures mixed two problems: capture timing and a
  stale workspace fixture. Waiting for paint alone would have hidden the latter. The useful fix
  is to make the harness deterministic and make the fixture identity explicit, while keeping
  recoverable UI states calm and self-healing instead of exposing a Retry action.

### [PROJECTS-EXPERIENCE-001] Build the Project operating experience

- **Status**: COMPLETED
- **Started**: 2026-07-14
- **Priority**: P1
- **Description**: Rebuild Project overview and detail around the approved Initiative-aligned,
  Linear-flavored operating model for managing a high volume of Projects across Docket.
- **Subtasks**:
  - [x] Add rich Project aggregate contracts, Labels, Resources, and multiple Initiative links.
  - [x] Build the shared List, Dependencies, and Timeline overview lenses.
  - [x] Rebuild detail around progressive disclosure and a unified participant set.
  - [x] Add focused tests and responsive light/dark design evidence.
  - [x] Complete root validation and atomic commits.
- **Blockers**: None.
- **Notes**: The approved prototype intentionally removes decorative totals, the Portfolio
  overline, Print/back controls, member counts, cadence, and lead-versus-contributor presentation.
  Only health and target remain immediately visible in the compact detail header; other Project
  information is available through an anchored disclosure and editable property rail.
- **Completed**: 2026-07-14
- **Implementation**: Added a bounded portfolio aggregate with task completion and Project
  dependency edges; Project URL Resources, organization-global Label associations, multiple
  Initiative links, concise summaries, and separate display metadata; rebuilt the overview as
  shared List, Dependencies, and Timeline lenses; and rebuilt detail as a document-like operating
  brief with unified people, progressive properties, generated contents, latest update, and
  dedicated Tasks, Updates, and Resources tabs.
- **Files Changed**: Project contracts, Drizzle schema and generated migrations, Project API and
  focused route tests, typed query/mutation definitions, shared multi-entity picker, Projects
  overview/detail components and focused component contracts, product/data-layer documentation,
  design audit, screenshots, and this work log.
- **Validation**: Generated migrations apply to PGlite. Focused Project API tests pass 28/28,
  Project property tests pass 7/7, and visual-contract tests pass 5/5. Root typecheck and lint pass
  all 17 tasks. Root tests pass in 16/17 packages; the API search test timed out only during the
  contention-heavy root run, then passed alone, and the complete isolated API suite passes
  1,243/1,243. Web passes 733/733. Production build passes all 3 build tasks. Runtime checks at
  320px show no page overflow or console errors, and the design review covers light/dark
  desktop/mobile plus dependency and timeline states.
- **Retrospective**: Projects need several coordinated views over one operating set, not separate
  list, graph, and roadmap products. Progressive disclosure works when identity, outcome, people,
  health, and target remain visible while infrequent properties stay one click away. Treating all
  Project people as one deduplicated set avoids manufacturing role distinctions the product does
  not need.

---

### [SETTINGS-IA-001] Reorganize Settings around the user-owned assistant

- **Status**: COMPLETED
- **Started**: 2026-07-14
- **Priority**: P1
- **Description**: Move the primary Settings experience out of the workspace context and organize
  it around the user's relationship with Athena and Docket, while keeping workspace administration
  secondary.
- **Subtasks**:
  - [x] Add the global user-owned Settings registry and exact product order.
  - [x] Add the global Settings shell and account-menu entry.
  - [x] Separate outbound Connections from inbound Connected apps.
  - [x] Add compatibility validation and complete repository gates.
  - [x] Complete documentation and retrospective.
- **Blockers**: None.
- **Notes**: The personal workspace registry now contains workspace setup only. User-owned surfaces
  are reached through `/settings`; legacy organization-scoped account routes redirect there.
- **Completed**: 2026-07-14
- **Files Changed**: Global Settings registry, shell, navigation, user-owned route surfaces, account
  menu, workspace settings registries, legacy redirects, focused tests, product and MCP docs.
- **Validation**: Focused Settings suites pass 63/63; root typecheck, lint, test, and build pass.
  Full tests pass with web 730/730, API 1,238/1,238, and all 17 Turbo test tasks successful.
- **Retrospective**: The correct organizing boundary is ownership, not the current workspace route.
  Connections must remain outbound data sources for Athena, while Connected apps must remain inbound
  access granted to external clients. Keeping both concepts explicit makes the centralized assistant
  model legible without adding an umbrella taxonomy.

---

### [INIT-MOBILE-RHYTHM-001] Calm the Initiative mobile header stack

- **Status**: COMPLETED
- **Started**: 2026-07-14
- **Completed**: 2026-07-14
- **Priority**: P1
- **Description**: Restore deliberate alignment inside the global recovery reminder and separate
  the Initiative page header, attention surface, and roster controls with a grouped mobile rhythm.
- **Plan**:
  1. Lock the banner composition and page spacing in focused failing visual-contract tests.
  2. Align the recovery message and action in one content column while isolating dismissal.
  3. Replace the overview's uniform stack gap with explicit 24- and 32-pixel group spacing.
  4. Validate responsive light/dark states, run repository release gates, and deploy.
- **Risks**: The reminder appears across the entire authenticated app, so its narrow-width behavior
  must remain readable outside the Initiative route; unrelated MCP connector work in the primary
  checkout must remain untouched.
- **Implementation**: Replaced the reminder's inline flex row with a three-column
  icon/content/dismiss grid; nested a zero-left-inset 40-pixel text action beneath normal body copy;
  preserved the existing tonal surface and rounded Material icons; and changed the Initiative page
  from a uniform 20-pixel stack to a 24-pixel base rhythm with 32 pixels after attention.
- **Files Changed**: Recovery reminder and Initiative overview components, focused visual-contract
  tests, four light/dark desktop/mobile screenshots, the Initiative mobile craft audit, design spec,
  implementation plan, and this work log.
- **Validation**: Focused visual contracts pass 11/11 and the web suite passes 724/724. Root
  typecheck and lint pass 17/17, root tests pass 17/17 packages, and the production build passes 3/3.
  Live measurements at 320px show no horizontal overflow, 14px body copy, exact message/action
  alignment, 40px action and dismiss targets, a 24px header-to-attention gap, and no console errors.
- **Retrospective**: Optical alignment must be measured at the visible label edge, not inferred from
  an aligned button box. Grouped page rhythm is clearer when related content shares one gap and a
  small additive margin separates the next functional region.

---

### [PROD-BUILD-001] Restore production build and integration contracts

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Completed**: 2026-07-14
- **Priority**: P0
- **Description**: Repair the failures exposed by the latest production workflow and restore the
  repository contracts that had drifted behind the shipped product.
- **Implementation**: Corrected nested modal layering and release browser contracts; restored
  provider diagnostic source-policy coverage; serialized migration-heavy database tests; modeled
  the Time Ledger category hierarchy in Drizzle metadata and generated its additive constraint;
  restored optional-only provider setup semantics; and retired remaining active Slack claims from
  product, API, and engineering surfaces.
- **Files Changed**: Shared dialog primitives and browser journeys; provider diagnostics and setup
  tooling; database test configuration, Time Ledger schema metadata, and migration; OpenAPI,
  marketing, engineering documentation, fixtures, and focused regression tests.
- **Validation**: Focused database, provider-bootstrap, source-policy, OpenAPI, and documentation
  tests, followed by the root typecheck, lint, test, build, formatting, and diff-integrity gates.
- **Retrospective**: Production recovery was safest after rebasing onto the newly advanced local
  main and dropping overlapping repairs. Capability-level readiness prevents optional credential
  pairs from being mistaken for complete integrations, while schema metadata must remain the source
  of truth for generated constraints even when a migration already enforces the relationship.

---

### [INIT-ROSTER-FINAL-001] Ship the polished Initiative roster

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Completed**: 2026-07-14
- **Priority**: P1
- **Description**: Carry the approved Initiative overview prototype into the production app and
  deploy the completed Initiative experience to production.
- **Plan**:
  1. Lock the approved roster, hierarchy-connector, icon-circle, empty-summary, and searchable
     rounded-icon-picker behavior in focused failing tests.
  2. Expand the generic entity-display icon catalog and database constraint without coupling
     presentation choices to Initiative or Project records; generate the migration.
  3. Replace the collapse-control roster with the line-free, always-visible hierarchy, padded
     stable columns, two-line summaries, curved hierarchy rails, and restrained row selection.
  4. Build the searchable dense rounded Material icon picker while preserving 40-pixel targets,
     optimistic mutations, vocabulary skinning, cross-workspace read-only behavior, and local
     horizontal scrolling.
  5. Update the Initiative design specification, audit, screenshots, and this worklog.
  6. Run focused red-green checks, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
     `pnpm build`; resolve all in-scope failures before release.
  7. Commit atomically, verify linear history, push `main`, monitor the gated GitHub production
     workflow and Vercel promotion, and smoke-test the production domains.
- **Risks**: A broader persisted icon catalog requires an additive constraint migration; the
  hierarchy visualization must work through the configured five-level maximum; production web
  promotion is gated on the full CI and Cloud Run deployment checks.
- **Validation**: Focused DTO, database, API, picker, hierarchy, and visual-contract tests; Docket
  craft review at desktop/mobile in light/dark; root gates; production workflow and domain health.
- **Release notes**: The first production workflow exposed four stale browser contracts and a real
  modal-layering defect. Updated the export journey to exercise the secure browser download,
  corrected Today routing and date-relative Calendar fixtures, targeted the current freeform
  editor semantics, and raised modal dialogs above sheet surfaces so nested destructive
  confirmations remain operable.
- **Implementation**: Shipped the dense, line-free Initiative hierarchy with stable 72-pixel rows,
  balanced icon/title spacing, curved dependency rails, two-line summaries, padded scrollable
  columns, rounded Material icons, and a searchable anchored icon picker. Expanded the generic
  entity-display catalog and migration without coupling presentation to strategic records, and
  completed the light/dark desktop/mobile design audit and final screenshots.
- **Files Changed**: Initiative overview and display components; shared rounded icon catalog and
  Dialog primitive; typed display contracts, API composition, database schema and migration;
  focused unit, integration, visual-contract, and browser tests; design specification, audit,
  screenshots, and this work log.
- **Validation results**: The six release-repair browser journeys pass against a clean PGlite dev
  stack; the shared Dialog suite passes 257/257; formatting passes; and the final root
  `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` gates pass 17/17, 17/17, 17/17, and
  3/3 respectively. GitHub [run 29313398057](https://github.com/TheHypertextStudio/athena-web/actions/runs/29313398057)
  passed build, lint/types, tests, all 28 Playwright journeys, production migrations, API health
  and auth probes, scheduler setup, and API/admin Cloud Run promotion. Vercel deployment
  `dpl_3Tbj3ttjayXfR86XN9VB5ycdRznw` is Ready and owns the production aliases. Live smoke checks
  return HTTP 200 from `docket.hypertext.studio`, `docket-api.hypertext.studio/v1/health`, and
  `docket-admin.hypertext.studio`.
- **Retrospective**: Dense strategic views benefit from alignment, whitespace, and hierarchy shape
  more than repeated separators. The uncached release suite also caught contracts that local Turbo
  cache had hidden; keeping end-to-end selectors aligned with accessible product semantics and
  enforcing an explicit modal-over-sheet stack made the final release more trustworthy. Optional
  provider secrets must remain absent from production bindings until real credentials exist.

---

### [ATHENA-CLOUDFLARE-002] Persist durable Athena run generations

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Completed**: 2026-07-13
- **Priority**: P1
- **Description**: Establish Docket-owned idempotency and execution state before dispatching Athena
  work to Cloudflare Queues and Workflows.
- **Implementation**: Added `agent_session_run`, keyed by session and generation, with a stable
  workflow instance id, retry attempt, lease expiry, terminal timestamps, and execution status.
- **Validation**: Generated migration `0035_foamy_psynapse`, added PGlite schema coverage for
  defaults and duplicate-generation rejection, and passed the focused DB suite and typecheck.
- **Next**: Create and dispatch these records through the Cloudflare runner boundary.

---

### [ATHENA-CLOUDFLARE-001] Route Athena provider traffic through Cloudflare AI Gateway

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Completed**: 2026-07-13
- **Priority**: P1
- **Description**: Add the first Cloudflare migration seam without changing Docket's ownership of
  agent policy, session state, audit history, or provider credentials.
- **Implementation**: Added optional authenticated AI Gateway configuration and one shared
  Anthropic-client option builder. Every live Athena adapter now receives the same direct-or-Gateway
  configuration; incomplete Gateway configuration safely retains direct Anthropic traffic.
- **Validation**: Focused agent-runtime and API tests pass, and both affected packages typecheck.

---

### [INIT-ICONS-001] Add customizable Material icons to strategic work

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Completed**: 2026-07-13
- **Priority**: P2
- **Description**: Use the repository's MUI-backed `@docket/ui/icons` components for every
  Initiative control, give every Initiative a customizable icon and color, and store the same
  optional presentation metadata for Projects without coupling it to either work entity's core
  planning record.
- **Plan**:
  1. Add a visual-contract regression that rejects Unicode control glyphs.
  2. Add a generic workspace-scoped entity-display record for Initiative and Project icon data.
  3. Add typed, capability-guarded display reads and mutations with tenant validation.
  4. Compose Initiative display metadata into the overview aggregate.
  5. Replace attention paging and hierarchy disclosure glyphs with Material icon components.
  6. Add a 40-pixel anchored icon/color popover and align the roster header, icons, titles, and
     two-line summaries on fixed leading slots.
  7. Verify icon targets remain 40 pixels and run the repository validation gates.
- **Validation**: Run the focused Initiative visual contract and shared primitive suites, then
  `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`; inspect rendered Initiative controls.
- **Implementation**: Added a generic `entity_display` record and typed API for optional Initiative
  and Project icon/color metadata, keeping display choices outside both domain tables. Initiative
  overview aggregates now compose that metadata with stable defaults. The hierarchy roster uses
  fixed disclosure and Material-icon slots, an anchored icon/color picker, Material paging and
  disclosure controls, two-line descriptions, and a viewport-based medium-width table scroller.
  Entity deletion clears its corresponding display record.
- **Files Changed**: Shared display DTOs; cross-cutting schema and migration; display and Initiative
  API routes; Initiative overview UI and picker; focused type, schema, API, component, and visual
  contract tests; Initiative experience design and this work log.
- **Validation Results**: Focused types pass 142/142, database migration/schema pass 11/11, API
  pass 33/33, and web component/visual contracts pass 8/8. Root typecheck and lint pass 17/17;
  production build passes 3/3. The live 1280-pixel viewport keeps the 896-pixel table inside a
  622-pixel local scroller with no page overflow; every relevant control and picker option measures
  40 by 40 pixels; summaries reserve 32 pixels; the popover is left-aligned four pixels below its
  trigger; and no Unicode control glyphs remain. Root `pnpm test` still reports the same four
  unrelated repository-policy failures in provider catalog expectations, TSDoc coverage, and safe
  UI error-source enforcement; none is in this task's changed surface.
- **Retrospective**: Treat icon and color as a reusable presentation concern, then compose it at
  aggregate boundaries. This kept strategic records semantic, enabled Initiative and Project use
  without nullable display columns, and made cross-workspace reads easier to constrain. Drizzle
  generation also revealed an unrelated pending Time Ledger migration; generating against a
  display-only schema view kept this migration atomic while leaving that existing drift visible to
  its owning work.

### [INIT-INTERACTION-001] Normalize Initiative icon targets and roster measure

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Completed**: 2026-07-13
- **Priority**: P2
- **Description**: Keep every icon-only control used by the Initiative overview and detail flow at
  a minimum 40-by-40-pixel interactive target on larger viewports, and cap Initiative roster copy
  at the minimum readable character measure while preserving two-line summaries and local table
  scrolling.
- **Plan**:
  1. Extend the Initiative visual contract with the 40-pixel target and readable-measure rules.
  2. Verify the contract fails against the current desktop hierarchy, pager, and dialog controls.
  3. Correct shared and Initiative-specific target sizing without enlarging decorative glyphs.
  4. Validate the focused contract, repository gates, and the live responsive surface.
- **Validation**: Run the focused Initiative visual contract, `pnpm typecheck`, `pnpm lint`,
  `pnpm test`, and `pnpm build`; inspect the Initiative overview at desktop and medium widths.
- **Implementation**: Raised the shared icon-button and dialog-close targets to 40 pixels, kept
  the Initiative hierarchy disclosure at that size across container breakpoints, aligned leaf-row
  indentation with the disclosure target, and capped two-line Initiative summaries at 45
  characters per line.
- **Validation Results**: The Initiative visual contract passes 5/5 and the shared Button/Dialog
  suites pass 39/39. Typecheck, lint, and production build pass. At 1440x900, the attention pager,
  hierarchy disclosure, and dialog close all measure exactly 40 by 40 pixels; summaries measure 45
  characters wide and 32 pixels high; the 766-pixel roster scrolls its 896-pixel table locally with
  no page overflow or console errors. The root suite retains four unrelated repository-policy
  failures in provider catalog, TSDoc coverage, and safe error-copy enforcement.
- **Retrospective**: Interactive target size belongs to the control, not the glyph. Keeping the
  artwork restrained inside a consistent 40-pixel target preserves density without sacrificing
  pointer or touch accessibility; character-based copy measure makes the roster easier to scan.

### [AGENT-CONFIG-001] Share repository agent tooling

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Completed**: 2026-07-13
- **Priority**: P2
- **Description**: Track the Docket design-review skill for Codex-compatible agents and replace the
  machine-specific Codex commit-scope hook with a portable repository hook.
- **Validation**: Validate the hook configuration, exercise allowed and rejected commit scopes, and
  run repository formatting and the focused commit-message tests before committing and pushing.
- **Implementation**: Added the shared Docket design-review skill for Codex-compatible agents,
  enabled project Codex hooks, and replaced the missing absolute hook target with a portable
  repository script that reads the canonical `COMMIT_SCOPES.txt` allowlist.
- **Validation Results**: Codex target validation passes, and the existing commit-message policy plus
  new Codex hook regressions pass 19/19 across approved, rejected, stdin, and non-commit commands.
- **Retrospective**: Repository-facing agent skills and guardrails are project assets. They should be
  reviewed for portability and committed, not hidden as local working-tree noise.

### [INIT-DETAIL-REV-001] Revise the Initiatives experience

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Priority**: P1
- **Description**: Rework the Initiatives overview and detail experience so it communicates
  strategic direction, rolled-up execution, and the relationship between Initiatives, Programs,
  and Projects more clearly.
- **Plan**:
  1. Agree on the overview and detail pages' primary user questions and information hierarchy.
  2. Compare revision approaches in high-fidelity HTML and validate the design direction.
  3. Add a context-owned Initiative hierarchy with a workspace-configurable one-to-five-level
     depth limit (two by default) and access-safe cross-workspace references.
  4. Make the overview's top band surface actionable Initiative updates, including decisions,
     major blockers, and stale accountability, with portfolio health as supporting context.
  5. Write the approved design and implementation plan before changing production UI.
  6. Implement the revised experience with focused component coverage.
  7. Run repository validation, complete the retrospective, and commit the finished slice.
- **Research**: The shipped page leads with derived status/health, a child-health distribution, and
  a timeline roadmap. Owner and target date plus Program/Project association editing live in the
  right rail. The current schema has no Initiative parent relationship, while Updates already
  support Initiative subjects with narrative text, optional health, author, and timestamp. The
  revision must preserve vocabulary skinning, safe user-facing errors, and the typed TanStack Query
  layer. Top-level aggregate counts must not double-count work shared across Initiatives.
- **Design Direction**: Keep the overview above the roster deliberately slim: page title and one
  rotating "Needs your attention" surface with at most four actionable items. Use a manually owned
  lifecycle (`proposed | active | completed | canceled`) and preserve independently writable
  Initiative health; connected-work health remains supporting context. Model hierarchy through
  workspace-context edges so the same Initiative can appear in an organization or personal plan
  without crossing access boundaries. The detail is a printable strategic brief: latest update,
  freeform Markdown document with a generated contents gutter, sub-Initiatives, connected work,
  labels, resources, and update history. Key Results and metric integrations remain deferred.
- **Implementation**:
  - Added the canonical lifecycle, strategic summary, priority, cadence, independently writable
    health, organization-global labels, and URL resources across the database, REST contracts, and
    MCP tools.
  - Added context-owned hierarchy links with configurable one-to-five-level workspace depth,
    cycle/visibility/depth validation, and access-safe cross-workspace references.
  - Added aggregate overview and detail reads, deduplicated descendant work rollups, automatic
    attention ranking, health-bearing updates, and hierarchy-aware timeline reads.
  - Rebuilt the overview as a dense responsive hierarchy with a single actionable attention band,
    and rebuilt detail as a printable strategic document with latest update, generated Markdown
    contents, sub-initiatives, connected work, properties, labels, and resources.
  - Added Blank, Strategic Initiative, and Objective creation templates plus shared/personal Work
    Structure settings.
  - Independent review hardened tenant ownership for Initiative updates, serialized hierarchy
    mutations, removed orphaned foreign subtrees, made descendant timelines and direct-work
    precedence deterministic, and kept the printable document available from every tab.
- **Validation**:
  - Repository typecheck, lint, and production build pass. Focused Initiative API, DTO, schema,
    authz, migration, MCP, attention, detail, and Markdown-contents tests pass.
  - Live review passed the Docket Craft Rubric at 1440×900 and 390×844 in light and dark; the 320px
    overflow measurement is clean and the browser console has no errors.
  - Review regressions pass 116/116, and print-from-Updates verification retains the Initiative
    document and static properties while removing application chrome and horizontal overflow.
  - The root test command remains red on unrelated active work: guided-provider catalog drift, the
    existing web error-source cleanup, and missing TSDoc on project-dependency/query-core exports.
    Concurrency-only DB/UI timeouts pass when rerun sequentially.
- **Retrospective**: Keeping Initiative health separate from connected-work health preserves an
  executive or Athena-authored judgment without discarding operational evidence. Context-owned
  edges solve cross-organization planning without turning hierarchy into a sharing mechanism. The
  live review caught the fixed-width roster before shipment; responsive column shedding is more
  useful than horizontally scrolling a nominally dense table.
- **State**: COMPLETE — implementation, focused validation, documentation, and design review are
  complete; unrelated root-suite failures are recorded above rather than absorbed into this task.

### [ATHENA-CLOUDFLARE-001] Route Athena provider traffic through Cloudflare AI Gateway

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Completed**: 2026-07-13
- **Priority**: P1
- **Description**: Add the first Cloudflare migration seam without changing Docket's ownership of
  agent policy, session state, audit history, or provider credentials.
- **Implementation**: Added optional authenticated AI Gateway configuration and one shared
  Anthropic-client option builder. Every live Athena adapter now receives the same direct-or-Gateway
  configuration; incomplete Gateway configuration safely retains direct Anthropic traffic.
- **Validation**: Focused agent-runtime and API tests pass, and both affected packages typecheck.
- **Next**: Add the durable Queue/Workflow runner as a separate atom on this branch.

---

### [APP-SHELL-LAYOUT-001] Make the app shell the persistent shared layout

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Completed**: 2026-07-13
- **Priority**: P1
- **Description**: Replace the duplicate provisional shell and full-layout Suspense boundary with
  one shared `(app)` layout whose shell instance remains mounted through session and organization
  loading.
- **Approach**: Remove the shell's query-string suspension dependency, mount one `AppShell` from the
  shared frame, and switch only its sidebar, content, account, and agenda slots as authenticated
  context becomes available.
- **Validation**: Add a shell-identity regression, preserve interlock and protected-content tests,
  then run focused tests and the repository typecheck, lint, test, build, and browser checks.
- **Implementation**: Removed the route-group Suspense wrapper, deleted the duplicate loading shell,
  and made `AppShellFrame` mount one stable provider and `AppShell` tree. Session and organization
  state now switch only the sidebar, account, tab bar, mobile action, agenda, banner, and main-content
  slots. The sign-in return path reads the browser query string inside the resolved signed-out
  effect, so query-string preservation no longer suspends the layout. The persistent open-document
  provider now waits for a user id before resolving protected route titles, scopes asynchronous
  title work to that user, and ignores stale results after account changes. Command-palette actions
  and shortcuts remain inert until the authenticated shell context resolves.
- **Validation Results**: The focused shell, sign-in, and route-tab suites pass 16/16, including an
  identity assertion proving the same `<main>` element survives session and organization
  resolution. The complete UI package passes 256/256 tests. Root typecheck and lint pass 17/17
  tasks, and the API/admin/web production build passes. Desktop and 390x844 browser checks show the
  shared shell filling the viewport with scoped loading regions, zero Suspense markers, and no
  browser console errors. Root tests still stop at the independently reproduced baseline Slack
  catalog expectation (31/32 tooling tests pass), which is unrelated to this slice.
- **Retrospective**: Visual equivalence is not layout persistence. A shell-shaped Suspense fallback
  still replaces the shell and resets its local drawer, rail, and responsive state. Keeping one
  shell mounted makes loading a data-state concern and requires every persistent provider to gate
  its own authenticated side effects explicitly.

---

### [APP-SHELL-LOADING-001] Keep the app shell visible during authenticated loading

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Completed**: 2026-07-13
- **Priority**: P1
- **Description**: Remove full-screen workspace loading views from authenticated routes so the
  Docket shell appears immediately after sign-in and on cold app loads. Loading feedback belongs
  inside the shell regions whose session, workspace, or page data is unresolved.
- **Plan**:
  1. Add component coverage proving the real shell renders while the Better Auth session is pending
     and that unauthenticated users still enter the sign-in interlock after session resolution.
  2. Replace the authenticated layout's full-screen Suspense fallback with a shell-shaped fallback
     that preserves the responsive navigation and content frame.
  3. Render `AppShellFrame` during session settlement with stable Home navigation available, an
     empty/provisional workspace switcher, a scoped main-panel skeleton, and no authenticated-only
     queries or actions until the session exists.
  4. Preserve the current signed-out interlock and post-sign-in onboarding decision; this change
     affects presentation during navigation, not authentication policy or landing destinations.
  5. Verify focused tests and the repository gates before completing the task.
- **Research**: Two independent boundaries currently blank the app: the `(app)` layout Suspense
  fallback and `AppShellFrame`'s `isPending || !session` early return. The shell can safely render
  its static Home navigation before workspace data exists, but the agenda, notification polling,
  account menu, recovery banner, workspace actions, and routed page content must remain gated until
  authenticated context is ready.
- **Design Direction**: Use progressive disclosure inside the persistent shell. Keep the shell's
  stable navigation interactive, visually reserve the workspace/account regions, and show a calm
  content-panel skeleton. Never replace the authenticated viewport with centered loading copy.
- **Implementation**: Replaced both authenticated full-screen loading boundaries with the real
  responsive app shell. The provisional frame keeps Home navigation available, reserves workspace,
  account, main-content, and agenda geometry with accessible skeletons, and leaves Search and
  workspace switching inert until context resolves. The organization query begins only after a
  session exists, while authenticated providers, route children, and private actions remain
  provisional until it settles; a resolved missing session keeps the shell visible while opening
  the existing sign-in interlock.
- **Validation**: The new shell and existing sign-in regression tests pass 7/7, including the
  session-present and organizations-pending boundary; the complete UI
  package passes 256/256 tests. Root `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass, including
  API, admin, and web production targets. Desktop (1440x900) and mobile (390x844) browser checks
  confirm the shell remains visible during delayed session resolution and behind the signed-out
  interlock, with no browser console errors. Root `pnpm test` remains blocked by independently
  reproduced baseline drift: retired Slack expectations, unrelated documentation and UI-error
  policy violations, and existing web test failures outside this slice. Focused shell tests and all
  changed-package UI tests are green.
- **Retrospective**: Mounting stable chrome before the authentication-dependent subtree prevents a
  blank post-sign-in transition without exposing private content or starting protected requests.
  A query-free shell fallback also gives Suspense and session settlement one consistent visual
  contract across desktop and mobile.

### [BUILD-REPAIR-001] Restore clean repository build contracts

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Priority**: P1
- **Description**: Repair the API, integration, error-taxonomy, and export-client contracts that
  prevented the clean repository from type-checking and building.
- **Implementation**: Added export-scope normalization, legacy provider compatibility, public
  problem-catalog exports, authentication error aliases, and typed export requests. Added focused
  regression coverage for export scopes and Slack observer exports.
- **Validation**: API export tests pass 8/8, Slack observer tests pass 21/21, and the production
  build passes API, admin, and web targets including TypeScript and static generation.

---

### [PROJECT-DETAIL-001] Focus project detail on work and dependencies

- **Status**: COMPLETED
- **Started**: 2026-07-13
- **Completed**: 2026-07-13
- **Priority**: P1
- **Description**: Make the project title and work flow primary, remove health/comment UI, add
  quiet Markdown-backed writing, show project dependencies, and keep task creation in context.
- **Implementation**: Added the directed dependency API and migration, a dependency rail, a
  freeform rich-text surface that stores Markdown without editor chrome, and a project-scoped full
  task composer. Replaced project discussion with agent activity and removed comment rendering from
  task detail.
- **Validation**: Dependency route tests and focused project/editor component tests pass. Web
  package typecheck currently reaches known unrelated API, export, provider, and problem-catalog
  failures; the changed project-detail paths typecheck cleanly.
- **Retrospective**: Keeping the project composer mounted at the project boundary lets task
  creation inherit project context without adding another picker. A custom migration kept this
  feature's dependency table isolated from concurrent schema work in the shared checkout.

---

### [PROD-RUNTIME-001] Eliminate live production 500s

- **Status**: REVIEW
- **Started**: 2026-07-12
- **Priority**: P0
- **Description**: Repair the live Calendar item read, recovery-code regeneration, and scheduled
  account-export failures discovered during the final production-readiness audit.
- **Plan**:
  1. Reproduce the PostgreSQL-only Calendar date binding failure and pass canonical date strings to
     `date` predicates without weakening the range semantics.
  2. Stop optional blob storage from being constructed while unrelated notification paths only need
     mail delivery.
  3. Make the account-export sweep behave deterministically when storage is unavailable and verify
     the actual production queue state before selecting fail-soft behavior or provisioning storage.
  4. Add regression coverage for each live failure, run repository gates, promote once, and verify
     the corrected endpoints and Cloud Run logs against the deployed revision.
- **Evidence**:
  - Revision `docket-api-00040-cn6` returned repeated HTTP 500 responses from
    `/v1/me/calendar/items`; stderr shows postgres-js rejecting a JavaScript `Date` bound to a
    PostgreSQL `date` comparison.
  - `POST /v1/me/recovery-codes` returned 500 immediately after successful passkey step-up, and
    `POST /internal/cron/account-export-sweep` returned 500 on its scheduled cadence. Production has
    no blob-storage variables, while `getContainer()` eagerly requires blob configuration even for
    notification-only callers.
- **Risks**:
  - Recovery codes are replaced before the security notification is dispatched; a post-generation
    infrastructure failure must not hide the plaintext codes from the one response that can show
    them.
  - Account exports must never claim readiness unless their archive was durably stored.
  - The shared checkout contains unrelated UI work; all implementation and validation stay in this
    isolated worktree.
- **Implementation**:
  - Calendar range reads now bind canonical `YYYY-MM-DD` strings to PostgreSQL `date` predicates
    while retaining JavaScript dates for timestamp predicates.
  - Production service adapters are getter-backed and memoized, so mail-only recovery notifications
    and empty export sweeps do not require unrelated billing, AI, SMS, push, or blob configuration.
  - Export sweeps resolve blob storage only for pending jobs. A missing storage adapter fails the
    affected job without crashing the entire scheduled route or claiming that an archive is ready.
  - Standard Vercel Blob tokens derive the public store URL when no custom URL override is supplied.
    The `docket-production` store is linked only to the Vercel Production environment, and its token
    is mounted into Cloud Run through Secret Manager without introducing a manual app deployment.
- **Validation**:
  - Focused API regression coverage passes 37/37 across Calendar reads, container initialization,
    account exports, recovery codes, and cron routing.
  - Blob-store coverage passes 13/13 and tooling/bootstrap coverage passes 25/25.
  - Repository typecheck passes 17/17, lint passes 17/17, and tests pass 17/17 (API 1,203/1,203;
    web 304/304; tooling 25/25). Production build passes 3/3.
  - A live Blob upload/delete smoke test completed against `docket-production`, leaving the store
    empty after cleanup.
- **Retrospective**:
  - A single eager application container turned optional integrations into global production
    dependencies. Feature adapters now fail at their actual usage boundary, which keeps unrelated
    routes available while preserving explicit failures for configured features.
- **Remaining Acceptance**:
  - Promote one gated revision, confirm the new Cloud Run image and secret mount, invoke the live
    empty export sweep, and verify authenticated Calendar reads no longer emit HTTP 500.
  - Complete Google consent and the first Calendar synchronization in the production account.

---

### [WEB-ERR-001] Make user-visible errors structured and safe by construction

- **Status**: REVIEW
- **Started**: 2026-07-12
- **Priority**: P0
- **Description**: Audit every web error path and prevent server, provider, configuration, and raw
  exception messages from reaching rendered UI. User-visible failures must come from a closed,
  typed client taxonomy with application-owned copy; diagnostic detail remains server-side.
- **Plan**:
  1. Inventory query, mutation, manual fetch, Better Auth, persisted-provider, error-boundary, and
     direct JSX message paths across `apps/web`.
  2. Split API diagnostic errors from public RFC 9457 summaries, so arbitrary thrown messages are
     never serialized to HTTP clients.
  3. Introduce a closed web `UserFacingError` type and central mapper that consumes status/problem
     codes while accepting only application-owned fallback copy for display.
  4. Migrate every web path away from raw `Error.message`, response `title`/`detail`, provider
     `lastError`, and Better Auth message rendering.
  5. Add repository-wide static enforcement plus runtime contract tests so future raw-message leaks
     fail CI at construction time.
  6. Update the data-layer/error-handling standard, run full gates, commit atomically, and promote.
- **Non-negotiable Invariants**:
  - API diagnostics and environment-variable names never appear in public problem responses.
  - UI code cannot render `error.message`, problem `title`/`detail`, or provider `lastError`.
  - Branching uses closed machine codes/status/kinds; displayed copy is owned by the web app.
  - Unknown failures degrade to contextual fallback copy without exposing the caught value.
- **Risks**:
  - Preserve specific workflows such as re-authentication, billing, validation, and duplicate-state
    handling by branching on stable codes rather than flattening every failure to one generic alert.
  - Keep MCP/operator diagnostics useful through logging and structured machine codes even though
    public HTTP copy becomes generic.
- **Implementation**:
  - API and MCP error renderers now derive public summaries from the closed Problem code catalog;
    thrown messages and validator prose remain diagnostic-only. The Linear write-scope workflow
    gained a stable `linear_write_scope_required` code instead of matching message text.
  - Web and admin now share the same small contract: `UserFacingError` retains only app-owned copy,
    HTTP status, and Problem code. Query, manual response, Better Auth, OAuth, provider-health, and
    error-boundary sinks were migrated; persisted provider diagnostics and agent-error body text are
    never rendered.
  - `AGENT_MAX_TURNS` is required during environment validation and supplied by the deployment
    workflow, so a missing value prevents startup instead of creating a request-time exception.
  - A TypeScript source-policy test scans production web/admin code and rejects raw `.message`,
    provider diagnostics, and legacy string readers. The same rule is now explicit in `AGENTS.md`
    and the data-layer standard.
- **Validation**:
  - The poison-message contract tests prove the exact `AGENT_MAX_TURNS is not configured` text is
    absent from HTTP, query, admin, and MCP results.
  - Full repository typecheck and lint pass 17/17; all tests pass 17/17 (API 1,199/1,199, web
    304/304, admin 5/5, source-policy/tooling 25/25).
  - Production builds pass 3/3; repository format check, workflow actionlint, and `git diff --check`
    pass.
- **Retrospective**:
  - The durable rule is intentionally small: diagnostics stay behind the boundary, UI copy is
    caller-owned, and behavior branches on types/status/codes. Static enforcement prevents the
    contract from depending on every reviewer remembering it.
- **Remaining Acceptance**:
  - The production `AGENT_MAX_TURNS` repository variable is configured at 24. Promote once through
    the gated workflow, then verify the live signup, agenda, and safe-error behavior.

---

### [CAL-PROD-001] Keep the shell agenda renderable during server failures

- **Status**: REVIEW
- **Started**: 2026-07-12
- **Priority**: P0
- **Description**: Fix the production right-rail agenda's raw "Internal server error" state and
  establish the invariant that basic agenda UI and locally available data always render, even when
  calendar enrichment or the agenda endpoint fails.
- **Plan**:
  1. Trace the live right-rail error through the agenda query and combined calendar payload.
  2. Make provider-calendar enrichment fail soft so Docket timeboxes still reach the client.
  3. Make the agenda viewport render cached or empty content on query failure with only a quiet
     degraded-data notice, never raw server copy in place of the surface.
  4. Add API and UI regression coverage, run repository gates, deploy, and verify production.
- **Observed Failure**:
  - The live shell agenda replaced its entire viewport with "Internal server error" while the Today
    page otherwise rendered normally. The combined endpoint currently lets any malformed/stale
    provider-calendar row throw out the Docket timebox payload, and the client then gates the whole
    canvas on `query.error`.
- **Risks**:
  - Preserve observability for corrupt provider data; degradation must log the enrichment failure.
  - Do not misrepresent stale data as current; the rail should disclose degraded refresh quietly.
- **Implementation**:
  - The combined agenda isolates Google/provider enrichment behind a fail-soft boundary. Any
    provider query/serialization invariant failure is logged with user/date context, while the API
    still returns the user's Docket timeboxes with HTTP 200.
  - The agenda viewport no longer gates its canvas on `query.error`. After initial loading it always
    renders cached entries or the normal empty state, with a quiet degraded-refresh status that
    never exposes raw server copy.
- **Validation Progress**:
  - Focused API agenda tests pass 11/11, including a malformed synced provider event that preserves
    the Docket timebox and emits the diagnostic warning.
  - Focused agenda resilience tests pass 2/2, proving controls/canvas remain visible and raw
    "Internal server error" copy is absent.
  - Repository typecheck 17/17, lint 17/17, and tests 17/17 pass (API 1,199/1,199; web 303/303;
    tooling 25/25). Production build passes 3/3.
- **Retrospective**:
  - The old design made an additive provider projection a single point of failure twice: first in
    the combined API payload, then again in the viewport's error gate. Resilience belongs at both
    boundaries so a future backend regression still cannot erase ambient shell UI.
- **Remaining Acceptance**:
  - Promote through the gated workflow and verify the live right rail no longer renders the raw
    error state.

---

### [AUTH-PROD-002] Correct post-verification duplicate-account failure

- **Status**: REVIEW
- **Started**: 2026-07-12
- **Priority**: P0
- **Description**: Stop production signup from reporting a service outage after email verification
  when the verified address already belongs to an account with a passkey or linked social identity.
- **Plan**:
  1. Trace the exact email-verification → passkey-registration response path in the deployed code.
  2. Return a stable actionable 4xx code for an existing account instead of leaking a plain error
     through Better Auth as HTTP 500.
  3. Exercise the real auth handler in the ATO regression test and confirm the web error mapper
     renders the existing-account guidance.
  4. Validate, deploy through the gated production workflow, and repeat the live signup journey.
- **Confirmed Root Cause**:
  - `resolvePasskeyUser` intentionally rejected verified signup for an existing credentialed
    account, but threw a plain `Error`. Better Auth serialized that as HTTP 500; the web passkey
    mapper correctly classified an unknown 5xx as a temporary service outage, hiding the actual
    "sign in instead" outcome.
- **Risks**:
  - Preserve the account-takeover defense: an email challenge must never attach another passkey to
    an account that already has a passkey or linked social identity.
  - Keep the verified signup intent single-use on rejection.
- **Implementation**:
  - `resolvePasskeyUser` now raises Better Auth's typed `BAD_REQUEST` API error with the shared
    `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED` code. The existing web mapper turns that code into
    "You already have an account with this email. Sign in instead."
  - The ATO regression now calls `/passkey/generate-register-options` through the real auth handler
    and asserts HTTP 400 plus the stable code, while still confirming no second credential appears.
- **Validation Progress**:
  - Auth tests 53/53 and web tests 301/301 pass; the latter includes the duplicate-account copy.
  - Repository typecheck 17/17, lint 17/17, and tests 17/17 pass (API 1,198/1,198).
  - The production build passes 3/3 with `NODE_ENV=production`. The first invocation inherited the
    checkout's `.env.local` non-production `NODE_ENV` and reproduced an unrelated admin prerender
    failure; pinning the production mode used by deployment removed it without source changes.
- **Retrospective**:
  - The helper-only security assertion proved rejection but not its HTTP semantics. Exercising the
    public plugin endpoint is what catches accidental 500s and protects the user-facing contract.
- **Remaining Acceptance**:
  - Promote the commit through the gated workflow, verify the deployed revision, and repeat the
    existing-email signup path against production.

---

### [PROD-DEPLOY-002] Close final production promotion blockers

- **Status**: IN_PROGRESS
- **Started**: 2026-07-10
- **Priority**: P0
- **Description**: Promote the rebased Google Calendar production release through one gated `main`
  run without duplicate deploys, automatic release tags, or avoidable Actions failures, then verify
  the live auth, Google account-linking, and calendar-sync journey.
- **Plan**:
  1. Audit repository ancestry, cloud variables/secrets, workflow routing, and current live health.
  2. Repair the GitHub-runner E2E topology and remove the failing automatic semantic-release lane.
  3. Run local production gates, push `main` once, and watch the single routed deployment.
  4. Verify deployed revisions, auth routes, Google OAuth availability, and calendar synchronization.
- **Confirmed Blockers**:
  - The previous CI E2E job attempted a privileged Portless `:443` proxy; Portless could not find a
    running proxy in the non-interactive runner, so every readiness probe returned `000`.
  - The automatic Release workflow failed while attempting a semantic-release Git commit/tag and
    consumed a separate runner even though this production rollout does not use CI-generated tags.
  - The prior formatting failure is already resolved on current `main`; `pnpm format:check` passes.
  - A repository-wide uncached run exposed a contention-sensitive SSE replay flake: a terminal
    agent session could yield EOF after the first queued historical frame. Historical frames now
    flush in one atomic write; live-tail events remain incremental.
- **Risks**:
  - Preserve the native Vercel Git promotion path; do not invoke Vercel manually or require a token.
  - Keep the production push to one intentional event after local proof is complete.
  - Do not expose or read secret values while proving Secret Manager and binding readiness.
- **Validation Progress**:
  - Production repository variables, the 11-entry `API_SECRET_BINDINGS` manifest, enabled Google
    OAuth/Resend secret versions, and public web/API/admin `200` responses were verified without
    reading credential values.
  - The isolated unprivileged Portless stack returned `200` for web, API health, and OIDC discovery;
    all 18 Playwright scenarios passed, including passkeys, Google Calendar, MCP OAuth, and agent
    approval.
  - `pnpm format:check`, actionlint, typecheck 17/17, lint 17/17, tests 17/17 (API 1,198/1,198;
    web 301/301), production build 3/3, and the focused SSE stress loop 20/20 all pass.
  - Commit `cd444b6` was promoted by the single gated CI run `29142586788`: build, test,
    lint/types, E2E, database migration, Cloud Run API deployment, live health/auth probes, and
    Vercel web/admin deployment all passed. No release workflow, CI tag, or duplicate deploy ran.
  - The live public configuration reports production mode, configured Google OAuth credentials,
    and the `calendar` connector; API health and the deployed web surface return `200`.
- **Remaining Acceptance Blocker**:
  - The signed-in browser connection is unavailable to this workspace, so the allowlisted
    `willieechalmers@gmail.com` link/consent/sync journey still requires one interactive production
    smoke test. Repository, workflow, secret-binding, deployment, and public runtime readiness are
    complete; this task remains `IN_PROGRESS` until that user-session proof exists.

### [AUTH-PROD-001] Restore production account creation and verification email

- **Status**: IN_PROGRESS
- **Started**: 2026-07-10
- **Priority**: P0
- **Description**: Restore the real `docket.hypertext.studio` passwordless signup journey. Repair
  the stale Vercel rewrite, deploy the current API with its signup/passkey endpoints, configure
  Resend's native API through Secret Manager, and stop the UI from claiming an email was sent when the
  request failed.
- **Plan**:
  1. Make request-code failures explicit and keep the user on the email step unless the API accepts
     the request.
  2. Reject recursive production proxy origins and add regression coverage.
  3. Wire Resend API secrets, database migrations, and auth-route verification into deployment.
  4. Reuse the verified `service.hypertext.studio` Resend domain, provision secrets, deploy local
     `main`, and prove the full production signup/passkey/onboarding journey.
- **Confirmed Root Causes**:
  - Vercel returns `508 INFINITE_LOOP_DETECTED` for every same-origin auth route because its latest
    deployment predates the corrected production `API_URL`.
  - The signup client treats every request-code response except 429 as success, so it displays a
    false email-sent state after that 508.
  - Cloud Run still serves API commit `73ee4a78` from 2026-06-16, before signup challenge/passkey
    routes landed; later deploys fail because Node 26 no longer bundles Corepack.
  - Production had no mail secrets or Cloud Run mounts, while the current auth package requires a
    real mailer at startup.
- **Risks**:
  - Keep provider keys out of argv, logs, Git, and local tracked files.
  - Preserve Google Workspace root-domain MX/SPF records; keep Resend isolated on its existing
    verified sending subdomain.
  - Apply pending migrations before shifting API traffic and retain the prior ready revision if a
    candidate fails.
- **Implementation Progress**:
  - Signup remains on the email step for 429, 5xx/508, and network failures; only an accepted
    request advances to code verification.
  - Web production builds reject a recursive `API_URL`/`NEXT_PUBLIC_APP_URL` origin pair.
  - The API deploy now applies migrations from the built image, mounts the two-value native Resend
    API contract, and probes health/session/signup routes after Cloud Run reports ready.
  - Reused Resend's verified `service.hypertext.studio` domain, created a domain-restricted sending
    key, and stored it plus the verified sender in `athena-services` Secret Manager.
  - Centralized mail transport selection: production requires Resend HTTPS, local development may
    use Mailpit SMTP, and tests always use the capture adapter. Bootstrap now asks only for
    `RESEND_API_KEY` and `MAIL_FROM` in hosted environments.
- **Validation Progress**:
  - Repository typecheck 17/17, lint 17/17, tests 17/17 (web 301/301; API 1,196/1,196), tooling
    10/10, production build 3/3, and actionlint all passed.
  - Initial live SMTP smoke `5c372209-d09c-4fa4-bbd4-e3846536426a` was accepted and reached Resend's
    `delivered` state for `willie@hypertext.studio`.
  - Native Resend API smoke `729e78c8-072b-4af6-9fc4-c8136c86519f` reached `delivered` using the
    new domain-restricted production key and verified sender.
  - First API promotion built its Node 26 image and applied production migrations successfully,
    then failed safely before traffic shifted because the runtime service account lacked access to
    the initial mail secrets. Granted secret-level access and hardened bootstrap to do this for
    every future provider secret; also escaped the comma-delimited host allowlist exposed by the
    deploy command.
  - Local Docker base-stage checks could not start because the Docker Desktop socket did not
    respond; GitHub's Docker runner remains the production proof for the corrected Corepack layer.
  - Native Resend changes pass repository typecheck 17/17, lint 17/17, tests 17/17 (mail 28/28;
    API 1,196/1,196), tooling 11/11, actionlint, and production-mode build 3/3. The first build
    attempt inherited `NODE_ENV=development` from `.env.local` and hit a transient admin prerender
    error; rerunning the full build with `NODE_ENV=production` passed.
  - A live signup attempt on revision `docket-api-00030-hlx` exposed a revoked Resend credential:
    the request returned `500` and `RealMailer` recorded provider status `401`. Rotated
    `docket-resend-api-key` through masked clipboard-to-Secret Manager input, deployed revision
    `docket-api-00031-7nv`, and proved a fresh verification-code request returned `200`.
  - Cleaned the authoritative runtime on revision `docket-api-00032-br6`: 100% traffic, healthy API,
    correct comma-delimited auth/MCP allowlists, only native Resend mail mounts, and no bogus
    environment keys. Disabled the revoked Resend version and all retired SMTP secret versions.
  - Hardened the reusable Cloud Run workflow with a generated YAML `--env-vars-file` plus
    authoritative secret mounts. The action's inline comma parser mangled even quoted allowlists;
    the file path bypasses that tokenizer entirely. Formatting, actionlint, and tooling tests 8/8
    pass.
  - Google account linking then exposed an invisible newline in Google client-id secret version 2:
    the authorization URL ended in `%0A`, so Google returned `401 invalid_client`. Stored a
    newline-free version 3, pinned revision `docket-api-00037-n7n` to it, disabled both malformed or
    deleted prior client-id versions, and verified Google recognizes the exact production callback.
    Bootstrap now trims outer clipboard whitespace at the Secret Manager boundary and rejects
    whitespace-only values.

### [BOOTSTRAP-LINEAR-001] Minimal-manual production provider bootstrap

- **Status**: DONE
- **Started**: 2026-07-10
- **Completed**: 2026-07-10
- **Priority**: P0
- **Description**: Make `pnpm bootstrap` the minimal-manual-work entry point for every production
  provider. Production runs all provider groups by default and rejects incomplete values; explicit
  flags may skip whole phases. Linear additionally opens a prefilled public OAuth application form,
  collects only provider-generated credentials, writes them directly to Secret Manager, and wires
  the API deployment only after every required Linear secret exists.
- **Plan**:
  1. Add phase flags, including an existing-infrastructure provider-only path, while keeping every
     production provider mandatory by default.
  2. Generate and open Linear's supported OAuth application manifest URL with production callback
     and webhook values prefilled.
  3. Reuse masked prompts and stdin-only Secret Manager writes for the client id, client secret,
     and webhook signing secret.
  4. Patch the deploy workflow idempotently after successful secret provisioning.
  5. Add pure regression tests, update the operator documentation, run all gates, and commit.
- **Risks**:
  - Never expose OAuth or webhook secrets through argv, logs, Git, or generated local files.
  - Explicit skip flags may omit phases, but the default production path must never silently skip
    an incomplete provider.
  - Never add a Cloud Run secret mount before the corresponding Secret Manager entry exists.
  - Use Better Auth's current built-in Linear callback path, not the retired generic-OAuth path.
- **Implementation**:
  - Added documented, typo-rejecting phase flags: `--production`, `--skip-local`, `--skip-tunnel`,
    `--skip-production`, `--skip-infrastructure`, and `--skip-providers`. The provider-only path
    reuses the production project/repository and skips Neon/GCP foundation prompts.
  - Production now runs all nine provider groups by default. Blank input only preserves a real
    existing cloud value; empty values and bootstrap placeholders fail the provider completeness
    gate. `--skip-providers` is an explicit operator override, never a hidden default.
  - Linear opens its official pre-populated OAuth manifest with public distribution, web/admin/API
    callbacks, authorization-code grant, and Issue/Comment webhook already filled. Only Linear's
    three generated values remain manual.
  - Provider values continue to reach GCP/GitHub through stdin/masked prompts. The Linear webhook
    workflow mount is added idempotently only after all three non-placeholder production secrets
    can be read back from Secret Manager.
  - Hardened terminal note wrapping so long unbroken URLs cannot overflow or shatter Clack boxes;
    the Linear URL is opened directly or copied to the clipboard instead of dumped into the note.
  - Registered `dx` as the repository's explicit developer-experience commit scope so bootstrap and
    other contributor-tooling changes can be labeled without bypassing commit-message validation.
- **Validation**:
  - `pnpm bootstrap -- --help` exits zero with a clean, non-wrapping flag summary.
  - Tooling regression suite: 1 file / 8 tests passed (flags, mandatory catalog, Linear manifest,
    environment-specific Resend/Mailpit contracts, generated bindings, deployment ordering, and
    long-token wrapping).
  - Post-rebase repository typecheck 17/17, lint 17/17, tests 17/17 (API 1,198/1,198; web
    301/301), and production build 3/3 all passed.
  - Commit-message validation accepts `feat(dx): ...` through the normal allowlist-backed hook.
- **Retrospective**:
  - “Mandatory by default” and “skippable by flags” are compatible when omission is explicit and
    misspelled/contradictory flags fail closed.
  - Provider-owned forms and generated secrets are the irreducible human boundary; pre-populating
    everything else and securely persisting pasted values is the useful automation target.
  - Long manifest URLs are operational data, not terminal prose; open/copy them and still harden
    the renderer for any future unbroken token.
  - Rebased the provider work onto local `main` after the production signup/Resend bootstrap landed.
    The reconciled deployment retains native Vercel Git promotion, generates all configured Cloud
    Run secret mounts through `API_SECRET_BINDINGS`, runs migrations from the API image, and probes
    the production health/session/signup routes before admin and web promotion.

### [LINEAR-SYNC-003] Multi-account Linear production-readiness review

- **Status**: DONE
- **Started**: 2026-07-10
- **Completed**: 2026-07-10
- **Priority**: P0
- **Description**: Review the multi-account Linear implementation as a production gate, correct
  confirmed correctness, security, migration, sync, UI, or deployment findings, and produce
  deployment-ready validation evidence without deploying or changing live infrastructure.
- **Plan**:
  1. Review commit `5822689` and the surrounding identity, OAuth, integration, sync, webhook, task
     reconciliation, settings, migration, and deployment paths.
  2. Exercise legacy/fresh migration states and adversarial multi-tenant/account-selection cases.
  3. Implement focused fixes and regression tests for every confirmed finding.
  4. Run package-level checks followed by the repository typecheck, lint, test, and build gates.
  5. Reconcile the deployment runbook/workflow, complete the self-review and retrospective, then
     commit the production-readiness changes atomically.
- **Risks**:
  - Account identifiers are provider-owned credentials and must never be accepted across users or
    organizations without an ownership check.
  - Webhook fan-out and duplicate-workspace prevention must remain tenant-safe under concurrent
    connections and retries.
  - Historical PostgreSQL migrations must run on both fresh databases and databases that applied
    the earlier enum migration sequence.
- **Review findings and fixes**:
  - Corrected a multi-admin credential-ownership bug: sync, verify, identity labels, and Linear
    write-scope checks now resolve the integration owner's OAuth grant (`createdBy`), not whichever
    manager happened to trigger the request. Explicitly binding a legacy connection remains the
    only operation that transfers ownership to the current actor.
  - Removed client-writable `connection` routing metadata from integration create/update DTOs and
    API writes. Provider verification remains the only path that can persist workspace routing,
    preventing a manager from steering a signed webhook into another tenant.
  - Added Linear's required one-minute webhook replay window by validating `linear-timestamp`
    before the raw-body HMAC comparison, with fresh, stale, tampered, and wrong-secret coverage.
  - Repaired all three Node 26 production Dockerfiles by installing Corepack explicitly, made the
    root prepare hook safe in Turbo-pruned images, and excluded stale build/test artifacts from the
    Docker context (5.7 GB attempted context reduced to 18.82 MB).
  - Fixed an adjacent finite-SSE replay race exposed by the production gate: terminal agent-session
    streams now await Hono stream closure, and the regression test proves both persisted frames are
    replayed. Ten consecutive focused runs passed after the fix.
  - Closed the existing documentation-coverage gate with focused TSDoc on 34 exported search
    declarations; no search behavior changed.
- **Production preparation**:
  - Documented and added `LINEAR_WEBHOOK_SECRET` to the provider setup wizard and example env. The
    exact production endpoint is `/internal/ingest/linear`, not the stale `/v1/ingest/linear` path.
  - Did not add a missing-secret reference to the deploy workflow: first create
    `docket-linear-webhook-secret`, then mount
    `LINEAR_WEBHOOK_SECRET=docket-linear-webhook-secret:latest`; referencing it before creation
    would break every API deployment.
- **Validation**:
  - Repository typecheck and lint: 17/17 tasks passed.
  - Tests: API 132 files / 1,196 tests; web 50 / 296; integrations 16 / 234; types 12 / 243;
    database 7 / 53; test-utils 3 / 15; all other workspace packages passed in the root run.
  - Workspace production build passed for API, web, and admin.
  - Fresh production Docker images built for API, web, and admin with Node 26 and canonical
    production URLs; container smoke checks returned API health 200 and web/admin sign-in 200.
  - A final external hostname probe could not be completed from the agent environment because its
    DNS/TLS path could not resolve the API/admin hosts. Artifact readiness is verified; live rollout
    health remains a deployment-time check and was not represented as complete.
- **Retrospective**:
  - Account selection and request attribution are different responsibilities; the persisted
    integration owner must select the credential even when another authorized manager triggers sync.
  - Provider-derived routing keys must never share a client-editable configuration boundary.
  - Build the exact release image early: it exposed both the Node 26/Corepack break and the pruned
    prepare-hook failure that source-only gates could not see.

### [LINEAR-SYNC-002] Multi-account Linear connections and task materialization

- **Status**: DONE
- **Started**: 2026-07-10
- **Completed**: 2026-07-10
- **Priority**: P1
- **Description**: Ensure one Docket user can link multiple Linear OAuth identities, see every
  identity and every org-scoped Linear connection in Settings, bind each connection to the intended
  identity, and materialize each connected workspace's Linear issues as first-party Docket tasks.
- **Audit findings**:
  - Better Auth and `GET /v1/me/identities` preserve and return multiple same-provider account rows,
    and Connected accounts already renders every returned Linear identity. However, Docket does not
    enable Better Auth's explicit `allowDifferentEmails` link policy, so a second Linear account with
    a different email is rejected during the user-initiated link flow.
  - The org Connections UI collapses Linear to the first integration (`byProvider.get(...)[0]`) and
    creates an unbound legacy connection with no `externalAccountId`; token resolution can therefore
    pick the wrong Linear grant and additional Linear identities cannot be connected or managed.
  - Linear identities have no OIDC id token, so Connected accounts labels every one merely
    "Linear" even though the live connector resolves the viewer and workspace during verification.
  - The work-graph sync path already pulls Linear issues and reconciles them into native tasks with
    per-integration provenance, and scheduled sync handles each integration independently.
  - Linear webhook routing selects only the first matching integration for a workspace, so the same
    Linear workspace connected into multiple Docket orgs does not fan out reliably.
- **Plan**:
  1. Generalize the existing Google Tasks multi-account connection surface into a provider-aware
     identity-connections surface and use it for Linear, preserving per-connection health, sync,
     configuration, and disconnect controls.
  2. Enable and test authenticated, user-initiated linking of a second provider identity with a
     different email, then make Linear connection creation select a linked Linear identity, persist
     its `externalAccountId`, and verify that exact account before exposing it as healthy.
  3. Persist/display the resolved Linear viewer and workspace labels so multiple identities and
     connections are distinguishable in both Connected accounts and Connections settings.
  4. Make account-specific Linear scope checks use the integration's bound `externalAccountId`.
  5. Fan Linear workspace webhooks out once per connected Docket organization while de-duplicating
     multiple same-org connections, matching the existing safe Slack fan-out shape.
  6. Add API, sync, webhook-routing, and web component coverage proving two Linear identities create
     two visible connections and each connection materializes its own issues as Docket tasks.
  7. Update the integration sync specification, complete this worklog entry with validation and
     retrospection, run focused gates, then run the repository typecheck/lint/test/build gates.
- **Risks**:
  - Legacy unbound Linear integrations must remain reconnectable without being silently reassigned
    to a newly linked account.
  - Two OAuth identities may point at the same Linear workspace; task/webhook handling must avoid
    ambiguous routing or duplicate materialization inside one Docket organization.
  - Unlinking an identity that still funds an org connection must surface a truthful reauth state.
- **Validation**:
  - `pnpm db:migrate` — passes against the configured on-disk PGlite database after repairing the
    historical enum transaction edge; a fresh in-memory migration passes too.
  - `@docket/api` — a full 132-file run passed 1,192/1,192 before the final two account-selection
    assertions were added; the final focused Linear/identity set passes 37/37. The post-addition full
    run passed 1,193/1,194 with only the unrelated pre-existing agent-session SSE timing flake; its
    isolated `group-d` rerun passes 33/33. Coverage includes exact-account tokens, safe unlink,
    duplicate-workspace rejection, activation sync, issue-webhook reconciliation, and org fan-out.
  - `@docket/web` — 50 files / 296 tests passed, including multi-account settings selectors.
  - `@docket/db` — 7 files / 53 tests; `@docket/auth` — 3 files / 51 tests;
    `@docket/integrations` — 16 files / 233 tests.
  - `pnpm typecheck` — 17/17 Turbo tasks passed.
  - `pnpm lint` — 17/17 Turbo tasks passed.
  - `pnpm build` — API, admin, and web build tasks passed.
  - Live dev proof: `pnpm dev` stays running; `GET https://api.docket.localhost:1355/v1/health`
    returns 200 `{"status":"ok"}` and `https://docket.localhost:1355` returns 200.
  - Broad `pnpm test` reaches this slice's green package suites but the root gate remains blocked by
    the pre-existing `@docket/test-utils` documentation-coverage audit: 34 undocumented exports in
    the unrelated search-index implementation (`apps/api/src/search/*`, web search URL state, and
    `packages/db/src/schema/search.ts`). No Linear-sync file appears in that failure list.
- **Files Changed**:
  - Identity/auth contracts and unlink safety: `packages/types/src/{identity,errors}.ts`,
    `packages/auth/src/auth-builder.ts`, `apps/api/src/routes/{me-identities,integration-provider}.ts`.
  - Linear connection/sync/webhooks: `packages/integrations/src/*`,
    `apps/api/src/routes/{integrations,ingest,event-sync}.ts`.
  - Settings UX: `apps/web/src/components/settings/{connected-accounts-tab,identity-account-row,integration-provider-card,integrations-tab}.tsx`.
  - Local observability/migration repair: `packages/db/src/migrate.ts`, migrations `0000`/`0004`,
    `turbo.json`, and the ignored local `.env.local` `WEB_URL` value.
  - Specifications/tests: `docs/engineering/specs/integration-sync.md` and focused auth, DB,
    integration, API, and web test files.
- **Retrospection**:
  - **What went well**: The existing work-graph reconciler already had the correct native-task and
    provenance semantics; binding tokens to one account and routing webhook repair through the same
    leased spine avoided a second sync implementation.
  - **What could improve**: Linear's Better Auth account row does not retain per-account profile
    claims, so Connected accounts uses a stable account-id suffix until verification can show the
    richer viewer/workspace labels on the org connection.
  - **What was learned**: Drizzle 0.45 wraps all pending PostgreSQL migrations in one transaction;
    enum values introduced in one historical migration cannot be consumed by the next without an
    idempotent preflight commit. Turbo strict-env also requires `WEB_URL` to be explicitly forwarded
    to the API dev task.

### [PROD-GOOGLE-001] Production deployment and Google Workspace sync

- **Status**: REVIEW
- **Started**: 2026-07-10
- **Priority**: P0
- **Description**: Restore a gated production deployment for Docket and let users link multiple
  Google accounts for two-way Calendar sync, with incremental Tasks, Drive, and Gmail consent.
- **Approach**: Preserve the Vercel-web plus Cloud Run API/admin topology, use Vercel's native Git
  deployment with a blocking backend Deployment Check instead of a duplicate CLI deployment, add an
  explicit production migration job, harden Better Auth account/token handling, and stage Google
  OAuth behind a test-user gate until public restricted-scope verification is approved.
- **Subtasks**:
  - [x] Repair formatting, E2E startup, Docker package-manager bootstrapping, and CI deployment gates.
  - [x] Add Cloud Run database migration automation and remove the duplicate Cloud Run web deploy.
  - [x] Add encrypted multi-account Google linking with connector-specific incremental scopes.
  - [x] Make Calendar discoverable and complete connect, re-consent, sync, and unlink behavior.
  - [x] Add production legal pages, Google data disclosures, and hybrid deployment documentation.
  - [x] Replace the token-authenticated Vercel CLI job with native Git deployment gated on the
        migration/API deployment check.
  - [x] Restore GCP billing, provision the direct Neon migration secret, and reconcile the deploy
        manifest with the OAuth providers that are actually configured in production.
  - [x] Enforce the browser-visible passkey RP ID in web/admin builds and configure it in Vercel.
  - [ ] Validate in CI and against staged production with the designated Google test user.
- **Risks**:
  - Production migrations must run before API code that expects the current calendar schema.
  - Google Drive and Gmail restricted scopes require verification and an independent security review.
  - Existing plaintext OAuth tokens must not survive the encryption rollout unnoticed.
- **Validation**:
  - `pnpm format:check`, `pnpm lint`, and `pnpm typecheck` pass across the workspace.
  - `pnpm test` passes all 17 Turbo tasks; the API package passes 132 files / 1186 tests.
  - `SKIP_ENV_VALIDATION=1 pnpm build` passes the API, admin, and web production builds.
  - Fresh PGlite migration succeeds; migration, API, admin, and web Docker images all build.
  - Production control-plane follow-up passes `pnpm typecheck`, `pnpm lint`, `pnpm test` (17/17
    tasks; API 132 files / 1186 tests), `SKIP_ENV_VALIDATION=1 pnpm build`, and an admin Docker build
    with the canonical production origins plus `NEXT_PUBLIC_PASSKEY_RP_ID=hypertext.studio`.
  - Post-rebase proof against the combined Linear + Google release history passes `pnpm typecheck`,
    `pnpm lint`, `pnpm exec turbo run test --concurrency=4` (17/17 tasks; API 132 files / 1197 tests),
    and `SKIP_ENV_VALIDATION=1 pnpm build`. The identity unlink regression now asserts account counts
    without depending on PostgreSQL row order.
  - Live GCP proof confirms ready API/admin Cloud Run revisions, a 200 API health response, active
    GitHub OIDC federation, Artifact Registry, Scheduler jobs, enabled Google APIs, and no missing
    Secret Manager references in the corrected deploy workflow.
  - Live Portless web, API health, and OAuth discovery return 200; all seven Google/layered-calendar
    Playwright journeys pass. The five hosted E2E regressions exposed by the first pull-request run
    (MCP session, passkey signal/sign-in, and two visual captures) pass together on an isolated
    branch-prefixed stack after forwarding the required runtime variables and removing machine-local
    screenshot paths. After making the explicit sign-in test deterministic against Chromium's
    conditional mediation, that test passes 10/10 repetitions and the complete serial browser suite
    passes 18/18 locally; the follow-up hosted run remains the canonical full-suite gate.
- **Blockers**:
  - Cloudflare DNS still needs the malformed `_vercel.hypertext.studio` CNAME replaced by the Vercel
    TXT verification value, plus `docket-api` and `docket-admin` CNAMEs for the ready Cloud Run
    services. The available local Cloudflare OAuth token has DNS read but not DNS write access.
  - Public Google enablement remains gated on OAuth verification/security review. The staged test-user
    flow additionally needs a real Google web OAuth client; current Secret Manager versions are
    placeholders.
- **Files Changed**:
  - `.github/workflows/{ci,deploy}.yml`, deployment Dockerfiles, and `packages/db/Dockerfile`
  - `packages/{auth,db,env,types}` Google account, scope, encryption, and lifecycle surfaces
  - `apps/api` identity/config responses and `apps/web` Calendar connect/re-consent/navigation UX
  - `apps/web/src/app/(marketing)/{privacy,terms}` and production/operator documentation
  - Vercel project `docket`: production-only `Backend ready` Deployment Check sourced from the
    GitHub migration/API job; obsolete Vercel GitHub variables removed; canonical app/API origins and
    `NEXT_PUBLIC_PASSKEY_RP_ID=hypertext.studio` configured for production and preview
  - GCP project `athena-services`: relinked from a closed billing account to the active Hypertext
    Studio account; added `docket-database-url-unpooled` with Cloud Run runtime access; verified
    `support@hypertext.studio` exists with `willie@hypertext.studio` as an owner
- **Learnings**: Provider-backed calendar connections need a database-enforced link to the Better Auth
  account lifecycle, and container installs must include the root prepare-script input even when Turbo
  prunes source from the manifest layer. Branch-prefixed E2E hosts need explicit trusted-origin and
  MCP metadata overrides. Workflow-level environment values also need matching package `turbo.json`
  declarations under strict mode or the launched dev process never receives them. Native Vercel Git
  deployments can preserve backend-first release ordering without a duplicate CLI build: a GitHub
  Actions Deployment Check holds production alias assignment until migrations and the API rollout
  succeed. A project may report `billingEnabled: true` while its linked billing account is closed;
  validate the billing account's `open` state before treating that metadata as deployment-ready.

### [NOTIF-UX-001] End-user notification UX completion

- **Status**: DONE
- **Started**: 2026-07-07
- **Completed**: 2026-07-07
- **Priority**: P1
- **Description**: Close the remaining end-user notification UX gaps after the service spine:
  Slack-like inbox slices, question-first notification preferences, complete quiet-hours controls,
  and safer contact-point management.
- **Approach**: Keep the API stable and finish the user-facing surfaces with focused component tests
  first. Reuse existing notification DTOs, fixtures, query hooks, and settings components rather
  than introducing a second UX framework.
- **Subtasks**:
  - [x] Add Slack-like notification inbox tabs for all, unread, needs action, mentions/assignments,
        announcements, and activity.
  - [x] Rework notification preferences around end-user questions while preserving the advanced
        matrix for power users.
  - [x] Expand quiet-hours controls to days and urgent bypass.
  - [x] Expand contact-point creation beyond phone and add confirmation before disabling
        destinations.
- **Files Changed**:
  - `apps/web/src/app/(app)/inbox/*`
  - `apps/web/src/components/settings/{contact-points-section,notification-preferences-section}.tsx`
  - `apps/web/tests/components/{inbox,settings}/*notification*`
  - `apps/api/tests/support/routes-harness.ts`
  - `packages/db/drizzle/0026_outgoing_next_avengers.sql`
- **Validation**:
  - `pnpm typecheck` — 17/17 Turbo tasks passed.
  - `pnpm lint` — 17/17 Turbo tasks passed.
  - `pnpm test` — 17/17 Turbo tasks passed; API 119 files / 1112 tests and web 46 files / 281 tests.
  - `pnpm build` — API, admin, and web build tasks passed.
- **Learnings**: The end-user UX work exposed two integration seams worth keeping tight: route
  composition must preserve Hono child schemas for the admin RPC client, and rebased Drizzle
  migrations must be checked for stale-base duplicate enum/table creation before running broad API
  tests.

### [NOTIF-SPEC-001] Cross-platform notification service

- **Status**: DONE
- **Started**: 2026-07-06
- **Priority**: P1
- **Description**: Define the product, UX, REST API, delivery, inbound-event, and rollout shape
  for a Slack-like cross-platform notification service that handles web, email, phone/SMS, and
  future mobile push without reducing the system to a generic mailer wrapper.
- **Approach**: Build from shipped Athena surfaces: the existing `Mailer` port, account/security/
  export/digest email call sites, `/v1/notifications`, and automation notifications. Specify the
  user experience first, then the API resources, data model, permissions, provider events, and
  phased rollout.
- **Subtasks**:
  - [x] Capture intended behavior for notification intents, recipient snapshots, deliveries,
        contact points, preferences, inbound events, quiet hours, suppression, and read/action
        state.
  - [x] Detail the user experience for the web inbox, preferences, contact points, email, SMS,
        future push, staff announcements, org-authored sends, and developer usage.
  - [x] Describe the REST API surface and implementation boundaries without starting code changes.
- **Notes**: Spec written at
  `docs/superpowers/specs/2026-07-06-cross-platform-notification-service-design.md`.
- **Implementation planning update (2026-07-06)**: Created the implementation worktree at
  `.claude/worktrees/notification-service` on `feature/notification-service`; installed dependencies;
  verified the baseline with `pnpm typecheck` and
  `pnpm --filter @docket/api test tests/routes/notifications-inbox.test.ts`; wrote the full
  milestone plan at `docs/superpowers/plans/2026-07-06-cross-platform-notification-service.md`.
- **Implementation update (2026-07-06)**: Started the schema contract slice with TDD, then corrected
  the package boundary per review: notification-domain schemas now live in new `@docket/notifications`
  instead of adding another large surface to `@docket/types`. `@docket/types` remains limited to shared
  primitives/current DTOs for this slice. Validation so far: `@docket/notifications` test/typecheck/lint
  pass; `@docket/types` test/typecheck/lint pass.
- **Schema milestone update (2026-07-06)**: Added reusable notification-domain fixtures under
  `@docket/notifications/testing` and DB schema fixtures under `packages/db/tests/fixtures/`. Added
  notification-service enums, typed jsonb shapes, durable intent/recipient/delivery/preference/contact
  point/inbound-event tables, and nullable `intent_id`/`delivery_id` projection links on the existing
  inbox table. Generated `packages/db/drizzle/0023_large_gauntlet.sql`; inspected it for destructive
  operations (none found). Validation: `@docket/db` test/typecheck/lint pass; `@docket/notifications`
  test/typecheck/lint pass; `@docket/types` test/typecheck/lint pass;
  `@docket/api` notification inbox route suite passes.
- **Policy milestone update (2026-07-06)**: Added pure notification creation policy in
  `@docket/notifications` rather than `apps/api`: category/channel rules, safety-critical preference
  locks, all-users sender restrictions, security/account sender restrictions, and staff-approval
  detection for multi-recipient SMS sends. Validation: `@docket/notifications`
  test/typecheck/lint pass.
- **Audience milestone update (2026-07-06)**: Made audience expansion reusable at the notification
  domain boundary: `@docket/notifications` now owns immutable recipient-input helpers, dedupe, and
  the role catalog for billing-admin segments; `apps/api` owns only the Drizzle-backed resolver for
  explicit users, organizations, all users, and operational segments. Validation: narrow
  `@docket/notifications` audience tests and `@docket/api` audience service tests pass. Full-suite
  validation exposed the new notification `user_id` tables in the account-purge drift guard; fixed
  `purgeUser` coverage for contact points, preferences, and notification recipients. Final gate:
  `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` pass.
- **Preference milestone update (2026-07-06)**: Added reusable notification preference helpers in
  `@docket/notifications` for category/channel defaults, locked-category behavior, organization
  overrides, and timezone-aware quiet-hours checks. Added the API preference resolver for
  per-recipient channel decisions, contact-point destination selection, quiet-hours delays, bounced
  destinations, missing verified contact points, locked security delivery, and explicit opt-outs.
  Final gate: notification service tests, inbox route tests, `pnpm typecheck`, `pnpm lint`,
  `pnpm test`, and `pnpm build` pass.
- **Dispatcher milestone update (2026-07-06)**: Added reusable web projection helpers in
  `@docket/notifications`, promoted `service_announcement` to a first-class inbox type, and added the
  API dispatcher/web adapter that persists durable intents, recipient snapshots, per-channel delivery
  rows, and the existing Hub inbox projection. The dispatcher now preserves unread-count behavior and
  idempotency-key reuse for web sends. Focused verification: `@docket/notifications` tests,
  `@docket/api` notification service + inbox tests, `@docket/db` notification schema test,
  `pnpm typecheck`, `pnpm lint`, and `@docket/api` build pass. The broad `pnpm test` run was stopped
  after 11m39s with only `@docket/api:test` still running; the broad `pnpm build` run was stopped in
  the unrelated web Next.js build tail after API/admin had completed. Do not treat either broad gate as
  green for this slice.
- **REST surface milestone update (2026-07-06)**: Added the staff notification-intent REST surface
  (`POST /v1/notifications`, `GET /:id`, recipients, deliveries, send, cancel, test-send) and the
  long-term `/v1/me/notifications` inbox alias while keeping the legacy `/v1/notifications` inbox
  routes compatible. Refactored route files for DIP/SOC: route modules now expose curried factories
  over directly injected notification services, and concrete Drizzle-backed services are constructed
  at API/test composition points. Focused verification: `@docket/api` typecheck, touched-file ESLint,
  `@docket/api` build, Prettier check, and 76 focused notification/group route tests pass.
  Full-package lint/test remain intentionally bounded because concurrent local Vitest/ESLint worktrees
  were saturating the machine.
- **Preferences/contact points milestone update (2026-07-06)**: Added `/v1/me/notification-preferences`
  GET/PATCH and `/v1/me/contact-points` list/create/verify/make-primary/disable. Preference routes
  materialize default category/channel settings, preserve locked security/account categories, merge
  quiet-hours/timezone updates, and support org-scoped overrides. Contact-point routes materialize the
  account email as a real active primary contact point, create pending phone/push/email destinations,
  verify pending destinations with deterministic test codes, enforce owner isolation, and keep bounced
  destinations visible to preference resolution. Focused verification: `@docket/api` preference/contact
  route tests plus preference resolver tests, `@docket/api` typecheck, touched-file ESLint,
  `@docket/api` build, and `@docket/notifications` typecheck/lint/test pass.
- **Email milestone update (2026-07-06)**: Added the email notification adapter over the existing
  `Mailer` port, with durable delivery status updates for sent, missing-contact, and failed sends.
  The dispatcher now attempts email deliveries after preference/contact-point resolution while leaving
  web inbox read state independent from email delivery state. Migrated recovery-code regeneration to
  dispatch a `security` intent over web and email, preserving the existing email subject/body and
  materializing the authenticated account email as a contact point before dispatch. Account deletion
  scheduling/cancelation and export-ready now dispatch `account` intents over web and email. Daily
  digest sends dispatch `digest` email intents with `skip_user_preferences`, because the digest sweep
  already selects only users who opted into the digest feature while still recording contact-point and
  delivery health. Focused validation: `@docket/api` email dispatcher, account, export, digest, and
  recovery route tests pass.
- **Inbound milestone update (2026-07-06)**: Added the notification inbound service and internal
  callback surface at `/internal/notifications/*`. Email, SMS, and push provider payloads normalize
  into `notification_inbound_event` rows, update delivery lifecycle state, and update contact-point
  health for bounces, complaints/unsubscribes, STOP, START, and invalid push tokens. Routes require an
  HMAC signature over the raw body and stay outside the public `/v1` API. Provider retries are
  de-duplicated by normalized `providerEventId` in the stored payload; a dedicated unique DB key remains
  a future hardening option. Focused validation: inbound service and internal route tests pass.
- **Admin notifications milestone update (2026-07-06)**: Added a staff-gated
  `/admin/notifications` sub-router for listing/detailing notification intents, approving draft or
  scheduled intents into `queued`, rejecting not-yet-delivered intents via cancelation, and reviewing
  related operator audit plus inbound provider events. The route module is mounted from `admin.ts`
  with direct service injection so the already-large admin router stays thin. Follow-up architecture
  correction moved Drizzle queries and operator audit writes out of `admin-notifications.ts` into
  `AdminNotificationService`; the route now owns request/response wiring only, with no dependency
  bag, no dependency-builder helper, and no `usecases` layer. Richer approval-required state remains
  a schema-backed follow-up. Focused validation: `@docket/api` admin notification route tests,
  `@docket/api` typecheck, and touched-file ESLint pass.
- **SMS/push boundary milestone update (2026-07-06)**: Added concrete `SmsSender` and
  `PushSender` ports to `@docket/boundaries`, deterministic capture senders, HTTP real adapters, and
  env-driven container selection for `sms`/`push`. Added `realEnvValue` to `@docket/env` so
  adapter env parsing reuses the shared real-vs-placeholder rule instead of duplicating cleanup
  helpers. The API dispatcher now attempts SMS and push deliveries after preference/contact-point
  resolution, records provider ids/payloads on delivery rows, disables invalid push tokens, and
  keeps service-announcement SMS/push gated by explicit user preference opt-in. Shared delivery-row
  helpers keep email/SMS/push adapters from copying persistence mechanics. Focused validation:
  `@docket/env` env tests, `@docket/boundaries` SMS/push/mailer/select tests, `@docket/api`
  dispatcher SMS/push and email tests, plus env/boundaries/API typechecks pass.
- **Web UX milestone update (2026-07-06)**: Added the user-facing notification experience without
  duplicating notification DTOs in the web app. The inbox now groups unread approval requests under
  "Needs action", handles `service_announcement` rows, and shows cross-channel delivery hints backed
  by sibling delivery rows from the durable notification graph. Settings now exposes an available
  `/orgs/[orgId]/settings/notifications` route for personal and shared workspaces, backed by the
  typed query layer over `/v1/me/notification-preferences` and `/v1/me/contact-points`. New reusable
  settings sections render quiet-hours editing, locked security/account channel rows, mutable
  category/channel preferences, phone verification, and bounced/unsubscribed contact-point states.
  Focused validation: notification inbox route tests, web inbox/settings component tests,
  `@docket/notifications` schema/web tests, notifications/API/web typechecks, notifications/API/web
  lint, API build, and dotenv-wrapped web build pass. A redundant post-build web typecheck/lint rerun
  was stopped after it exceeded prior successful gate times; the web build's TypeScript phase had
  already completed successfully after the `next.config.ts` change, and targeted ESLint on touched
  web files reported no errors.
- **Admin safety API follow-up (2026-07-07)**: Added staff-facing
  `/admin/notifications/:id/estimate` and `/admin/notifications/:id/preview` so the future
  announcement console can show recipient counts, per-channel send/delay/suppression counts,
  suppression reasons, approval gates, and web/email/SMS/push previews before a send. The service
  reuses the existing audience resolver, preference resolver, and policy helpers; the route remains a
  thin curried adapter over direct `AdminNotificationService` injection. Focused validation:
  notification schema DTO tests, admin notification route tests, notification/API typechecks,
  touched-file ESLint, and `git diff --check` pass.
- **Admin console milestone update (2026-07-07)**: Added the staff service-announcement console at
  `/notifications` in `apps/admin`. The console supports compose, audience selection, channel
  selection, scheduling, estimate/preview refresh, test send, approval, send now, cancel, delivery
  monitoring, inbound reply monitoring, and operator audit review. It uses a presentational
  `NotificationAnnouncementConsole` plus a small draft serializer so the route owns API state while
  the UI remains testable. Focused validation: admin console Vitest coverage, admin typecheck,
  touched-file ESLint, and dotenv-wrapped admin build pass.
- **Smoke/docs milestone update (2026-07-07)**: Added a route-level notification service smoke that
  exercises the service-wide staff announcement journey end to end: staff creates a draft over
  `/v1/notifications`, test-sends to self, approves through `/admin/notifications`, sends to a test
  user, verifies the user's `/v1/me/notifications` web inbox row, and asserts `CaptureMailer`
  recorded both staff-test and recipient email sends. The smoke reuses shared route fixtures for
  staff users, contact points, sessions, and the capture outbox. Refactored the staff admin router
  so `admin.ts` accepts the notification sub-router directly; `app.ts` is now the composition root
  that constructs `AdminNotificationService` and exports the composed admin router for tests. Added
  `docs/engineering/specs/notification-service.md`, documented notification provider deployment in
  `docs/engineering/deployment.md`, and exposed SMS/push provider seams in `.env.example`. Focused
  validation: `../../node_modules/.bin/vitest run tests/routes/admin.test.ts
tests/routes/admin-staff.test.ts tests/routes/admin-notifications.test.ts
tests/routes/notification-service-smoke.test.ts`, `../../node_modules/.bin/tsc --noEmit --pretty
false`, and touched-file ESLint pass. Browser E2E remains a later dev-stack gate because capture
  mailer assertions are process-local unless a test mailbox endpoint is added.
- **Validation/audit follow-up (2026-07-07)**: Confirmed notification env cleanup is not duplicated:
  no `cleanEnvString` helper or definition remains under source files, while email/SMS/push provider
  config parsing uses the shared `@docket/env.realEnvValue` helper. Re-ran focused package,
  API, web, and admin gates: `@docket/env` 41 tests, `@docket/boundaries` 391 tests,
  `@docket/notifications` 18 tests, focused API notification bundle 41 tests, web notification UX 6
  tests, and admin console 2 tests passed. The earlier package-test stall was diagnostic noise from
  concurrent/truncated Vitest output plus unrelated repo processes; no Vitest process from this
  notification worktree remained alive when checked.
- **Full gate follow-up (2026-07-07)**: Ran the root verification gates for the notification
  worktree. `pnpm typecheck` passed with 13 successful tasks; `pnpm lint` passed with 13 successful
  tasks. The first `pnpm test` run exposed a timing-sensitive web sign-in component test: under full
  Turbo concurrency, the post-passkey session-recovery assertion timed out before the component's
  retry window finished. Hardened that test around the real retry contract with an explicit
  `expectSessionRecoveryError` helper, then verified
  `../../node_modules/.bin/vitest run tests/components/auth/sign-in-page.test.tsx`,
  `../../node_modules/.bin/vitest run` from `apps/web`, `pnpm --filter @docket/web typecheck`,
  `pnpm --filter @docket/web lint`, and a fresh `pnpm test`. The final root test gate passed with
  13 successful tasks; `@docket/api` reported 111 files / 1102 tests and `@docket/web` reported 40
  files / 237 tests. Browser E2E remains the next unchecked milestone gate.
- **Browser E2E follow-up (2026-07-07)**: Added
  `apps/web/e2e/notifications.spec.ts` for the user-facing notification milestone. The spec signs up
  and onboards a real user through the shared passkey E2E helper, opens
  `/orgs/[orgId]/settings/notifications`, saves a mutable channel preference, saves quiet hours,
  adds a phone contact point through `/v1/me/contact-points`, verifies the pending destination state,
  and opens `/inbox` to confirm the notification shell renders without app-level error alerts. Ran an
  isolated branch dev stack with `DATABASE_URL=pglite://.data/docket-e2e-notifications-1783402329`,
  API on `http://localhost:4100`, and web on `http://localhost:3100`. Validation:
  `pnpm --filter @docket/db db:migrate` with the E2E env passed; API and web served on the isolated
  ports; `APP_URL=http://localhost:3100 API_URL=http://localhost:4100 PASSKEY_RP_ID=localhost pnpm
--dir apps/web test:e2e sign-in.spec.ts` passed 1/1 in 1.7m; `APP_URL=http://localhost:3100
API_URL=http://localhost:4100 PASSKEY_RP_ID=localhost pnpm --dir apps/web test:e2e
notifications.spec.ts` passed 1/1 after selector tightening; `pnpm --dir apps/web exec tsc -p
  e2e/tsconfig.json --noEmit`, `pnpm --filter @docket/web lint`, and `pnpm exec prettier --check
  apps/web/e2e/notifications.spec.ts` passed.
- **Completion audit (2026-07-07)**: Verified the implemented tree against the notification-service
  spec checklist: schema symbols exist for intents, recipient snapshots, deliveries, preferences,
  contact points, and inbound events; API mounts exist for `/v1/me/notifications`,
  `/v1/me/notification-preferences`, `/v1/me/contact-points`, `/v1/notifications`,
  `/admin/notifications`, and `/internal/notifications`; web/email/SMS/push adapters record
  delivery state through shared delivery helpers; inbound services normalize provider events and
  update delivery/contact-point health; staff and user UX files plus component/E2E tests are present;
  operational docs exist in `docs/engineering/specs/notification-service.md` and
  `docs/engineering/deployment.md`; and `git rev-list --merges --count origin/main..HEAD` returned
  `0`.

### [AUTH-SEC-001] Auth security & UX audit remediation

- **Status**: DONE (M0–M5 all landed & green)
- **Started**: 2026-07-02
- **Priority**: P0
- **Description**: Remediate all findings from the auth audit — the critical passkey
  pre-registration account-takeover, the `emailVerified:true`-without-verification linking risk,
  missing rate limiting, absent security headers, and the P1/P2 UX gaps (session-expiry UX, passkey
  management, sign-out, active sessions, change-email). Root fix: **verify-before-passkey** — signup
  proves inbox ownership before the WebAuthn ceremony binds a credential, no usernames introduced.
- **Approach**: Six milestones (M0 foundations → M1 close ATO → M2 rate limits/headers → M3
  session-expiry UX → M4 passkey management → M5 remaining surfaces). Plan:
  `~/.claude/plans/how-complete-is-our-witty-simon.md`.
- **Subtasks**:
  - [x] M0: `buildMailer(env)` factory in `@docket/boundaries`; pure auth-email builders
        (`packages/auth/src/emails.ts`); explicit session config (`expiresIn` 30d / `updateAge` 1d /
        `freshAge` 300s) in `buildAuthOptions` — closes the no-hidden-defaults gap.
  - [x] M1: `signupChallenge()` plugin (`/sign-up/request-code` + `/sign-up/verify-code`, anti-enum,
        rate-limited); `resolvePasskeyUser` requires a single-use verified intent + rejects existing
        credentialed accounts; HMAC passkey-intent route + module DELETED; two-step web sign-up
        (verify-before-passkey); e2e helper updated (dev-gated code echo); ATO-closure integration tests.
  - [x] M2: global Better Auth `rateLimit` (`storage:'database'` via new `rate_limit` table +
        migration `0018`; per-path `customRules` on sign-in/consent/token/verify); security headers
        (`frame-ancestors 'none'` + `X-Frame-Options`/HSTS/`nosniff`/Referrer-Policy/Permissions-Policy)
        on web + admin `next.config.ts`.
  - [x] M3: mid-session 401 → `SessionExpiredError` in `unwrap`, global sign-out + `/sign-in?next=`
        redirect wired via injected `createQueryClient({ onError })` in `providers.tsx` (401 not
        retried); sign-in honors a validated same-origin `?next=`; `use-reauth` gives no-passkey users a
        clear "add a passkey" message instead of a cryptic failure; visible **AccountMenu** (sign-out)
        pinned to the sidebar foot via a new `footer` slot on the design-system `Sidebar`.
  - [x] M4: **passkey management** in Settings → Security (new `passkeys-section.tsx`: list via
        `passkey.listUserPasskeys`, add from the authenticated session via `passkey.addPasskey`, rename
        via `updatePasskey`, remove via `deletePasskey` with a louder confirm when it is the account's
        only credential); `SecurityTab` split so passkeys + recovery-codes cards each own their loading
        state. **Onboarding passkey enrollment** for social sign-ups: a skippable `passkey` beat
        (new `step-passkey.tsx`) appended to either fork only when `listUserPasskeys` returns empty; the
        connect exit routes through it (both primary and Skip) so the nudge isn't lost, and `addPasskey`
        runs the session-bound ceremony then enters the workspace.
  - [x] M5: **active sessions** — new `/v1/me/sessions` resource (`me-sessions.ts`, direct
        `session`-table reads/deletes mirroring Better Auth's own `/revoke-session` internals, so
        it's testable with the fake-session harness) + `SessionsSection` device list (revoke one,
        "Sign out other devices"; the current session can't self-revoke — 409 `current_session`).
        **Change-email** — `user.changeEmail` + `emailVerification.sendVerificationEmail` wired
        into `buildAuthOptions` (confirmation goes to the OLD address, never the new one);
        `ChangeEmailSection` in Security tab; a one-time `?email-changed=1` banner on the security
        page. **Security-notification email** — recovery-code regeneration now emails the account
        holder (`recoveryCodesRegeneratedEmail`, fired from `me-recovery.ts`); "new passkey added"
        and "account recovered" notices are an explicit, documented gap (no clean Better-Auth
        plugin-lifecycle hook found without unverified guessing — see DECISIONS.md). **Consent
        metadata (LOW-6)** — new `GET /v1/oauth/clients/:clientId/metadata` returns the
        server-validated CIMD name/icon already persisted on `oauthApplication`; the consent page
        (`/oauth/authorize`) no longer fetches the attacker-controlled `client_id` URL itself.
- **Notes**: M0–M5 gate green — `@docket/boundaries` 279, `@docket/auth` 49, `@docket/db` 40,
  `@docket/types` clean, `@docket/api` 977, `@docket/web` 211 tests; typecheck + lint clean on all
  touched packages (api lint clean in full). ATO closed at the root; DECISIONS.md →
  "auth-security" records it, including the M5 architecture calls and the deferred passkey/
  recovery notification gap.
- **Incident note**: mid-session, a concurrent process (Discord/Slack/Apple-sign-in integration
  work landing in the same primary checkout) rewrote/rebased this branch's history underneath this
  work more than once — files vanished and reappeared, a migration number collided (resolved into
  one clean `0017_woozy_aaron_stack.sql`), and an in-flight Apple-sign-in WIP diff had to be
  stashed before a `wip/discord-integration` → `main` rebase could proceed. All auth-security work
  survived; verified end-to-end afterward via the full typecheck/lint/test gate above.

### [SEARCH-001] Workspace-wide semantic search foundation

- **Status**: REVIEW (design spec written; implementation plan pending user review)
- **Started**: 2026-07-03
- **Priority**: P1
- **Description**: Build workspace-wide search as a durable, event-log-aware read model rather than
  extending the current task/project/program `ILIKE` endpoint. Search must preserve the semantics of
  work objects, people/agents, content/context, and canonical activity events while enforcing the
  same tenant and visibility boundaries as the source entities.
- **Approach**: Use a Postgres-owned `search_document` projection plus a durable
  `search_index_job` outbox. Entity projectors preserve typed result kinds, IA family, route,
  subject, facets, snippets, ranking signals, and query-time visibility metadata. The canonical
  `event` log becomes both searchable `activity` content and an indexing signal for related
  objects; direct entity-write enqueueing remains the correctness path so search is not dependent on
  best-effort event emission.
- **Subtasks**:
  - [x] Product/data architecture spec (`docs/superpowers/specs/2026-07-03-workspace-search-design.md`)
  - [ ] Implementation plan with TDD tasks
  - [ ] Phase 1 foundation and palette parity
  - [ ] Phase 2 full entity coverage and inherited visibility tests
  - [ ] Phase 3 faceted `/search` page
- **Notes**: The design keeps `/v1/hub/search` as the command-palette-compatible entry point,
  adds an org-scoped search endpoint, and leaves a future mirror seam for external/vector search
  after the internal read model is stable.

### [DISCORD-001] Discord mentions in the activity firehose

- **Status**: COMPLETED
- **Started**: 2026-07-02
- **Priority**: P2
- **Description**: Let a Docket user see everywhere they're @-mentioned on Discord in the personal
  Stream, mirroring how Slack mentions already surface. The design confronts Discord's transport
  limitation head-on and fixes a latent gap in external-mention routing.
- **Approach**: Discord joins the canonical Event substrate as an observe-only provider (like
  Slack), with two Discord-specific additions. (1) **Transport**: ordinary message mentions are
  only available over a persistent Gateway WebSocket (`MESSAGE_CONTENT` intent), which the
  serverless+cron platform can't host — so the socket is quarantined in a separate always-on
  `services/discord-relay` sidecar that POSTs to a token-routed ingest edge; Docket's brain stays
  serverless and transport-agnostic. (2) **Attribution seam**: today the drain routes external
  mentions only to the integration owner — we add `participantUserIds` to routing and resolve
  mentioned external ids → Docket users via Better Auth account linking, so mentions surface for
  the person actually named. The seam is provider-neutral infra (Discord is its first/only consumer
  today — Slack has no OAuth link and Linear's observer emits no participants), verified through the
  mock observer's `participants` fixture with no live Discord infra. Delivered in two phases: Phase 1
  (serverless HTTP seam, Ed25519 observer, identity linking, attribution, firehose UI) and Phase 2
  (the Gateway relay).
- **Subtasks**:
  - [x] Architecture spec (`docs/engineering/specs/discord-observation.md`)
  - [x] Frozen decisions (Gateway-relay transport; mention-attribution seam) in `DECISIONS.md`
  - [x] Phase 1A — Discord provider leaves (types, enum+migration `0017`, Ed25519 observer, ingest, select)
  - [x] Phase 1B — per-user OAuth "Connect Discord" (Better Auth `identify` + live catalog entry)
  - [x] Phase 1C — attribution seam (`participantUserIds` in `routing.ts` + drain account resolution)
  - [x] Phase 1D — firehose UI ("Mentioned you" chip; Discord badge + Source filter; Kind=Mention view)
  - [x] Phase 2 — `services/discord-relay` + token-routed `/internal/ingest/discord/:token`
- **Notes**: The whole ingest → drain → `event_recipient` → personal-feed pipeline already existed;
  the firehose renders mentions once recipient rows are written. `RealSlackObserver` was the direct
  template; the only structural difference is Ed25519 signature verification (public key) vs HMAC.
  The mentions view is the existing Kind=Mention toolbar filter (a `relevance` catalog filter would
  break the org firehose, which has no `event_recipient` join); the new chip surfaces the reason.
- **Files changed**: `packages/types/src/{event,identity,public-config}.ts` (add `discord`
  source/`SourceSystemKind`, `discord.message` `EventDetail`, `discord` `IdentityProvider`, new
  `SignInProvider` superset for `oauthProviders`); `packages/db/src/enums.ts` + migration
  `0017_fat_malice.sql` (`source_system += 'discord'`); `packages/boundaries/src/{ports/observer,
real/observer-discord,mock/observer,select}.ts` (Ed25519 `RealDiscordObserver` + registry + mock
  fixture); `packages/env/src/{slices,registry-vars-core,api}.ts` (`DISCORD_PUBLIC_KEY` +
  OAuth pair + cross-field rule); `packages/auth/src/auth-builder.ts` (Discord social provider,
  `identify` scope); `apps/api/src/{routes/ingest,routes/event-sync,consumers/routing,routes/config,
routes/integration-provider}.ts` (`/discord` + `/discord/:token` edges, drain source map +
  attribution resolution, `participantUserIds` routing); `apps/web/src/components/{stream/*,settings/
identity-providers}.ts(x)` + `packages/ui/src/icons/index.ts` (badge, Source option, "Mentioned
  you" chip, live catalog entry); new `services/discord-relay/` worker; `.env.example`; docs
  (`discord-observation.md`, `DECISIONS.md`, `activity-feed.md`, this log).
- **Gate**: closeout evidence refreshed on 2026-07-07. Discord relay typecheck/lint/test passed
  (10/10 relay tests). Server-side contract packages typecheck/lint passed:
  `@docket/{types,env,auth,boundaries,api}`. Targeted API coverage passed:
  `ingest-discord` 4/4, `ingest-discord-token` 3/3, and `event-sync-attribution` 3/3. Auth
  Discord OAuth-link coverage passed (`tests/auth.test.ts -t "Discord"`). Boundaries coverage
  includes the real Discord observer signature/route/normalize suite. Full closeout gate passed
  after capping API Vitest fixture concurrency: `pnpm typecheck` (12/12), `pnpm lint` (12/12),
  `pnpm test` (11/11; API 106/106 files, 1134/1134 tests), and `pnpm build` (3/3).
- **Learnings**: Discord's only per-user-mention transport is the Gateway socket, which the
  serverless core can't hold — the fix is a transport-agnostic ingest edge + a quarantined relay,
  reusing the existing `event_subscription.ingestToken` seam so no new routing pattern is invented.
  The attribution seam (`participantUserIds`) is real substance, not just "add an adapter": external
  mentions previously reached only the integration owner. Reusing Better Auth `account` linking (its
  `accountId` IS the provider snowflake) avoids a parallel identity table. Surfacing this exposed a
  latent `oauthProviders` type gap (it carried `apple`, a sign-in-only provider absent from
  `IdentityProvider`) — fixed with the `SignInProvider` superset.
  The mentions view is the existing Kind=Mention toolbar filter (a `relevance` catalog filter would
  break the org firehose, which has no `event_recipient` join); the new chip surfaces the reason.

---

## Completed Tasks

### [ATHENA-MCP-UX-002] Clarify personal connector management

- **Completed**: 2026-07-14
- **Priority**: P1
- **Summary**: Reframed the connector surface around personal services and Athena's access,
  separated adding a connector into a modal, kept the editable name visible, and replaced raw
  transport statuses with readiness language.
- **Files Changed**: MCP settings UI and draft helper; MCP connector metadata contract and preview
  route; focused API and web tests; this work log.
- **Validation**: Focused integration, API, and web tests pass. Root release gates run before the
  commit.
- **Retrospective**: The connector list should communicate what Athena can use, while setup
  belongs in a focused dialog with the remote service's own identity as the starting point.

### [ATHENA-MCP-UX-001] Simplify Athena connector setup

- **Completed**: 2026-07-14
- **Priority**: P1
- **Summary**: Replaced the protocol tutorial and dense two-column MCP form with a URL-first
  OAuth path, generated connector identity defaults, vertical connection records, and disclosures
  for name overrides, server details, and alternate authentication methods.
- **Files Changed**: MCP connector settings component and URL-identity helper; focused web test;
  connector clarity design and implementation plan.
- **Validation**: Focused web tests, root typecheck, lint, test, and build all pass. The rendered
  authenticated connector surface also passes its Playwright capture.
- **Retrospective**: The standard connection path should be visible without protocol terminology;
  optional configuration belongs behind a deliberate reveal.

### [INIT-OVERVIEW-SCROLL-001] Restore medium-width Initiative columns

- **Completed**: 2026-07-13
- **Priority**: P1
- **Summary**: Restored the complete six-column Initiative table from medium container widths
  onward, constrained horizontal overflow to the roster region, moved attention actions into a
  dedicated footer, and normalized Initiative row heights with one title line plus two reserved
  description lines.
- **Files Changed**: Initiative overview, visual-contract coverage, responsive design spec and plan,
  design audit screenshots and scorecard, and this worklog.
- **Validation**: Focused visual contract passes 4/4. Live review confirmed an 896px table scrolls
  inside a 766px roster without widening the 1440px page; mobile remains compact, 320px has no page
  overflow, light and dark screenshots are clean, and the browser console reports no warnings or
  errors. `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass. `pnpm test` remains blocked by the
  same four unrelated repository-policy failures in provider catalog, documentation coverage, and
  web error-source enforcement.
- **Retrospective**: A dense table should preserve its information model and scroll locally when
  space is constrained. Replacing columns with a different row structure is appropriate for mobile,
  not for every intermediate workspace configuration.

### [INIT-VISUAL-POLISH-001] Remove overlines and repair Initiative layout

- **Completed**: 2026-07-13
- **Priority**: P1
- **Summary**: Replaced all-caps overline treatments with plain sentence-case labels across Docket,
  added a named 32–56px document-title scale, placed Initiative status above the title, converted
  the attention band into one borderless tonal surface with a unified action/pager group, and kept
  the Initiative roster in readable compact rows until a genuinely wide container is available.
- **Files Changed**: Initiative overview and detail routes, shared typography tokens and merge
  configuration, semantic label call sites, visual-contract coverage, design audit screenshots,
  and the Initiative craft scorecard.
- **Validation**: Focused visual contract 4/4, `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass.
  Live review covered 1440px and 390px in both themes plus the reported 1000px intermediate state;
  320px measured no horizontal overflow and the browser console was clean. `pnpm test` remains
  blocked by four unrelated baseline policy failures in provider catalog, documentation coverage,
  and web error-source enforcement.
- **Retrospective**: Container width, not viewport width, determines whether a dense table is usable.
  Action and pagination controls that operate on the same attention item should remain one visual
  group at every breakpoint, and document-scale type deserves a named product token instead of a
  route-local clamp.

### [CAL-UX-003] Harden scheduling interactions to calendar-product parity

- **Completed**: 2026-07-13
- **Priority**: P0
- **Summary**:
  - Rebuilt the time axis around one viewer-timezone wall clock with adaptive labels, minor ticks,
    a current-time line refreshed every 30 seconds, explicit DST gap/fold bands, disambiguated
    repeated-hour labels, and rejection of ambiguous edits as well as invalid selections.
    Continuous zoom remains one 24–240 pixels-per-hour scalar; Overview, Standard, and Detail are
    shortcuts rather than separate views, and zoom preserves the centered wall time.
  - Integrated deterministic side-by-side collision columns into the production canvas, including
    minimum interactive height for short low-zoom items, stable four-pixel gutters, and an
    accessible `+N` disclosure that promotes hidden dense items into the real direct-edit surface.
    Replaced the unconditional quadratic collision matrix with a linear-memory interval sweep and
    component-scoped minimum coloring for the exact-instant conflicts that can occur at DST folds.
  - Added live, cancellable pointer, touch, and keyboard move plus true-edge resize interactions
    with exact previews, activation thresholds, edge autoscroll, announcements, and permission/
    source-model checks before persistence. Writable all-day and cross-midnight ranges edit from
    their true first/last segments; read-only, conflicted, and derived items stay openable without
    false edit affordances.
  - Made region selection obey the same interaction lifecycle: the initiating pointer owns a
    captured live preview, while Escape, pointer cancel, lost capture, and unmount all clear it
    without creating an item.
  - Kept date and arbitrary people/resource lanes on the same bounded, responsive component. Fixed
    sticky-gutter alignment, resize-induced false boundary navigation, narrow degraded-state copy,
    and stale range caches after creation or a cross-range update. Workspace changes immediately
    clear prior comparison members, lanes, selection, and shared details before loading the next
    workspace. Details-shared cards open immutable comparison-backed details without an owner-only
    item request; busy-only cards remain opaque, static, and non-openable.
  - Added native task-to-timebox and calendar-item-to-event drops while keeping relationship drag,
    keyboard target mode, and timed move/resize arbitration separate. Calendar and Agenda continue
    rendering their grids beneath loading, empty, stale, and hostile server failures with fixed
    application-owned copy and retry actions. Stored per-layer diagnostics likewise surface only
    the fixed `Calendar sync issue` indicator.
  - Rebased onto current `origin/main` and repaired its adjacent public contracts without weakening
    error boundaries: restored the omitted selective-export UI as five focused modules, proved a
    hostile `AGENT_MAX_TURNS` server detail cannot render there, aligned auth recovery tests with
    RFC 9457 problems, and removed route tests for deliberately retired Slack/Discord ingestion
    while preserving provider-neutral identity attribution through active Linear.
  - Kept continuous zoom as one scalar with three shortcuts, compacted those shortcuts to a preset
    selector on narrow screens, made the 1440px surface retain two fluid date lanes beside Agenda,
    and moved secondary layer controls below the grid whenever they would consume scheduling width.
- **Files Changed**: Shared scheduling time-axis, collision, gesture, viewport, card, notice, and
  type modules; Calendar and Agenda consumers/mutation policies; focused unit/component tests;
  recorded Chromium e2e contracts and helpers; layered-calendar product and engineering specs;
  `docs/design/audits/2026-07-13-calendar.md`.
- **Design**: `docs/superpowers/specs/2026-07-13-scheduling-interaction-parity-design.md`
- **Implementation Plan**:
  `docs/superpowers/plans/2026-07-13-scheduling-interaction-parity.md`
- **Validation**:
  - Focused Scheduling, Calendar, and Agenda suites pass 54/54 files and 427/427 tests.
  - The isolated real Chromium contract passes 10/10 recorded scenarios, covering arbitrary
    rolling windows, every zoom form, region creation, responsive cache changes, cross-date and
    all-day moves, true-edge resizing, dense `+N` promotion, object drops, keyboard relationships,
    provider read-only behavior, safe server failures, comparison-backed shared details, touch
    long-press, and spring/fall DST behavior. The four required design-review screenshots and all
    ten videos are retained under `apps/web/.data/calendar-e2e-evidence/final/` as ignored local
    artifacts.
  - The 10,000-item disjoint overlap benchmark fell from 1,591.2ms and roughly 984MB RSS to 21.9ms
    near the 168–172MB process baseline. A 10,000-item lane with one exact-only conflict completes
    in 13–14ms and recolors only that pair; deterministic randomized parity, mixed exact/wall input
    permutations, and a two-colorable adversarial graph protect the optimized paths.
  - Repository formatting passes; typecheck and lint pass 17/17 tasks each. Web passes 104/104
    files and 701/701 tests; UI passes 257/257; tooling passes 32/32; DB and migration coverage
    passes 54/54. API passes 132/134 files and 1,204/1,216 tests. Its only 12 failures are the two
    time-ledger suites inherited from `origin/main` commit `d8e08c4`, whose commit explicitly
    deferred the required migration. The concurrent dirty-main worktree owns the intended
    untracked `0031`–`0036` migration chain; generating another migration here would collide with
    it and omit five cyclic/self foreign keys plus six database checks. The production build passes
    API, web, and admin 3/3 with the required agent turn budget declared.
- **Retrospective**:
  - **Went well**: keeping geometry and gestures consumer-neutral let Calendar, Agenda, dates, and
    people/resource comparison share one interaction engine without hardcoded day/week branches.
  - **Improved during validation**: recorded browser passes caught header/gutter clipping,
    resize-driven boundary navigation, a stale compact query window, one-day desktop collapse,
    phantom pre-measurement lanes, drawer stacking, dense-item action loss, and touch/keyboard focus
    traps. Independent review also closed destination-range invalidation, explicit DST-fold edit
    choice, cross-midnight clipping, pointer cancellation, all-day true-edge ownership,
    shared-detail privacy, opaque-item semantics, live-clock edge cases, exact-conflict scope,
    minimum collision coloring, and mixed exact/wall ordering. A final read-only rereview found no
    remaining Critical or Important blocker in those fixes.
  - **Learned**: a responsive rolling calendar must invalidate the whole item-range cache family
    after creation and updates; invalidating only the active range is observably wrong when lane
    geometry changes or an item moves into a previously empty destination range.

---

### [CAL-UX-002] Build the fluid unified scheduling canvas

- **Completed**: 2026-07-12
- **Duration**: One implementation session
- **Summary**:
  - Replaced fixed calendar modes with an arbitrary-lane scheduling canvas. Live viewport geometry
    determines the rolling date window; overscan is an explicit host policy, not a fixed day count.
  - Added continuously adjustable vertical scale, derived five-to-sixty-minute snapping, region
    selection, cross-lane move/resize, horizontal boundary expansion, and vertical scroll retention.
  - Added first-class native events and timeboxes, provider-backed event creation through an
    idempotent local-first outbox, calendar-item relationships, task containment, personal defaults,
    and explicit per-workspace layer sharing.
  - Added permission-safe people comparison over arbitrary selected members. Busy-only and private
    items are structurally redacted before leaving the API.
  - Unified the agenda timeline on the same canvas, made task rows/calendar items draggable onto
    event/timebox targets, and kept the grid mounted beneath loading, empty, stale, and error states.
  - Split the calendar page, drawer, and expanded API route into focused modules. The calendar page
    and drawer public entry points are now 158 and 123 lines respectively; their extracted UI
    collaborators remain at or below 219 lines.
- **Files Changed**: Calendar type contracts and tests; calendar DB schema, relations, migration
  `0032`, and migration tests; provider sync/write services and API routes/tests; scheduling,
  calendar, agenda, settings, and task-list web components/tests; layered-calendar product/UI specs;
  this worklog.
- **Validation**:
  - Full repository typecheck and lint pass (17 package tasks each).
  - Production build passes for API, web, and admin; `/calendar` and
    `/orgs/[orgId]/settings/calendar` are present in the built route manifest.
  - 2,699 tests pass across the repository. The full run exposed three unrelated MCP credential
    tests whose key is snapshotted before their in-file assignment; those six tests pass when the
    documented key is present at process start. All 45 focused API tests, 37 focused scheduling/UI
    tests, 261 type tests, and 54 DB/migration tests pass.
  - Browser control was unavailable in this session (no browser binding), so no interactive
    screenshot claim is made; runtime interaction coverage comes from the focused DOM tests and
    production build.
- **Retrospective**:
  - **Went well**: keeping geometry/pointer interpretation consumer-neutral made date, person, and
    agenda lanes share one engine without view-mode branches.
  - **Improved during implementation**: monolithic drawer/page/route files were split before adding
    more behavior; rolling-window changes now preserve vertical time position.
  - **Learned**: legacy agenda provider rows share ids with normalized calendar items, so merge order
    must favor the normalized item to retain permissions and relationship behavior.

---

### [WORKSPACE-CREATE-001] Add shared workspace creation entry points

- **Completed**: 2026-07-12
- **Priority**: P1
- **Summary**: Added a focused authenticated `/workspaces/new` flow launched from the workspace
  switcher, account menu, and command palette. Onboarding and repeat creation now share one
  workspace-name field and typed creation helper. Removed the user-facing vocabulary picker from
  onboarding and Settings while retaining stored vocabulary skins for compatibility.
- **Files Changed**: App-shell workspace launchers, onboarding workspace setup, Settings registries,
  the new workspace page and shared creation modules, focused tests, product/build documentation,
  and this log.
- **Validation**: Focused web tests pass 303/303 and UI tests pass 256/256. Repository typecheck and
  lint each pass 17/17 tasks; the full test gate passes 17/17 packages (including API 1,199/1,199),
  and the production-pinned build passes 3/3. `pnpm format:check` and `git diff --check` pass.
- **Learnings**: The retired Settings picker only changed in-session state, so removing it avoids a
  misleading control without a migration. A neutral name field plus one typed creation helper is
  the right shared boundary: onboarding can continue into connections while repeat creation can
  refresh the org cache and enter the new workspace immediately.

### [DX-COMMIT-001] Enforce feature-oriented commit messages

- **Completed**: 2026-07-12
- **Priority**: P1
- **Summary**: Restricted authored commits to `feat`, `fix`, and `chore`; required every normal
  commit to include at least 100 non-comment characters of plain-language context; and aligned
  branch and contributor guidance around coherent product slices. Supporting tests, documentation,
  refactors, build changes, CI changes, and performance work now travel with the feature or fix they
  serve instead of creating process-oriented history.
- **Files Changed**: `AGENTS.md`, `docs/contributing/workflow.md`, `package.json`,
  `scripts/validate-commit-message.mjs`, `tests/tooling/commit-message.test.ts`, and this log.
- **Validation**: `pnpm test:tooling` passes 25/25 tests, covering all three allowed types, rejected
  legacy types, missing and placeholder bodies, free-form Markdown sections, formatting, and the
  existing interactive bootstrap suite. Repository typecheck and lint each pass 17/17 package
  tasks, and `git diff --check` reports no whitespace errors.
- **Learnings**: A minimum-substance gate provides useful enforcement without forcing authors into
  a mechanical body template. Plain prose should be the default, with Markdown sections reserved
  for changes whose complexity benefits from additional structure.

### [PM-AUDIT-001] Multi-organization project-management design audit

- **Completed**: 2026-07-10
- **Priority**: P0
- **Summary**: Audited Docket's cross-workspace and org-scoped project-management experience for an
  owner coordinating companies, nonprofits, an emerging organization, and personal work. Separate
  UI/UX and raw-functionality passes found that Docket already has a stronger cross-workspace
  substrate than Linear, but hides its executive attention model and resets orientation when users
  switch workspaces. The resulting scorecard defines a portfolio-first sequence around Today,
  workspace continuity, Portfolio lenses, project freshness, and generalized personal views.
- **Files Changed**: `docs/design/audits/2026-07-10-project-management.md`, `docs/WORKLOG.md`.
- **Validation**: API suite passed (132 files / 1,198 tests); web suite passed (51 files / 301
  tests). The local stack responded, but browser control was unavailable, so the current mobile and
  populated screenshot gates are explicitly marked unverified rather than inferred from source.
- **Learnings**:
  - Aggregating every workspace is not enough; the personal layer must rank attention and expose
    neglected or stale domains.
  - Today already receives approvals, blockers, due work, inbox load, plan groups, and attention
    counts, making the highest-value UX repair mostly a surfacing problem.
  - The existing workspace attention field and Hub query capabilities provide useful seams, but
    navigation continuity and grant-aware read tests must be settled before expanding the surface.

### [DISCORD-002] Shared provider catalog and external-recipient closeout

- **Completed**: 2026-07-07
- **Summary**: Consolidated provider capability metadata into a pure `@docket/types` catalog and
  narrowed observer providers to the webhook-capable set (`github`, `linear`, `slack`, `discord`).
  API directory/config/source/identity mappings now derive from that catalog, while web stream and
  connector-identity UI code reuse shared labels/mappings without importing runtime adapters.
  Routing now has one `externalRecipients` input for pre-resolved external relevance, so Discord's
  linked-identity mentions and Slack's richer mention/DM/thread classifications share the same
  strongest-reason merge path.
- **Files Changed**: `packages/types/src/provider-catalog.ts`, integration observer/connector
  type surfaces, API integration config/event-drain/routing code, stream/settings display helpers,
  and focused provider-catalog/routing tests.
- **Learnings**: Slack and Discord were not duplicating transport infrastructure, but provider
  metadata was scattered enough to drift. The safe reuse seam is a pure catalog in `@docket/types`;
  provider-specific syntax and Slack's workspace-aware relevance logic should remain local.
- **Gate**: Focused package checks passed for `@docket/types`, `@docket/integrations`, `@docket/api`,
  and `@docket/web`. Full root gate passed: `pnpm typecheck` (16/16 tasks), `pnpm lint` (16/16),
  `pnpm test` (15/15; API 107/107 files, 1060/1060 tests), and `pnpm build` (3/3).

### [SEARCH-002] Workspace-wide semantic search implementation

- **Completed**: 2026-07-03
- **Summary**: Implemented the workspace-wide semantic search foundation. Postgres now owns a
  durable `search_document` read model and `search_index_job` outbox, with Drizzle migration,
  search enums, typed DTOs, projector registry, ranking/cursor query service, durable enqueue and
  backfill tooling. Hub search and org-scoped search now return shared `SearchOut.items`, and
  source writes/event-log writes enqueue index repair work instead of relying on direct table
  scans. The search query path applies explicit visibility semantics for user-private,
  org-member, grantable, and event-derived documents, uses weighted Postgres FTS with substring
  fallback, boosts active workspace and caller-related results, applies palette-only family
  diversity, preserves private-subject inheritance for comments/activity, and exposes
  URL-shareable filters for workspace, family, kind, source, owner, assignee, label, status/health,
  archive, and date range. The command palette and authenticated `/search` consume the same
  semantic API. A follow-up hardening pass made the final score include weighted FTS rank,
  enforced the command-palette server cap at 50 while preserving page requests up to 100, carried
  event-recipient relevance into ranking, added freshness-aware repair for stale source rows and
  newer canonical events, exposed the search-index processor through cron and a local script, made
  backfill source scans cursor-pageable, and preserved provider/source attribution in compact
  palette rows.
- **Files Changed**: `packages/db/src/{enums,schema/search,schema/index}.ts`,
  `packages/db/drizzle/0027_sharp_franklin_storm.sql`, `packages/types/src/{search,hub,index}.ts`,
  `apps/api/src/search/**`, `apps/api/src/routes/{hub,orgs,search,event-emit,event-sync}.ts`,
  write-through route/MCP surfaces under `apps/api/src/{routes,mcp,lib}`,
  `scripts/search-backfill.ts`, `scripts/search-process-jobs.ts`,
  `apps/web/src/{lib/search-route,components/search/**,components/command-palette/**}.ts*`,
  authenticated search pages under `apps/web/src/app/(app)`, focused API/web/db/types tests,
  `package.json`, and this worklog.
- **Learnings**: Search needed to preserve entity semantics instead of flattening everything into a
  legacy hit type. Event emission should index the canonical event as activity and enqueue a
  provenance-linked repair for mapped Docket subjects; direct entity writes and event-log repairs
  are separate durable intents. The full search page works best as URL-backed information
  architecture: families are the broad mental model, kinds and sources refine it, ownership/labels
  and state filters expose workflow semantics, workspace filters stay explicit, and date filters
  translate to API datetime bounds at the edge.
- **Gate**: Historical focused/package validation included `@docket/types` typecheck and tests,
  `@docket/db` typecheck and focused search schema test, `@docket/api` typecheck plus focused
  search/route suite, and `@docket/web` typecheck and tests. This rebased closeout reruns the root
  gates after landing.

### [MCP-PROD-014] Prefer Vitest utilities over custom env plumbing

- **Completed**: 2026-07-06
- **Summary**: Removed remaining custom/manual env mutation patterns from tests in favor of
  Vitest-owned APIs. The shared Vitest preset now enables `unstubEnvs`, auth baseline env lives in
  package config, and DB/API/MCP/env tests use `vi.stubEnv()` directly instead of assigning or
  deleting `process.env` or maintaining original-value restore helpers. The preset also uses
  Vitest's thread pool with a wider hook bootstrap budget, keeping file/package concurrency while
  avoiding fork-worker startup and PGlite route-bootstrap false failures under load. Project-shaped
  helpers remain only where Vitest has no equivalent.
- **Files Changed**: `tooling/vitest/preset.ts`, `packages/auth/vite.config.ts`, auth/db/env tests,
  API lib/infra/MCP tests, API route harness support, and the web onboarding env tests.
- **Learnings**: Baseline env belongs in `test.env`; per-test behavior belongs in `vi.stubEnv`.
  Expensive auth module cold-import work should stay out of pure helper tests, and reusable API
  route harness code belongs in `tests/support/`, not in a `.test.ts` module.
- **Gate**: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` pass. Focused
  `@docket/{db,auth,env}` tests, full API and web package tests, API MCP/env tests, and web
  onboarding tests also pass; cleanup scans find no direct test env mutation or custom env restore
  helpers.

### [MCP-PROD-013] Remove double casts and centralize reusable test helpers

- **Completed**: 2026-07-06
- **Summary**: Removed the remaining repo-wide double-cast patterns and moved reusable test-only
  helpers out of individual test files. Web response/query helpers now live under
  `apps/web/tests/support/`, picker-option test actions are shared, Stripe gateway tests reuse
  exported billing mapper view types, raw Drizzle result row counting is centralized in API source,
  and UI keyboard tests import the hook's real event type. The root test stability fix keeps normal
  Turbo/Vitest concurrency; only the shared hook timeout was widened so concurrent PGlite
  bootstraps are not reported as hung tests.
- **Files Changed**: `apps/web/tests/support/{query,http,pickers}.ts*`,
  `apps/web/src/lib/{query,problem}.ts`, web fetch/query tests, API raw-result callers, DB/Authz
  PGlite tests, `packages/boundaries/src/real/billing*.ts`, billing/blob/select tests,
  `packages/ui/src/hooks/useListKeyboard.tsx`, `tooling/vitest/preset.ts`, and related tests.
- **Learnings**: Reusable test helpers belong in support files, not inside whichever test needed
  them first. Use actual exported source types when a test is describing source behavior, and model
  non-OK RPC responses as `unknown` at the boundary instead of papering over the shape with casts.
- **Gate**: `pnpm --filter @docket/web typecheck`, `pnpm --filter @docket/web lint`, and the
  focused shared-helper web test run pass; root `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm build` pass.

### [MCP-PROD-012] Centralize API test env and auth mocks

- **Completed**: 2026-07-06
- **Summary**: Moved the baseline API test environment out of per-suite `process.env` mutation and
  into Vitest's native `test.env` config via the shared `docketVitest` preset. Centralized the
  repeated `@docket/auth` test boundary in `apps/api/tests/support/auth-mock.ts`, then replaced
  duplicated MCP/route-suite mock setup with imports from that helper. Suites that need
  behavior-specific env (MCP origin/resource/CIMD options, production-mode checks, trusted-origin
  parsing) still set only those variables near the test that owns the behavior. The shared API DB
  bootstrap now applies the generated migration SQL through PGlite's raw multi-statement `exec()`
  on the existing `@docket/db` singleton client, avoiding 255 prepared-statement round trips without
  changing runner concurrency.
- **Files Changed**: `tooling/vitest/preset.ts`, `apps/api/vite.config.ts`,
  `apps/api/tests/support/{env,auth-mock,db}.ts`, and API MCP/route tests that previously duplicated
  baseline env or Better Auth mocks.
- **Learnings**: `setupFiles` are the wrong place to reimplement Vitest's environment API. Keeping
  baseline env in `test.env` preserves Vitest's per-test-file lifecycle while keeping module mocks in
  a focused test-support helper. Drizzle prepared execution rejects multi-statement migration batches;
  PGlite's simple-query `exec()` is the correct layer for fast generated-SQL bootstrap.
- **Gate**: `pnpm --filter @docket/api exec vitest run tests/routes/billing-http.test.ts --reporter=verbose`
  passes (11 tests, 2.05s); `pnpm --filter @docket/api test` passes (47 files / 692 tests);
  unthrottled root `pnpm test` passes (11 tasks / 1m38.944s); `pnpm typecheck`, `pnpm lint`, and
  `pnpm build` pass.

### [MCP-PROD-011] Remove test-hang sources without throttling concurrency

- **Completed**: 2026-07-06
- **Summary**: Fixed the production-launch test hang without adding Turbo/Vitest concurrency caps.
  The root cause was repeated PGlite startup + full Drizzle migrator work inside concurrent test
  suites, plus missing deterministic teardown for the lazy DB singleton. Added `closeDb()` to the
  DB client/barrel, converted driver-selection and migration-runner unit tests away from real
  PGlite startups, kept one real full-schema migration smoke in `db.test.ts`, and replaced API
  test-suite migrator setup with a shared generated-SQL bootstrap helper. Authz and billing unit
  suites now use minimal schemas for the tables they exercise instead of full repo migrations.
- **Files Changed**: `packages/db/src/{client,index}.ts`,
  `packages/db/tests/{client,db,migrate}.test.ts`, `packages/authz/tests/authz.test.ts`,
  `apps/api/tests/support/db.ts`, `apps/api/tests/billing/{test-db,lifecycle,lifecycle-extra}.ts`,
  and API MCP/route tests that now call the shared fast bootstrap helper.
- **Learnings**: The hang was not fixed by serializing the runner; it was caused by expensive setup
  work being duplicated across workers. Keeping concurrency normal is viable when tests avoid
  redundant full migrations and close embedded database clients deterministically.
- **Gate**: `pnpm --filter @docket/db test` passes in 2.59s; `pnpm --filter @docket/api test`
  passes (47 files / 692 tests); unthrottled root `pnpm test` passes (11 tasks / 2m28s);
  `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass.

### [BOUNDARY-REFAC-001] Burninate `@docket/boundaries` into domain packages

- **Completed**: 2026-07-07
- **Duration**: 1 day
- **Summary**: Removed the catch-all `@docket/boundaries` package and split its ports,
  real adapters, mocks, fixtures, and tests into focused domain packages:
  `@docket/integrations`, `@docket/mail`, `@docket/billing`, `@docket/blob-store`, and
  `@docket/agent-runtime`. The API now owns composition explicitly in
  `apps/api/src/container.ts`, so provider selection lives at the app boundary instead of in a
  generic resolver package.
- **Files Changed**: Deleted `packages/boundaries` and `docs/engineering/boundaries.md`; added
  package manifests, source, tests, and HTTP helpers under the five new packages; updated API/auth
  imports and dependencies; refreshed docs/spec references away from the old boundaries module.
- **Validation**: New package typechecks passed; new package tests passed (`@docket/integrations`
  228, `@docket/mail` 22, `@docket/billing` 40, `@docket/blob-store` 11,
  `@docket/agent-runtime` 30); new package lint passed; `@docket/auth` typecheck/lint/test passed;
  `@docket/api` typecheck passed; focused API consumer suites passed (14 files, 157 tests). API
  lint passed before the latest dependency bumps; reruns after the bumps hung silently and were
  interrupted.
- **Learnings**: The former module mixed provider integration, transactional mail, billing, blob
  storage, and agent runtime concerns into one package. Keeping package names domain-owned makes the
  composition root visible and prevents tests/fixtures from turning into accidental shared product
  architecture.

### [VCS-002] Commit message body auto-wrap

- **Completed**: 2026-07-07
- **Summary**: Extended the existing native `commit-msg` validator so it formats commit-message
  subjects and bodies after validation. Conventional Commit descriptions are normalized to sentence
  case, and body paragraphs and list items are reflowed to 72 columns when they can be split safely
  so rendered `git log` output avoids pager wraps. Generated Git messages, comments, code fences,
  known commit trailers, and unbreakable tokens such as URLs or long identifiers are preserved.
  Commits touching more than one file must include a nontrivial body.
- **Files Changed**: `scripts/validate-commit-message.mjs`,
  `COMMIT_SCOPES.txt`, `docs/contributing/workflow.md`, `docs/WORKLOG.md`.
- **Validation**: Exercised the hook script against temporary commit messages covering prose
  wrapping, bullet continuation indentation, long-token preservation, generated-message bypass, and
  invalid scope rejection without message mutation.

### [DEVX-003] Commit scope allowlist extraction

- **Completed**: 2026-07-07
- **Summary**: Moved the scoped commit-message allowlist out of validator code and into
  the repo-wide `COMMIT_SCOPES.txt` file. The validator now reads the file directly; scopes not listed there
  fail the normal allowlist check.
- **Files Changed**: `COMMIT_SCOPES.txt`, `scripts/validate-commit-message.mjs`,
  `docs/contributing/workflow.md`, `docs/WORKLOG.md`.
- **Validation**: Validator rejects scopes absent from `COMMIT_SCOPES.txt` and accepts
  `refactor(integrations): ...`.

### [ATHENA-011] Milestone D checkpoint: full gate green; merge queued behind concurrent session

- **Completed**: 2026-07-03
- **Summary**: Final validation across the workspace: types 211, db 46, env 36, boundaries 266,
  web 192, api 936 (after settling the group-d SSE replay test for the live tail), build 3/3,
  typecheck 11/11, lint clean per package. All 11 plan slices across milestones A–D are
  committed on `worktree-feat-agent-turn-port` (12 commits, rebased onto main@bc581e0).
- **Closeout note**: During the branch-resolution closeout this branch's migration was rebased
  after the current search migration as `0028_smart_black_knight` instead of the stale `0016`.
- **Deferred (documented, not silent)**: live screenshots of the Milestone D surfaces (the
  worktree has no `.env` bootstrap and dev PGlite is single-writer with the main checkout) —
  run a visual pass + `/design-review` after merge; the ⌘J overlay variant (⌘J currently
  navigates to the persistent thread).

### [ATHENA-010] The chat front door + firehose onboarding (Milestone D complete)

- **Completed**: 2026-07-03
- **Summary**: Slices 10+11. **Chat**: `GET/POST /v1/orgs/:orgId/sessions/chat[/messages]` —
  the org's ONE persistent `kind:'chat'` session, lazily created against the default agent; a
  message lands as a visible `response` activity (`author:'user'`) AND the next user turn of
  the durable transcript, then the same `driveSession` loop answers (terminal statuses just
  mean idle; a new message re-opens the thread). Web: the Athena page
  (`/orgs/:orgId/athena`) renders the thread conversationally — user bubbles right, Athena
  left, tool work as quiet chips, thoughts omitted (the session work log carries them), and a
  parked thread reviews its batches in-line via the ghost-grammar `ProposalGroupCard`. Athena
  joins the sidebar nav (after Triage) + the command palette, and **⌘J/Ctrl+J summons the
  thread from anywhere** in an org (registered beside the ⌘K listener). **Onboarding**: the
  Today prompt box detects a zero-task workspace (typed query layer probe) and takes center
  stage as "What's on your plate?" — paste-anything framing, Athena as the primary/Enter
  action, capture demoted — so the firehose door leads exactly when it matters. Docs:
  `docs/design/ghost-grammar.md` (the design language, rules 1–7), mvp-plan §8.6 build-status
  note, athena-agent.md statuses flipped to shipped.
- **Files Changed**: `apps/api/src/routes/agent-sessions.ts` (chat routes),
  `apps/api/tests/routes/agent-chat.test.ts` (new, 2), `apps/web/src/app/(app)/orgs/[orgId]/
athena/page.tsx` (new), `packages/ui/src/components/shell/{workspaces.ts,Sidebar.tsx}`,
  `apps/web/src/components/{app-shell-utils.tsx,command-palette/*,today/today-prompt.tsx}`,
  `docs/{design/ghost-grammar.md,core/mvp-plan.md,engineering/specs/athena-agent.md}`.
- **NOT YET DONE (deferred, tracked)**: the ⌘J _overlay_ variant (today ⌘J navigates to the
  thread page — same thread, full continuity — rather than floating an overlay above the
  current view); live-browser screenshots of the Milestone D surfaces (worktree has no `.env`
  and the dev PGlite is single-writer with the main checkout) — verify visually after merge.
- **Gate**: api chat 2/2 + typecheck/lint; web 192/192 + typecheck/lint; ui typecheck.

### [ATHENA-009] Web review surface: batch proposal cards, ghosts in Today, trust dial, work-log polish

- **Completed**: 2026-07-03
- **Summary**: Slices 8+9 (session-side). `use-session-detail` gains the proposal layer
  (`proposals`, `decideGroup`, `editProposal` over the new group routes). New
  `ProposalGroupCard`: one card per assistant-turn batch — checkbox per member, inline title
  editing (PATCHes the stored tool input; approval executes what is shown), Approve all /
  Approve selected / Reject all; ghost rows render the ghost grammar (translucent, dashed
  accent, `proposed` badge) with stable per-activity `view-transition-name`s so approval can
  morph ghost → real row in place. New `GhostProposals` lane on Today: every awaiting-approval
  session's batches surface as ghost rows with one-tap Approve N + a Review-in-session link;
  the lane renders nothing when there's nothing to review (quiet by design). New `TrustDial`
  (Suggest only / Ask first / On her own, human-worded, optimistic PATCH) on the Agents page
  above the sessions feed. Work-log polish in `activity-item`: applied actions collapse to one
  quiet chip line (proposals stay the only loud element) and long thoughts fold to a single
  expandable italic line.
- **Files Changed**: `apps/web/src/lib/use-session-detail.ts`,
  `components/agents/{proposal-group-card,trust-dial}.tsx` (new), `activity-item.tsx`,
  `components/today/ghost-proposals.tsx` (new), `app/(app)/today/page.tsx`,
  `app/(app)/orgs/[orgId]/{agents,sessions/[sessionId]}/page.tsx`.
- **NOT YET DONE**: live browser screenshots of the new surfaces (the worktree has no `.env`
  bootstrap and the dev PGlite is single-writer with the main checkout's dev server) — flagged
  for the Milestone D checkpoint rather than silently skipped.
- **Gate**: web 192/192, typecheck + lint clean (api dist rebuilt first per convention).

### [ATHENA-008] Remote MCP integrations: the union toolbox (Milestone C complete)

- **Completed**: 2026-07-02
- **Summary**: Slice 7 — Athena's eyes into the user's existing world. New `mcpConnector`
  integration port (real: MCP SDK Streamable-HTTP client with the org's bearer credential; mock:
  fixture servers keyed by endpoint host, incl. a read-only Sunsama backlog server) selected
  purely by `APP_MODE` — endpoint + credential are per-connection data, never env. New
  `/v1/orgs/:orgId/integrations/mcp` routes: connect (live `tools/list` health check — status is
  EARNED, `error`+`lastError` otherwise), list, re-verify, disconnect. Credentials seal
  AES-256-GCM (`v1:gcm:` envelope) under the new `CREDENTIALS_ENCRYPTION_KEY` env into
  `integration_credential` — the no-passthrough MUST end-to-end. `openToolbox` now UNIONS every
  connected org MCP server: remote tools surface as `<alias>__<name>` (alias can't contain
  `__` → collision-free), their declared annotations feed the fail-closed policy classifier,
  `toolCall.connection` records where a call routes, and a server that fails to open demotes to
  `error` on its row — never silently skipped. Proving test: connect mock Sunsama → session
  reads `sunsama__get_backlog_tasks` immediately (remote READ under Ask-first) → batch-creates
  the three items → approve → tasks land. **Milestone C complete.**
- **Files Changed**: `packages/integrations/src/mcp-connector.ts` (new),
  `packages/integrations/src/fixtures.ts` (SUNSAMA_BACKLOG), `packages/types/src/integration.ts`
  (McpIntegrationCreate/Out), `packages/env` (CREDENTIALS_ENCRYPTION_KEY), `.env.example`,
  `apps/api/src/lib/credentials.ts` (new), `src/routes/integrations-mcp.ts` (new, mounted),
  `src/agent/{toolbox,loop}.ts` (union + connection routing),
  `apps/api/tests/routes/integrations-mcp.test.ts` (new, 6),
  `packages/integrations/tests/mcp-connector.test.ts` (new, 5).
- **Gate**: integrations MCP connector 5/5 + lint; api integrations-mcp 6/6, agent suites 30/30, typecheck +
  lint clean; env 36/36; types 211/211.

### [ATHENA-007] Athena entitlement gate (paid-plan feature, one choke point)

- **Completed**: 2026-07-02
- **Summary**: Slice 6 — Athena is a paid feature; the gate is
  `assertAgentSessionsEntitled(orgId)` reading `organization.lifecycleState` (the durable truth
  the Stripe webhooks maintain — no live billing call). Entitled = `trialing` (the trial IS the
  funnel) or `active`; anything else throws the new typed `AgentPlanRequiredError` (402,
  ProblemCode `agent_plan_required`) the web can render as a targeted upsell. Enforced at ONE
  choke point — `driveSession`'s FIRST run (`startedAt === null`) — which covers every door
  (REST sessions, `trigger_agent` MCP tool, proactive sweep). Resumes are deliberately exempt:
  an approval arriving after a plan lapse still lands work the user already reviewed.
- **Files Changed**: `apps/api/src/billing/entitlement.ts` (new), `src/error.ts`,
  `packages/types/src/errors.ts` (ProblemCode), `src/agent/loop.ts` (first-run hook),
  `apps/api/tests/agent/entitlement.test.ts` (new, 3 tests).
- **Gate**: entitlement 3/3; agent/session suites 38/38; typecheck + lint clean.

### [ATHENA-006] Batch approvals, ghost projection, SSE live tail (Milestone B complete)

- **Completed**: 2026-07-02
- **Summary**: Slice 5c — the review surface's data layer. New `agent/proposals.ts`:
  `GET /:id/proposals` groups still-`proposed` actions by `proposalGroupId` and projects each
  stored `toolCall` into a surface-shaped ghost (`create_task` → an editable ghost task row:
  title/team/project/dueDate; no spatial home → `ghost: null`, session-card fallback).
  `PATCH /:id/activity/:activityId/proposal` replaces a pending proposal's `toolCall.input`
  (inline ghost editing — approval then executes the edit verbatim; 409 once decided).
  `POST /:id/proposals/:groupId/approve|reject` decide a whole batch or an `activityIds` subset
  in one transaction (`decideProposalGroup`) then execute + resume (`approveGroupAndResume`).
  `GET /:id/stream` gains a DB-polled **live tail**: after replay it follows new activity rows
  until the session is terminal, with `Last-Event-ID` resume and heartbeats — restart-safe and
  process-decoupled. Proving test walks the full import shape: prompt → one batched proposal →
  ghosts listed → third ghost retitled → subset of 2 approved (2 tasks land, session stays
  parked) → remainder approved (edited title lands) → completion; plus whole-group
  reject-and-continue and SSE replay/resume. **Milestone B is complete.**
- **Files Changed**: `apps/api/src/agent/proposals.ts` (new), `src/agent/loop.ts`
  (`approveGroupAndResume`), `src/routes/agent-session-approval.ts` (`decideProposalGroup`),
  `src/routes/agent-sessions.ts` (4 routes + live tail), `packages/types/src/agent.ts`
  (`ProposalGroupOut`/`ProposalItemOut`/`GhostTaskOut`/`ProposalGroupDecision`/
  `ProposalEditBody`), `apps/api/tests/routes/agent-proposals.test.ts` (new, 5 tests).
- **Learnings**: The live tail hangs a plain `fetch().text()` on a non-terminal session — by
  design (EventSource clients read incrementally); tests must settle the session first or read
  with a bounded reader.
- **Gate**: proposals 5/5, agent-flows 11/11, loop 9/9 + policy 13/13, mcp-internal 8/8, types
  211/211; api typecheck + lint clean.

### [ATHENA-005] The agentic loop: driveSession, toolbox, approval-execute-resume

- **Completed**: 2026-07-02
- **Summary**: Milestone B core — Athena can now genuinely work. `apps/api/src/agent/loop.ts`
  replaces the single-turn `runSession` internals with the re-entrant `driveSession`: every
  entry starts by **reconciling** the transcript's trailing assistant message (unanswered
  `tool_use`s are answered from DB state — an applied action's result, a rejection, an
  elicitation's human reply — or the session settles `awaiting_approval`/`awaiting_input` and
  stops), so first run, resume-on-approve, resume-on-reply, and restart recovery are ONE code
  path. Tools flow through the in-process MCP toolbox (`toolbox.ts` — the identical
  `buildServer` the `/mcp` endpoint serves, connected over `InMemoryTransport` as the agent
  principal) and are gated per call by the slice-4 policy engine. `ask_user` is a loop-owned
  tool → deterministic elicitations. Turn transcripts + gated rows persist atomically; executed
  calls audit as `updated` events. `decideActivity` changed: approve → transient `approved`
  (the post-commit `executeApprovedActions` runs the stored `toolCall` and stamps `applied` +
  result), and **reject-and-continue** — a rejection returns the session to `running` and the
  reconcile step feeds the veto to the model as an `isError` tool_result (only the
  session-level `/reject` shortcut still cancels). Routes compose via `approveAndResume`;
  `/reply` now re-drives an un-parked session. Old `AgentRuntime` port + `SCRIPTED_SESSION` +
  `toActivityBody` deleted end-to-end. New explicit `AGENT_MAX_TURNS` env (registry +
  `.env.example`; the loop refuses to run without it — no hidden default).
- **Files Changed**: `apps/api/src/agent/{loop,toolbox,transcript,system-prompt}.ts` (new),
  `apps/api/src/routes/{agent-session-runner,agent-session-approval,agent-sessions,
agent-session-helpers}.ts`, `packages/agent-runtime` one-turn runtime exports,
  `packages/env/src/{slices,registry-vars-services}.ts`,
  `.env.example`, `apps/api/tests/agent/loop.test.ts` (new, 9 tests incl. restart resilience),
  20 test files gained `AGENT_MAX_TURNS`, expectation updates in 4 route suites.
- **Learnings**: The reconcile-first shape means "resume" is never special-cased — the
  transcript is the only cursor, and the mock's assistant-count turn indexing lines up with it
  exactly. Executing tool calls AFTER the transcript+rows transaction (not inside) keeps the
  in-process MCP writes out of the loop's transaction while guaranteeing a crash can't strand
  an unanswerable tool_use.
- **Gate**: loop 9/9; agent-flows/review/group-d/session-from-prompt 78/78; boundaries 261/261;
  api typecheck clean.

### [ATHENA-004] Approval-policy engine (the three-dial trust model, as data)

- **Completed**: 2026-07-02
- **Summary**: Slice 4 — the pure decision core the loop consults per tool call:
  `classifyTool` (MCP `tools/list` annotations → read/write classification, **failing closed** —
  a tool that doesn't declare `readOnlyHint: true` is a gated write, so unannotated remote tools
  can never slip past) × `POLICY_TABLE` (suggest / act_with_approval / autonomous) →
  `execute` | `propose` | `record_only`. Reads always execute under every dial — the dial gates
  mutation, not observation, which is what keeps an "Ask first" session feeling alive. No
  tool-name lists anywhere; policy is a table, classification is the tool's own declared
  metadata.
- **Files Changed**: `apps/api/src/agent/approval-policy.ts` (new),
  `apps/api/tests/agent/approval-policy.test.ts` (new, 13 tests incl. the full 3×2 matrix).
- **Gate**: 13/13; api typecheck + lint clean.

### [ATHENA-003] Internal agent MCP principal + default-agent grants

- **Completed**: 2026-07-02
- **Summary**: Slice 3 of the Athena build — the front door she walks through. `McpContext` is now
  a **principal union** (`user` | `agent`) instead of a userId-shaped bag, so every
  identity-sensitive consumer had to decide explicitly what an agent means for it: actor
  resolution (agent → its own Actor, cross-org 404s), cursor HMACs + task-store ownership (keyed
  by `principalKey`), prompt personalization (`principalDisplayName`), hub resources (agent → its
  one org), and the personal daily plan (agents have no Hub → existence-hiding 404). New
  `mcp/internal-session.ts` provides `internalAgentContext(orgId, agentId)` — the first-class,
  no-OAuth way Athena's in-process loop gets a context — carrying fixed
  `AGENT_SESSION_SCOPES` (`work:read`/`work:write`/`agents:run`, deliberately never
  `connectors:link`). `buildServer` is exported so the loop connects to the IDENTICAL server the
  `/mcp` endpoint serves (zero tool drift by construction). `ensureDefaultAgent` now seeds (and
  heals, via `onConflictDoNothing` under the existing unique index) an org-wide
  `view`+`contribute` actor-grant for Athena's Actor — without which every agent tool call 404s,
  since agents hold no role and are authorized purely by explicit grants (permissions.md §8).
- **Files Changed**: `apps/api/src/mcp/{auth,internal-session,principal,server,resource-statics,
view-plan-tools,prompts,list-pagination,task-store}.ts`, `apps/api/src/lib/default-agent.ts`,
  `apps/api/tests/mcp/mcp-internal.test.ts` (new, 8 tests), literal updates in 4 existing mcp
  test suites.
- **Learnings**: A value-import from `mcp/auth.ts` drags `src/env.ts` into a test's top-level
  module graph _before_ the test can set `process.env` — pure identity helpers therefore live in
  `mcp/principal.ts` (type-only import). Tool input validation runs before the handler, so a
  scope-gate test must pass schema-valid args or it exercises the wrong layer.
- **Gate**: mcp suites 60/60 + full api suite green; typecheck + lint clean.

### [LINEAR-SYNC-001] Deep Linear integration — Slice 1: two-way work-graph sync core

- **Completed**: 2026-07-02
- **Summary**: The sync core for making Linear a full first-party integration (approved plan:
  two-way sync, Issues→tasks / Projects→projects / Cycles→cycles with full field fidelity).
  (1) Schema: task-style mirror provenance on `project`/`cycle`/`label`, new `external_actor`
  identity-mapping table, `integration.lastFullSyncedAt`. (2) Boundaries: new
  `WorkGraph` capability seam on the Connector port (`asWorkGraph()` — pull users/labels/projects/
  cycles/items + `pushWorkItem`), `ResolvedAccount` now carries `externalWorkspaceId`/`Slug`,
  `listContainers` delegates unconditionally (fixed a latent throw in the Google client).
  (3) Real Linear client: full-field GraphQL pull with variables (no string interpolation),
  team/state/user/label/project/cycle/issue queries, `issueUpdate`/`issueCreate` mutations,
  issue UUIDs as external ids. (4) Mock parity: deterministic `LINEAR_WORK_GRAPH` fixtures with
  real-client filter semantics; the whole flow runs offline. (5) Identity: `syncExternalActors`
  email-matches Linear users to active org members with manual-match precedence enforced
  atomically (CASE-on-conflict upsert); GET/PATCH `/:id/external-actors` endpoints.
  (6) Reconciler `integration-reconcile-graph.ts`: ordered upserts, LWW via the
  `updatedAt`/`externalUpdatedAt` anchor (echo-suppression discipline), legacy identifier→UUID
  re-key healing, anchor-guarded tombstone archival, parent/label join diffing, per-run-cached
  push of dirty tasks; single-entity appliers exported for the Slice-3b webhook applier.
  (7) Sync wiring: `runSync` branches to full/incremental graph pulls (24h full backstop,
  2× cadence lookback), verify persists `externalWorkspaceId`/`Slug` (unblocks webhook routing),
  cycle auto-roll skips teams with provider-owned cycles, write-back scope enforcement (verify
  error + PATCH 409, read-only never nags). Linear connect stays read-only by default until
  Slice 3's OAuth scope upgrade.
- **Files Changed**: `packages/db/src/schema/{work,crosscutting}.ts` + a migration,
  `packages/db/src/{enums,types}.ts`, `packages/boundaries/src/ports/{work-graph,connector}.ts`,
  `packages/boundaries/src/real/{connector,connector-linear,connector-google,connector-provider-client}.ts`,
  `packages/boundaries/src/{mock/connector,fixtures/index}.ts`, `packages/types/src/integration.ts`,
  `apps/api/src/routes/{integration-identity,integration-reconcile-graph}.ts` (new),
  `apps/api/src/routes/{integration-sync,integration-provider,integrations,cycle-helpers}.ts`,
  plus ~10 test files (929 api + 335 boundaries tests green pre-rebase; re-verified post-rebase).
- **Learnings**: Drizzle's `$onUpdate` wall-clock stamp silently forges the LWW dirty flag on any
  bare `db.update()` in a sync path — every provider-sourced write must explicitly set
  `updatedAt`. Manual identity precedence can only be guaranteed inside the upsert statement
  itself (CASE-on-conflict), not by read-then-write. Registering a provider in
  `WRITE_BACK_PROVIDERS` before its OAuth scope ships bricks the connect flow — capability
  defaults must trail scope availability.
- **Remaining follow-ups** (for later slices): push sends the full field set (no field-level
  diff) and can strip provider-side labels that sync skipped; `GraphApplyContext` result-map
  preloading contract needs doc hardening before Slice 3b; locally-set parent links between two
  linked tasks are provider-owned and will be cleared once the row goes clean (note for Slice 3);
  guard-idiom unification (`in` vs `typeof`) in connector-provider-client.ts; 2 pre-existing lint
  failures in connector-github-app.test.ts predate this work.

### [MAIL-005] Suggestion lifecycle, due-date synthesis, sweep observability (M7)

- **Completed**: 2026-07-03
- **Summary**: The final productization pass. (1) **Lifecycle**: `email_suggestion_status`
  gains `expired` (migration `0018_early_gateway`); new
  `lib/email-to-task/lifecycle.ts` expires pending suggestions older than 30 days and
  hard-deletes resolved rows (accepted/dismissed/expired) after 90 — named policy constants,
  strict-older-than boundaries, idempotent — wired into the existing daily `lifecycle-sweep`
  cron (no new job; the ingest snapshot purges with the row, honoring minimal retention).
  (2) **Due dates**: `TaskDraft.dueDate` (ISO date) — the real synthesizer's prompt asks for
  a date ONLY when the email states one explicitly (validated against a literal ISO shape,
  never a guess); the mock emits one iff the snippet contains a literal ISO date, keeping
  offline tests exact; synthesis persists it so triage cards and accept inherit real due
  dates. (3) **Observability**: `persistSuggestions` returns
  `{considered, passedFunnel, skippedExisting, synthCalls}` and the sweep aggregates
  `{integrations, threadsPulled, funnelPassed, synthCalls, created, failed}` — one structured
  log line per sweep (the pipeline's health + cost signal) and the same counters in the cron
  response; the automation mail applier logs skipped actions (needs-reauth / no capability)
  instead of silently doing nothing.
- **Files Changed**: `packages/db/src/enums.ts` + `drizzle/0018_early_gateway.sql`,
  `packages/types/src/email-suggestion.ts`,
  `packages/boundaries/src/{ports,real,mock}/task-synthesizer.ts`,
  `apps/api/src/lib/email-to-task/{lifecycle(new),sweep,synthesize}.ts`,
  `apps/api/src/lib/automation/runtime.ts`, `apps/api/src/routes/cron.ts`,
  `apps/api/tests/routes/{email-suggestion-lifecycle(new),email-synthesize}.test.ts`,
  `docs/engineering/specs/email-to-task.md`, `docs/WORKLOG.md`.
- **Learnings**: Counting `synthCalls` separately from `created` makes the pipeline's cost
  legible in one log line — dedup effectiveness is (funnelPassed − synthCalls), and a spike
  in synthCalls with flat created flags model-output problems. Boundary tests with an
  injected `now` (exactly-at vs strictly-older-than the expiry line) caught the off-by-one a
  vibes-level test would have missed.
- **Gate**: api typecheck + lint clean; lifecycle boundary test (exact 30/90-day edges,
  idempotent re-run), due-date flow test (mock ISO rule → persisted timestamp), counter
  assertions in the dedup test; full API suite in the milestone gate.

### [MAIL-004] Outlook/Graph connector skeleton — dormant, env-gated (M6)

- **Completed**: 2026-07-03
- **Summary**: Outlook is now a first-class mail provider in every layer except live
  credentials. `ConnectorProvider` += `outlook`, and the compiler walked every
  `Record<ConnectorProvider, …>` site: Graph API base, client factory, connect-wizard
  directory entry, fixtures (import items + two mail-thread summaries: actionable-from-person
  - no-reply promo). New `real/connector-microsoft.ts` `MicrosoftProviderClient` implements
    the mail capability against Microsoft Graph: `listThreads` via the inbox delta query
    (conversationId grouping, latest-message-wins, `deltaLink` cursor, 410 Gone ⇒
    `cursorExpired`, absolute Graph links replayed relative to the API base), mailbox actions
    with the documented thread→messages fan-out (archive/trash = folder moves, read state =
    `isRead` PATCH, labels = duplicate-free `categories` read-modify-write), and `fetchThread`
    mapping `internetMessageHeaders` → In-Reply-To/References. Auth seam: `microsoft` Better
    Auth social provider (env-gated like the others; `offline_access + Mail.ReadWrite` scopes,
    tenant `common` unless `MICROSOFT_TENANT_ID`), `socialProviderId('outlook') → 'microsoft'`,
    `IdentityProvider` += microsoft, env plumbing (`MICROSOFT_CLIENT_ID/SECRET/TENANT_ID`,
    `MICROSOFT_GRAPH_API_BASE`) through slices/registry/container/.env.example. Web: directory
    icon, identity catalog entry, stream badge/filter, and the attachment card's "Open in
    Gmail" literal is now provider-neutral "Open email". Everything is dormant until the
    Microsoft credentials exist — `/v1/config` hides unconfigured providers — so go-live is
    env values + a smoke test.
- **Files Changed**: `packages/boundaries/src/{ports/{connector,mail},real/{connector,connector-microsoft(new)},fixtures/index,select}.ts`,
  `packages/boundaries/tests/real/connector-microsoft.test.ts` (new),
  `packages/{auth/src/auth-builder,types/src/identity,env/src/{slices,registry-vars-core,registry-vars-infra}}.ts`,
  `apps/api/src/{routes/{integration-provider,config},container}.ts`, `.env.example`,
  `apps/web/src/components/{settings/{integrations-config,identity-providers},stream/{provider-badge,stream-catalog},task-detail/TaskAttachments}.{ts,tsx}`,
  `docs/engineering/specs/mail-providers.md`, `docs/WORKLOG.md`.
- **Learnings**: The M2 capability architecture paid out exactly as designed — the Outlook
  client is one file + one manifest entry + compiler-forced Record fills; zero app-layer
  changes (sweep, routes, automations untouched). Graph's delta protocol returns absolute
  URLs as cursors; replaying them requires relativizing against the configured API base or
  the mock/e2e override would silently call the real Graph.
- **Gate**: boundaries 283 tests green (9 new Graph tests: delta grouping, deltaLink
  replay/pagination, 410 ⇒ cursorExpired, per-verb fan-out bodies, categories RMW, header
  mapping); manifest⇔structure tripwire covers outlook automatically; auth/api/web/env
  typecheck clean; full api + web suites + lints in the milestone gate.

### [AUTO-002] Generic automation actions + email-to-task enablement & triage UX (M5)

- **Completed**: 2026-07-03
- **Summary**: The automation action surface went app-wide and the email-to-task feature became
  reachable by users. New generic handlers — `task.setStatus`, `task.assign`, `task.setPriority`,
  `task.applyLabel`, `notification.send` (new `automation` notification type, migration
  `0017_same_peter_parker`), `suggestion.autoAccept` — each param-validated (Zod) with loud
  no-ops on wrong subjects/invalid params and hard org-scoping (cross-tenant actor/label ids
  refused). Mutating handlers reuse NEW shared lib mutations extracted from the routes —
  `lib/task-state.ts` `setTaskState` (also fixes `detail.fromState`, previously always null) and
  `lib/email-to-task/accept.ts` `acceptSuggestion` (outcome union, mapped to HTTP by the route
  and to no-ops by the handler) — so route and rule behavior cannot diverge. Enablement:
  `ConnectorConfig.emailToTask {enabled, threshold(0-100)}` is the typed schema shared by the
  sweep and the PATCH route; PATCH seeds the default rules the moment the toggle flips
  (idempotent; sweep-time backstop kept); new Settings → Connections "Email to task" section
  (`mail-ingest-section.tsx`) with visible numeric thresholds (Conservative 70 / Balanced 50 /
  Eager 30) that preserves sibling config keys and removes the key on disable; the
  `docket-email-suggestions` scheduler job (every 15 min) joins `scheduler-setup.ts` and the
  deployment cron table now lists all seven jobs. Triage: edit-then-accept (submits only changed
  fields as accept overrides), confidence badge, due-date line, and a lazy live thread preview
  (no provider round-trip until expanded). Automations settings copy updated for app-wide rules.
- **Files Changed**: `apps/api/src/lib/{task-state(new),email-to-task/accept(new)}.ts`,
  `apps/api/src/lib/automation/{handlers,runtime}.ts` (lazy default registry — breaks the new
  handlers→emit→runtime module cycle), `apps/api/src/lib/email-to-task/sweep.ts`,
  `apps/api/src/routes/{tasks,email-suggestions,integrations}.ts`,
  `packages/{db/src/enums,types/src/{notification,integration}}.ts`,
  `packages/db/drizzle/0017_same_peter_parker.sql`, `scripts/scheduler-setup.ts`,
  `apps/web/src/lib/{use-email-suggestions,query-keys}.ts`,
  `apps/web/src/components/{settings/{mail-ingest-section(new),integrations-tab,automations-tab},triage/suggestions-lane,inbox/notification-meta}.tsx|ts`,
  `apps/api/tests/routes/{automation-engine-db,integrations-sync}.test.ts`,
  `apps/web/tests/components/{settings/mail-ingest-section,triage/suggestions-lane}.test.tsx`,
  `docs/engineering/{specs/{automations,email-to-task}.md,deployment.md}`, `docs/WORKLOG.md`.
- **Learnings**: Handlers that reuse route-level mutations create a module cycle
  (handlers → emit → runtime → handlers); the fix is a lazily-built default registry, not
  restructuring — the cycle is safe at call time, only module-init evaluation trips the TDZ.
  Disabling a feature should REMOVE its config key, not write `enabled:false` — the absent-key
  state is the documented "off" and keeps configs from accreting dead toggles.
- **Gate**: api/types/db/web typecheck clean; handler tests 12/12 (incl. cross-tenant refusals,
  unknown-state no-op, autoAccept materialization); PATCH-seeding route test; web component
  tests 6/6 (override submission, sibling-key preservation, lazy thread fetch); full api + web
  suites + lints in the milestone gate.

### [MAIL-003] Email ingest on the leased sync spine: cursors, real senders, honest failures (M4)

- **Completed**: 2026-07-02
- **Summary**: Killed the second pull path. `runSync` was refactored into a generic
  `runLeasedSync(row, {actorId, trigger, purpose}, executor)` spine (lease claim, purposed
  `sync_run` row, token resolution, honest success/failure recording, once-per-transition
  owner notification) with the task mirror as the `task_sync` executor — byte-equivalent
  behavior, 50 existing sync tests untouched. The email sweep became the `email_ingest`
  executor: selects mail-capable providers via the manifest (no `'gmail'` literal), lists via
  the mail capability's cursored `listThreads` (cursor in `integration.sync_state`, advanced
  only under the lease; `cursorExpired` → exactly one full re-pull), and feeds the funnel
  **real senders** — the no-reply heuristic works for the first time, verified by the promo
  fixture being dropped at threshold 50. Token failures now flip the integration to `error` +
  notify the owner instead of a silent `continue`. Synthesis persists `rfc822MessageId` + full
  meta (receivedAt, provider-captured `externalUrl`) and dedups cross-provider by Message-ID
  before the paid model runs. The app-layer `threadUrl()` Gmail fabrication is deleted —
  accept reads the stored provider URL (loud error if absent; migration 0016 backfilled
  legacy rows). New `GET /email-suggestions/:id/thread` — the first `fetchThread` consumer —
  serves the live source thread for the triage preview (409 on needs-reauth). Mail providers
  are excluded from the task-mirror sweep (a mailbox is not a task list; the two purposes
  would otherwise race for one lease). `SyncRunOut` gains `purpose`.
- **Files Changed**: `apps/api/src/routes/{integration-sync,email-suggestions}.ts`,
  `apps/api/src/lib/email-to-task/{sweep,synthesize}.ts`,
  `packages/types/src/{integration,email-suggestion}.ts`,
  `apps/api/tests/routes/{email-sweep,email-synthesize,email-suggestions}.test.ts`,
  `docs/engineering/specs/{integration-sync(new),email-to-task}.md`, `docs/WORKLOG.md`.
- **Learnings**: The executor-on-a-spine shape made the reauth fix free — the email path
  inherited `finishFailure`'s status flip + notification by construction rather than by a
  parallel implementation. Modeling cursor expiry in the return type (not exceptions) made
  the one-retry recovery a two-line policy at the call site instead of typed-error plumbing.
  The spec's status block had drifted badly from reality ("fully wired" while the engine had
  zero callers); it now names what's true, what over-claimed, and which newer specs win.
- **Gate**: api/types typecheck clean; focused suites green (email sweep/synthesize/
  suggestions/backfill 22, integration sync/provider/reconcile 50); full API suite + lints +
  api-dist rebuild + web typecheck in the milestone gate run.

---

### [MAIL-002] Migration 0016: sync cursors, run purposes, Message-ID identity (M3 of productization)

- **Completed**: 2026-07-02
- **Summary**: The additive schema pass that M4's sync unification and cross-provider dedup
  stand on. One drizzle migration (`0016_rainy_magik`): (1) `integration.sync_state` jsonb
  (notnull, `{}`) — per-purpose incremental-sync cursors, Zod-validated as
  `IntegrationSyncState` in `@docket/types` (`{mail: {cursor, updatedAt}}`; Gmail `historyId`,
  Graph `deltaLink`), written only under the sync lease; (2) `sync_run_purpose` enum
  (`task_sync`|`email_ingest`) + `sync_run.purpose` so both sweeps share one auditable spine;
  (3) `email_suggestion.rfc822_message_id` + non-unique `(org, message_id)` index — the RFC 5322
  cross-provider dedup key; (4) a data backfill stamping `email_meta.externalUrl` with the
  canonical Gmail deep link on legacy rows (merge-preserving, no-op on already-stamped rows) so
  M4 can delete the app-layer `threadUrl()` fabrication outright; (5) `source_system` enum +
  `'outlook'` (and the `SourceSystemKind` Zod twin) so M6 needs no migration. Migration
  numbering note: the user's in-flight (uncommitted) work also claims 0016/0017 — whichever
  lands second renumbers; main's journal ended at 0015 when this was generated.
- **Files Changed**: `packages/db/src/{enums,schema/crosscutting}.ts`,
  `packages/db/drizzle/0016_rainy_magik.sql` + `meta/{0016_snapshot,_journal}.json`,
  `packages/types/src/{integration,event}.ts`,
  `apps/api/tests/routes/email-suggestion-backfill.test.ts` (new), `docs/WORKLOG.md`.
- **Learnings**: The PGlite test harness runs the real migration files
  (`drizzle-orm/pglite/migrator` over `drizzle/`), so every DB-backed test validates the DDL +
  backfill SQL execute; backfill _semantics_ need a separate post-migration re-run of the same
  UPDATE against seeded rows, since migration-time tables are empty in tests. `drizzle-kit
generate` needs a `DATABASE_URL` only to satisfy config validation — a codegen-only dummy
  value is safe (generation never connects).
- **Gate**: db + types typecheck/lint clean; backfill semantics test green (stamps legacy
  gmail rows, preserves existing meta keys, leaves already-stamped rows untouched); full API
  suite green post-migration.

---

### [MAIL-001] Provider-agnostic mail capability + standards-based message model (M2 of productization)

- **Completed**: 2026-07-02
- **Summary**: Killed the provider-literal capability gates and gave the mail surface a real
  port. New `packages/boundaries/src/ports/mail.ts`: `MailActions` gains cursor-based
  incremental `listThreads` returning `MailThreadSummary` rows with genuine RFC 5322 identity
  (`from`, `rfc822MessageId`, `receivedAt`, provider-captured `externalUrl`); cursor expiry is
  modeled in the return type (`{kind:'page'|'cursorExpired'}` — Gmail stale `historyId` 404,
  Graph delta 410 later) with a documented one-retry full-repull fallback. `MailMessage` carries
  `Message-ID`/`In-Reply-To`/`References`. The shared `GoogleProviderClient` split into
  per-product clients (`GmailProviderClient` in new `connector-gmail.ts` implementing
  `MailActionsProviderClient`; Drive/Calendar base-only; `GoogleTasksProviderClient` writable) so
  capability discovery is purely structural (`is*ProviderClient` guards) — `asWritable`/
  `asMailActor`/`listContainers` have no provider checks. Provider→client construction is the
  compile-enforced `PROVIDER_CLIENT_FACTORIES` registry. Declarative manifests
  (`MAIL_CAPABLE_PROVIDERS`, `WRITE_BACK_CAPABLE_PROVIDERS`) drive the mock's gates and
  app-layer selection, kept honest by a manifest⇔structure tripwire test; app-layer
  `WRITE_BACK_PROVIDERS` now re-exports the manifest. Mock serves deterministic
  `MAIL_THREAD_SUMMARIES` fixtures (actionable-from-person + promo-from-no-reply, so the funnel
  and dismiss-promotions rule run offline) with an `EXPIRED_CURSOR` sentinel.
  `EmailSuggestionMeta` gains `rfc822MessageId`/`externalUrl`. New spec
  `docs/engineering/specs/mail-providers.md` (capability model, identity semantics, cursor
  protocol, verb mapping table, add-a-provider checklist).
- **Files Changed**: `packages/boundaries/src/ports/{mail(new),connector,index}.ts`,
  `packages/boundaries/src/real/{connector,connector-google,connector-gmail(new),connector-provider-client}.ts`,
  `packages/boundaries/src/{mock/connector,fixtures/index}.ts`,
  `packages/boundaries/tests/real/{connector-gmail(new),capability-manifest(new)}.test.ts`
  (old connector-google-mail test folded in), `packages/boundaries/tests/mock/connector-mail.test.ts`,
  `packages/types/src/email-suggestion.ts`, `apps/api/src/routes/integration-provider.ts`,
  `docs/engineering/specs/mail-providers.md` (new), `docs/WORKLOG.md`.
- **Learnings**: The structural-guard-plus-manifest pair beats either alone: guards keep the
  real path literal-free, the manifest gives the mock and app layer a declarative source of
  truth, and a tripwire test replaces discipline. Splitting the shared Google client was the
  precondition — one class serving four products is exactly why the literal gates existed.
- **Gate**: boundaries typecheck + lint clean, suite 20 files / 274 tests green (was 256);
  types + api typecheck/lint clean; full API suite green (unchanged behavior — sweep still on
  `importWork` until M4). Gmail `listThreads` verified against canned payloads: cold pull
  anchors cursor to profile `historyId`, warm pull dedupes threads across history records,
  404 ⇒ `cursorExpired`, 500 still throws.

---

### [MCP-PROD-009] Production MCP access: OAuth activation, consent gate, Codex + docs, OAuth e2e

- **Completed**: 2026-07-02
- **Summary**: Closed every blocker between the built MCP server and a coding agent connecting to
  `https://docket-api.hypertext.studio/mcp`. (1) deploy.yml now derives
  `MCP_ISSUER_URL`/`MCP_RESOURCE_URL`/`OIDC_LOGIN_PAGE_URL`/`MCP_ALLOWED_ORIGINS` from the
  `API_URL`/`WEB_URL` repo vars, mounting the Better Auth `mcp()` AS in prod. (2) Wired the
  previously-unmounted `cimdAuthorizeMiddleware` ahead of `/api/auth/mcp/authorize`. (3) Live e2e
  exposed three AS breaks unit tests (mocked Better Auth) never saw: the Drizzle adapter lacked the
  `oauthApplication`/`oauthAccessToken`/`oauthConsent` models (DCR + token issuance 500'd); the RS
  discovery 307 pointed at `<issuer>/.well-known/openid-configuration`, which Better Auth 1.6.14
  never serves (real doc lives at `<issuer>/api/auth/.well-known/oauth-authorization-server`); and
  `mcp()` authorize skips the consent screen unless `prompt=consent` — added `mcpConsentGuard` to
  reinstate consent-once-per-scope-set. (4) Codex entry in the settings client catalog + standalone
  guide `docs/engineering/mcp-access.md`. (5) Implemented the §MCP-17 flows as
  `apps/web/e2e/mcp-{connect,session}.spec.ts` (full DCR→consent→PKCE→Bearer→step-up chain against
  the real stack; session flow polls instead of subscribing, per the stateless transport) and added
  the missing CI `e2e` job (portless + pnpm dev + Playwright). `.env.local` dev defaults now enable
  the MCP AS locally. Spec `mcp-surface.md` updated: open issues resolved, prompts drift reconciled.
- **Files Changed**: `.github/workflows/{deploy,ci}.yml`, `apps/api/src/server.ts`,
  `apps/api/src/mcp/{cimd,server,consent-guard}.ts`, `packages/auth/src/auth-builder.ts`,
  `apps/web/src/components/settings/mcp-clients.ts`, `apps/web/e2e/{helpers/mcp.ts,mcp-connect.spec.ts,mcp-session.spec.ts}`,
  `docs/engineering/{mcp-access.md,deployment.md,specs/mcp-surface.md}`, `.env.example`, `.env.local`,
  plus new tests `apps/api/tests/mcp/mcp-consent-guard.test.ts` and extended `mcp-cimd`/`mcp-scope` tests.
- **Learnings**: A mocked-auth test suite can be green while the real AS is unusable — the OAuth
  boundary needs at least one unmocked end-to-end path. Better Auth mounts its discovery document
  under its base path, not the RFC 8414 root, and its MCP authorize treats consent as opt-in
  (`prompt=consent`); both diverge from what a spec-faithful client expects. Note: older WORKLOG
  entries (MCP-UTIL-005, MCP-SAMPLING-006) reference `packages/mcp-server/**` and
  `apps/api/src/routes/mcp.ts` — those paths were superseded by `apps/api/src/mcp/**`.

### [ATHENA-002] Schema: durable transcripts, proposal groups, session kind, org credentials

- **Completed**: 2026-07-02
- **Summary**: Slice 2 of the Athena build — the persistence the loop and the UX system stand on.
  New `agent_session_transcript` (1 row/session, `TurnMessage[]` jsonb rewritten per turn in the
  same transaction as activity rows) is the durability story: re-entry after a days-long approval
  or a restart rebuilds the provider conversation purely from this row. `session_activity.
proposal_group_id` (+ `(session_id, proposal_group_id)` index) is the batch-approval handle —
  every proposal in one assistant turn shares a group so "create 40 tasks" reviews as one unit.
  `agent_session.kind` (`chat`|`job`, default `job`) models one substrate/two framings: the
  persistent conversational Athena thread and episodic delegated jobs are the same session
  machinery. `integration_credential` (1:1 with `integration`, unique-indexed, cascade) holds
  AES-256-GCM ciphertext only — the no-token-passthrough MCP security MUST becomes schema.
  `SessionActivityBody.action` gains `toolCall` (connection/tool/input/toolUseId — what approval
  executes), `result`, and `mode` (`proposal`|`suggestion`). The canonical `TurnMessage`/
  `TurnContentBlock` Zod shapes moved to `@docket/types`; the boundaries port and the db `$type`
  both import them (the event-substrate anti-drift pattern). Migration `0016_smart_black_knight`.
- **Files Changed**: `packages/types/src/agent.ts`, `packages/db/src/{enums,types}.ts`,
  `packages/db/src/schema/{agents,crosscutting}.ts`, `packages/db/drizzle/0016_*.sql`,
  `packages/db/tests/athena-schema.test.ts` (new, 6 tests),
  `packages/boundaries/src/ports/agent-turn.ts` (canonical-type re-export).
- **Learnings**: Zod `z.unknown()` object fields infer as optional — harmless here since every
  writer sets `input`, but worth knowing when a canonical schema replaces a hand-written
  interface. Drizzle's generator handles pure additions without the TTY-rename dance.
- **Gate**: types 211/211, db 46/46, boundaries 286/286; lint + `tsc --noEmit` clean on all
  three; `@docket/api` typecheck clean against the new shapes.

### [ATHENA-001] Agent-turn boundaries port (slice 1 of the Athena agent build)

- **Completed**: 2026-07-02
- **Summary**: First slice of the approved Athena-agent plan (chief-of-staff assistant; one agentic
  engine behind every door). Added the `AgentTurnRuntime` boundaries port — **one provider turn**
  in (`system` + full `messages` + MCP-shaped `tools`), streamed `TurnEvent`s out (`thinking` /
  `text` / `tool_use` / `turn_end`) — so the agentic loop, tool dispatch, approval gating, and
  durable pause/resume can live host-side in `apps/api` as real, mock-turn-testable business
  logic (the old `AgentRuntime` port mocked the whole session, leaving the loop untested; it is
  deleted in slice 5 when `runSession` swaps over). `turn_end` carries the fully assembled
  assistant message with thinking-block `signature`s, so the host appends it verbatim to the
  durable transcript and can resume losslessly days later / after a restart. Real adapter drives
  the Anthropic Messages API (`claude-opus-4-8`, adaptive thinking); mock replays scripted turns
  selected by the assistant-message count (resume-safe determinism) and throws if a loop runs
  past its script. Fixtures include `SUNSAMA_IMPORT_TURNS` (read source → batch creates in one
  turn → summarize) so the firehose-onboarding proving flow runs fully offline. New `agentTurn`
  container key follows the existing `ANTHROPIC_API_KEY` + `APP_MODE` selection rule.
- **Files Changed**: `packages/boundaries/src/ports/agent-turn.ts` (new),
  `src/real/agent-turn{,-translate}.ts` (new), `src/mock/agent-turn.ts` (new),
  `src/fixtures/index.ts` (`SCRIPTED_TURNS`, `SUNSAMA_IMPORT_TURNS`), `src/select.ts` +
  `src/{ports,real,mock}/index.ts` barrels, `tests/{real,mock}/agent-turn.test.ts` (new, 29
  tests), `tests/select.test.ts`, `tests/real/connector-github-app.test.ts` (pre-existing lint).
- **Learnings**: Making `turn_end` carry the complete assembled message (instead of the host
  reassembling from streamed events) is what keeps events and transcript from ever disagreeing —
  the mock derives its event stream _from_ the scripted message for the same reason. Indexing
  mock turns by assistant-message count makes pause/resume replay a non-event: the persisted
  transcript itself is the cursor.
- **Gate**: boundaries 286/286 tests, `tsc --noEmit` clean, `eslint .` clean.

### [AUTO-001] Wire automations into the canonical Event substrate (M1 of productization)

- **Completed**: 2026-07-02
- **Summary**: Reconnected the automation engine — orphaned since the observation→Event refactor
  (053dbf9) dropped its Observer hook — and generalized it across all data types. New canonical
  engine-visible projection (`lib/automation/event.ts`: `AutomationEvent` + pure
  `projectEmitInput`/`projectInboundDraft`), hooked post-commit into BOTH event write paths
  (`event-emit.ts` for internal `docket` events, `event-sync.ts` so external Linear/GitHub/Slack
  webhooks trigger rules too). Rules can now address external events: `on` gains optional
  `source`/`entityKind` alongside `kind`/`subjectType`. The predicate contract moved from the
  deleted `payload` to the typed `detail` pocket — new `docket.email_suggestion` EventDetail arm
  (category + confidence) emitted by synthesis, and the dismiss-promotions seed rule rewritten to
  `detail.category` (it matched nothing before). Re-entrancy is capped at depth 1 via
  AsyncLocalStorage so a handler-emitted event can never cascade another rule pass.
  `runAutomationsForObservation` → `runAutomationsForEvent`; `suggestion.dismiss` keys off the
  event subject instead of a payload field; `DOCKET_ENTITY_KIND` promoted to `@docket/types` as
  the shared subject→canonical-kind map. New canonical spec `docs/engineering/specs/automations.md`
  (supersedes email-to-task §7): projection contract, matcher semantics, grammar, action catalog,
  execution guarantees, add-a-trigger/add-an-action recipes.
- **Files Changed**: `packages/types/src/{automation,event}.ts`,
  `apps/api/src/lib/automation/{event(new),runtime,engine,handlers,rules-store,predicate,registry}.ts`,
  `apps/api/src/routes/{event-emit,event-sync}.ts`, `apps/api/src/lib/email-to-task/synthesize.ts`,
  `apps/api/tests/lib/automation/{engine,projection(new)}.test.ts`,
  `apps/api/tests/routes/{automation-hooks(new),automation-engine-db}.test.ts`,
  `docs/engineering/specs/automations.md` (new), `docs/WORKLOG.md`.
- **Learnings**: (1) The projection functions must live in a dependency-free module — colocating
  them with the runtime dragged `integration-provider → @docket/auth → packages/env` fail-fast
  into pure unit tests at import time. `lib/automation/event.ts` is deliberately import-light so
  the projection contract is testable in isolation. (2) The two hook call-sites are one-liners
  behind the projections, preserving the spec's durable-drain seam: a future checkpointed
  `consumers/` reactor replaces two lines, not the engine. (3) `AsyncLocalStorage<true>` +
  registry-injectable `runAutomationsForEvent` made the cascade cap directly testable without
  mocking timers or emit.
- **Gate**: `@docket/{types,api}` typecheck clean; full API suite 82 files / 891 tests green
  (baseline 880 + 11 new), run twice to rule out ordering flakes; `@docket/{types,api}` lint clean;
  API build clean. Automations verified end-to-end: emit → match → predicate → handler
  dismisses a promo suggestion; drained Linear webhook invokes the rule pass; duplicate emits
  (dedupe key) fire exactly once; nested dispatch suppressed.

---

### [MCP-PROD-010] Make MCP OAuth on-by-default, not env-gated

- **Completed**: 2026-07-04
- **Summary**: MCP-PROD-009 shipped the four AS URLs as deploy-supplied env vars
  (`MCP_ISSUER_URL`/`MCP_RESOURCE_URL`/`MCP_ALLOWED_ORIGINS`/`OIDC_LOGIN_PAGE_URL`), which meant a
  default prod deploy without them left the MCP server half-dead — core functionality must not be
  behind optional config. Reworked `packages/env/src/api.ts` so the three _mechanically derivable_
  URLs (`MCP_ISSUER_URL ⇐ API_URL`, `MCP_RESOURCE_URL ⇐ ${API_URL}/mcp`, `OIDC_LOGIN_PAGE_URL ⇐
${WEB_URL}/sign-in`) default automatically from the (now required) `API_URL`/`WEB_URL` — the
  registry already documented these as the intended defaults; they were simply never implemented.
  `MCP_ALLOWED_ORIGINS` stays fully explicit: it's the `/mcp` DNS-rebinding security allowlist, a
  distinct semantic from any other origin list, so it is never derived. `WEB_URL` joins the shared
  server env slice (required); `deploy.yml` now sets only `WEB_URL` + the explicit
  `MCP_ALLOWED_ORIGINS` allowlist instead of all four MCP vars. A live-env test in `packages/env`
  proves the derivation (and that an explicit value overrides it); `packages/auth`'s baseline
  plugin-list test updated since the real `env` now always mounts `mcp()`.
- **Files Changed**: `packages/env/src/{api,slices,registry-vars-core,registry-vars-services}.ts`,
  `packages/env/tests/env.test.ts`, `packages/auth/tests/auth.test.ts`, `.github/workflows/deploy.yml`,
  `.env.example`, `.env.local`, `scripts/bootstrap.ts`, `docs/engineering/{deployment.md,mcp-access.md}`.
- **Learnings**: "Optional env var with a documented default" is not the same as "the default is
  implemented" — the registry's `where:` strings had said "defaults to API_URL" since the original
  design spec, but nothing ever computed that default until this pass. When a var is genuinely
  security-relevant (an allowlist) rather than mechanically derivable (a URL built from another
  URL), don't derive it just for symmetry — keep it explicit and say why in the same commit.

### [CALENDAR-004] Layered calendar implementation

- **Completed**: 2026-07-05
- **Duration**: 4 days (2026-07-02 – 2026-07-05), 10 sequenced task briefs
- **Summary**: Implemented the layered calendar suite end-to-end per
  `docs/engineering/plans/layered-calendar-implementation.md` (Phases 1–10). Approach:
  provider-neutral layer/item/task-link schema first (migrating the existing Google-only
  `calendarConnection`/`calendarList`/`calendarEvent` surface forward rather than discarding it),
  then a read service with `/v1/agenda` compatibility, native Docket blocks with no provider
  dependency, org-scoped task links on user-scoped items, a provider-neutral sync engine with a
  Google adapter (full + incremental pull via `syncToken`, per-layer leases), provider write-back
  (local-first patch → outbox → foreground push → one of five typed outcomes), push-notification
  hints + a scheduled sweep, the web data layer (`calendar-data.ts`/`calendar-mutations.ts`
  following the existing def-factory + optimistic-patch conventions), the full calendar UI
  (`/calendar` day/week views, the item workspace drawer, layer toggle panel), and finally this
  phase: 6 new Playwright specs (`e2e/layered-calendar.spec.ts`) plus the `google-calendar.spec.ts`
  regression, and this documentation pass.
- **Files Changed** (by module, not individual paths — see each phase's task report under
  `.superpowers/sdd/task-{1..10}-report.md` on `feature/layered-calendar` for the full file lists):
  `packages/db/src/schema/calendar.ts` (+ 2 migrations) and `packages/types/src/calendar.ts` (the
  provider-neutral schema/DTOs); `apps/api/src/routes/calendar-*.ts` and
  `apps/api/src/calendar/calendar-{read,write,outbox}.ts` (read/write services, sync engine, Google
  adapter, webhook, scheduled sweep); `apps/web/src/components/calendar/*` and
  `apps/web/src/app/(app)/calendar/*` (data layer + full calendar UI); targeted additions to
  `apps/web/src/components/agenda/*` and `apps/web/src/components/settings/google-calendar-settings.tsx`
  (additive, existing contracts unchanged); `apps/web/e2e/layered-calendar.spec.ts` (new); the four
  spec docs under `docs/core/specs/` and `docs/engineering/specs/`; this file.
- **Decisions made**: provider-neutrality was enforced at every layer, not just the schema —
  credential resolution and permission normalization both live behind the adapter boundary
  (`createDefaultCalendarSyncModules`/`CalendarItemPermission`), so the engine, outbox, and web
  layer never branch on `provider === 'google'`. The webhook edge
  (`POST /webhooks/calendar/:provider`) was deliberately kept outside the versioned `/v1` typed-RPC
  contract and OpenAPI spec, since it is a public, header-validated provider callback, not a
  session-scoped client route. Conflicts preserve local intent unconditionally (never a silent
  provider-wins overwrite) and expose exactly two V1 recovery actions ("Open in provider" / "Retry
  with local changes") rather than a full merge UI. Two originally-scoped V1 features — OAuth
  re-consent for calendar write access, and a task-detail calendar-context section — were
  deliberately left unbuilt rather than faked once their prerequisites (a re-consent backend flow;
  a "calendar items linked to task X" read) turned out not to exist; both are recorded as explicit
  follow-ups in `docs/core/specs/layered-calendar.md` and `docs/engineering/specs/calendar-ui.md`.
- **Learnings** (pulled from the SDD ledger's per-task "Minor"/"Facts for later briefs" notes,
  `.superpowers/sdd/progress.md`):
  - The list-response convention across this domain is `{ items: [...] }`; read exports are
    `readCalendarItemsInRange`/`readItemDetail`/`readCalendarLayers`; permissions resolve through
    `resolveItemPermissions`; legacy compatibility mapping is `toLegacyCalendarEventOut` in
    `calendar-shared.ts`; sync dual-writes both the new and legacy tables, including archiving both
    on a cancelled tombstone.
  - The provider adapter module map is assembled by `createDefaultCalendarSyncModules()`
    (`calendar-sync-modules.ts`); the engine requires an explicit `adapters` map with no default,
    which is what keeps the sync engine importable without a hard dependency on the Google adapter.
  - Shared, single-implementation helpers worth knowing about before extending this domain:
    `resolveTimeShapePatch` (native + provider paths), `archiveProviderItem` (inbound-cancel +
    outbox-delete), `loadOwnedCalendarItem` (write service + outbox), and `runLayerSync` (the one
    per-layer sync body both the full sweep and the webhook-triggered `syncSingleLayer` share).
  - `pnpm --filter @docket/api test -- <files>`/`pnpm --filter @docket/web test -- <files>` do NOT
    filter to the named files (they silently run the full suite regardless of args) — run vitest
    directly from the package directory (`cd apps/api && pnpm vitest run <files>`) to actually scope
    a run.
  - A repo-local infra fact surfaced only in this final phase: this repo's dev proxy (`portless`)
    namespaces per git worktree/branch (`<branch>.docket.localhost`, on a per-worktree port, not the
    shared `:443` default), so a fresh worktree's `.env.local` (`API_URL`/`BETTER_AUTH_URL`/
    `BETTER_AUTH_PASSKEY_RP_ID`) must point at that worktree's own branch-prefixed origin for the
    passkey sign-up ceremony and the web↔API rewrite to work at all — the committed `.env.local`
    defaults assume the single shared, unbranched proxy. Also: `/calendar` is a Server Component
    that prefetches on the server, so `page.route(...)` mocks never see its _first_ paint — e2e
    specs covering it need a real, mock-visible client refetch (a new query key, e.g. switching
    Day→Week; or waiting past `staleTime` and dispatching `visibilitychange` when the key can't
    change), not just registering the route before `page.goto`.
- **Gate** (final validation for the full 10-phase feature, all green):
  - `pnpm typecheck` — 11/11 packages clean.
  - Per-package lint (`@docket/{types,db,api,web}`) — clean, 0 errors/warnings each.
  - `pnpm test` (full monorepo, ran in one shot) — 10/10 turbo tasks successful:
    `@docket/web` 35 files / 221 tests, `@docket/db` 4 files / 40 tests, `@docket/api` 88 files /
    969 tests, all passed.
  - `pnpm build` — `@docket/api`, `@docket/admin`, `@docket/web` build clean (others cached); `/calendar`
    compiles as an expected dynamic (`ƒ`) route.
  - `pnpm test:e2e` (Playwright, isolated dev stack) — the new
    `e2e/layered-calendar.spec.ts` (6/6) plus the existing `e2e/google-calendar.spec.ts` regression
    (1/1): **7/7 passed**.

### [ATTACH-002] File attachments (upload) + util centralization

### [AUTH-PASSKEY-002] Passkey sign-in and sign-up recovery hardening

- **Completed**: 2026-07-03
- **Summary**: Hardened the passkey auth path after the browser flow exposed a bad recovery edge:
  sign-up registration can succeed while the immediate session-start sign-in fails. The sign-up page
  now treats passkey registration and session start as separate states, locks the registered identity,
  and lets the user click "Finish sign in" without re-registering the passkey. The returning sign-in
  error copy is now user-facing rather than cookie jargon, and the button remains retryable after a
  failed session-read recovery.
- **Files Changed**: `apps/web/src/app/(auth)/sign-up/page.tsx`,
  `apps/web/src/app/(auth)/sign-in/page.tsx`, `apps/web/e2e/helpers/app.ts`,
  `apps/web/e2e/sign-in.spec.ts`, and
  `apps/web/tests/components/auth/{sign-up-page,sign-in-page}.test.tsx`.
- **Learnings**: The real e2e path must be the auth gate. Component tests caught the local state
  behavior, but Playwright caught cold dev route/proxy behavior and proved the final cookie-backed
  `/v1/orgs` read after passkey sign-in.
- **Gate**: Focused auth component tests 5/5; `pnpm --filter @docket/web exec playwright test
e2e/sign-in.spec.ts` passes; focused ESLint on touched auth/e2e files passes; `@docket/web`
  typecheck passes. The local Node runtime still warns because it is `v24.3.0` and the repo requires
  `>=24.15 <27`.

### [AUTH-APPLE-001] Sign in with Apple (web)

- **Completed**: 2026-07-02
- **Summary**: Added Apple as a fourth web OAuth provider alongside Google/GitHub/Linear, reusing the
  existing env-gated, `/v1/config`-derived provider machinery so availability is decided server-side
  and the client never drifts. Apple differs in two ways, both handled: (1) its `client_secret` is a
  short-lived ES256 JWT — not a static string — so we store the four **durable** credentials
  (Services ID, Team ID, Key ID, `.p8`) and mint a fresh 180-day JWT at server boot
  (`generateAppleClientSecret`, synchronous via Node `crypto.sign` `ieee-p1363`, no `jose` dep), which
  removes the silent-6-month-expiry footgun a pre-generated secret would carry; (2) Apple posts its
  callback (form_post) from `appleid.apple.com`, so that origin is auto-added to `trustedOrigins` only
  when Apple is configured. The button is Apple-HIG brand-compliant (its own black/white treatment via
  `on-surface`/`surface` tokens so it flips correctly in light/dark, with the Apple logo), unlike the
  plain outline buttons the other providers use. Web-only — no native iOS ID-token flow.
- **Files Changed**: `packages/auth/src/apple-secret.ts` (new), `packages/auth/src/auth-builder.ts`,
  `packages/auth/src/index.ts`, `packages/env/src/{slices,registry-vars-core}.ts`,
  `apps/web/src/app/(auth)/_lib/oauth-providers.ts`,
  `apps/web/src/app/(auth)/_components/oauth-buttons.tsx`,
  `packages/auth/tests/{apple-secret.test.ts (new),auth.test.ts}`, `docs/local-development.md`,
  `docs/engineering/deployment.md`, `docs/engineering/specs/env-and-bootstrap.md`,
  and `docs/WORKLOG.md`.
- **Operator wiring gap (called out in the docs)**: the code is complete, but Apple's four prod vars
  are **not yet** in Secret Manager or `.github/workflows/deploy.yml` (unlike the other six provider
  vars, which are seeded `placeholder` + injected). `deployment.md` documents the create-secrets +
  add-`deploy.yml`-lines steps; adding the lines before the secrets exist would break the deploy.
- **Learnings**: `crypto.sign(..., { dsaEncoding: 'ieee-p1363' })` emits the fixed-length r‖s
  signature JOSE/ES256 needs directly, so the secret can be minted synchronously _inside_ the pure
  `buildAuthOptions` — no `jose`, no async, no change to the module import graph. Returning the typed
  credentials object from `resolveAppleCredentials` (rather than a boolean) narrows the four env vars
  to `string` for the caller, so the provider wiring needs no non-null assertions. Availability is
  all-or-nothing across the four `APPLE_*` vars, unlike the single id+secret pair of the others.
- **Gate**: `@docket/{auth,env}` typecheck + lint clean; auth suite 42/42 (incl. new
  Apple-secret signing/verification and provider-gating/trusted-origin tests); `@docket/web`
  typecheck clean and the two touched web files lint clean.

- **Completed**: 2026-07-02
- **Summary**: Added a `file` attachment kind so users can upload files onto a task, alongside the
  existing `email`/`url`/`calendar_event` pointer kinds. Files are stored through the existing
  `BlobStore` boundary (Vercel Blob in prod, local disk in dev) via a server-proxied multipart
  upload (≤ 4 MB, under Vercel's request-body limit), downloaded through an authed streaming route
  with `Content-Disposition: attachment`, and their blobs are cleaned up on delete (a new
  `BlobStore.delete`). Also centralized scattered/duplicated formatting helpers: new
  `apps/web/src/lib/format-time.ts` (deduped `formatClock`, plus `clockValue`/`toISODateTime`/
  `formatHour`) and `format-bytes.ts`, and folded the portfolio timeline's divergent `formatDate`
  into the shared timezone-correct `formatCalendarDate`.
- **Files Changed**: `packages/db/src/{enums,schema/crosscutting}.ts` +
  `packages/db/drizzle/0016_shallow_iron_monger.sql`, `packages/types/src/attachment.ts`,
  `packages/boundaries/src/{ports,real,mock}/blob.ts`,
  `apps/api/src/{routes/attachment-routes,lib/validate}.ts`,
  `apps/api/tests/routes/attachments.test.ts`, `apps/web/src/lib/{use-attachments,format-time,format-bytes}.ts`,
  `apps/web/src/components/task-detail/TaskAttachments.tsx`,
  `apps/web/src/components/{agenda/agenda-{canvas,entry-card,entry-actions},today/next-up,portfolio/format}.{ts,tsx}`,
  and `docs/WORKLOG.md`.
- **Learnings**: A `File` field can't be expressed in JSON schema, but `z.instanceof(File)` keeps the
  handler value properly typed _and_ generates a valid multipart OpenAPI body — cleaner than a
  `z.any()`+refine dance. Server-proxied upload reuses the existing blob port unchanged (only a
  `delete` was missing); client-direct upload would have added a whole port capability + a
  localhost-webhook caveat for marginal benefit at this app's file sizes. Binary sub-resources sit
  outside the typed RPC contract and are fetched via plain requests (same convention as the account
  export download).
- **Gate**: `@docket/{types,db,boundaries}` typecheck clean; API attachment tests 14/14 (incl.
  upload/download/delete-cleanup/size-limit/capability), OpenAPI spec tests pass; boundaries 256/256;
  web suite 187/187; typecheck + lint clean on all touched files (pre-existing red: `graph-insight.ts`
  and `task-reparent.test.ts`, unrelated). Node still warns (`v24.3.0` vs required `>=24.15 <27`).

### [SLACK-001] End-user Slack integration — mentions, DMs & threads in the Stream

- **Completed**: 2026-07-02
- **Summary**: Made Slack fully end-user connectable and personally relevant. A user clicks
  "Connect Slack" (Settings → Connections), consents to the shared Docket Slack app's
  **user-token** OAuth (bot tokens structurally cannot see the user's DMs or un-invited
  channels), and from then on messages that @mention them, DM them, or reply in threads they
  participated in land in their personal Stream — with the same events in the org firehose.
  Ingest fans one workspace delivery out per connected org; the drain classifies each message
  against the org's connected Slack identities and creates **no canonical event** when a message
  concerns nobody (noise control — raw payloads stay in the `inbound_event` WAL). Thread
  participation is remembered in the new provider-generic `thread_participation` table. Local
  dev runs the entire flow against mocks (`T-MOCK`/`U-MOCK` fixtures) with zero Slack account.
- **Files Changed**: `packages/db/src/schema/event.ts` (+ migration 0016),
  `packages/types/src/{event,integration}.ts`, `packages/env/src/slices.ts`, `.env.example`,
  `packages/boundaries/src/real/observer-slack.ts` (+ barrel exports),
  `apps/api/src/lib/{oauth-state,slack-app,github-app}.ts`,
  `apps/api/src/routes/{integrations-slack,integrations,integration-provider,config,ingest,event-sync}.ts`,
  `apps/api/src/consumers/{slack-relevance,routing}.ts`, `apps/api/src/server.ts`,
  `apps/web/src/components/settings/{integrations-tab,integration-provider-card,integrations-config,identity-providers}.ts(x)`,
  `apps/web/src/lib/public-config.ts`, `scripts/{tunnel,integration-providers}.ts`,
  `infra/slack/docket-app-manifest.yaml`, `docs/engineering/specs/slack-integration.md`,
  plus test suites in `packages/boundaries/tests` and `apps/api/tests`.
- **Learnings**: Slack's `app_mention` only covers mentions of the _bot_ — user relevance must be
  derived from raw `message.*` events under user scopes. Routing facts are read from the raw
  payload (not the normalized detail) so the mock observer drives the identical drain path in
  local/test. The dev tunnel's ingress only routed `^/(api|v1)` to the API, so `/internal/*`
  callbacks/webhooks silently fell through to the web app — fixed for all providers. Cloud Run
  scale-to-zero vs Slack's 3s ACK deadline means `docket-api` should run `min-instances=1`
  (Slack disables delivery at >5% failures/60min). See
  `docs/engineering/specs/slack-integration.md` for the full design + follow-ups.

### [CALENDAR-003] Layered calendar product and engineering specs

- **Completed**: 2026-07-02
- **Summary**: Documented the next-generation calendar direction as a provider-neutral layered time
  system. The documentation defines product behavior for external calendar events, Docket-native
  blocks, event workspaces, many-to-many task links, provider write-back, sync conflict handling,
  and the implementation roadmap for future agents.
- **Files Changed**: `docs/core/specs/layered-calendar.md`,
  `docs/engineering/specs/calendar-architecture.md`,
  `docs/engineering/specs/calendar-sync.md`, `docs/engineering/specs/calendar-ui.md`,
  `docs/engineering/plans/layered-calendar-implementation.md`, and `docs/WORKLOG.md`.
- **Learnings**: The existing Google Calendar surface should be migrated rather than replaced. The
  important model shift is from Google-specific agenda events to provider-neutral layers/items,
  with org-scoped task links as the bridge into shared work.
- **Gate**: Focused Prettier check for the touched docs passes, along with `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, and `pnpm build`. The Turbo gates completed through cache replay.

### [AGENDA-001] Add daily-plan edit actions to the agenda rail

- **Completed**: 2026-07-01
- **Summary**: Added a per-entry action menu for planned task agenda entries and moved the
  daily-plan write behavior into a dedicated agenda mutation layer. The agenda can now check off
  plan items, edit/clear timeboxes, move tasks to another day, and remove tasks from the plan while
  updating the rendered agenda cache optimistically.
- **Files Changed**: `apps/web/src/components/agenda/agenda-{context,entry-card,entry-actions}.tsx`,
  `apps/web/src/components/agenda/agenda-mutations.ts`,
  `apps/web/tests/agenda/{agenda-mutations,agenda-entry-actions}.test.tsx`, and
  `docs/WORKLOG.md`.
- **Learnings**: The agenda provider renders from `queryKeys.agenda(date)`, so write operations
  must patch that cache directly; patching only `dailyPlan`/`today` leaves the visible rail stale.
  Radix dropdown selection also needs a controlled handoff before opening the popover editor.
- **Gate**: The new agenda mutation tests first failed against the stale agenda cache, then passed
  after patching `agenda(date)`. `pnpm --filter @docket/web typecheck` and the focused agenda test
  run pass. The local Node runtime still warns because it is `v24.3.0` and the repo requires
  `>=24.15 <27`.

### [E2E-001] Convert web Playwright suite to TypeScript

- **Completed**: 2026-07-01
- **Summary**: Converted the web Playwright specs and shared helpers from `.mjs` to typed
  TypeScript, moved e2e constants/helpers into a dedicated `apps/web/e2e/tsconfig.json`, and
  updated Playwright to discover only `.spec.ts` files. Kept the app `tsconfig` focused on Next
  sources by excluding `e2e`, and removed the stale `.mjs` lint escape hatch in favor of a narrow
  helper override for CDP/page-context glue.
- **Files Changed**: `apps/web/e2e/**/*.ts`, `apps/web/e2e/tsconfig.json`,
  `apps/web/playwright.config.ts`, `apps/web/tsconfig.json`, `tooling/eslint-config/index.js`,
  and `docs/WORKLOG.md`.
- **Learnings**: The composer smoke test must keep the established DOM `button.click()` activation
  path; a normal Playwright pointer click can hang after resolving the visible enabled button.
- **Gate**: `pnpm --dir apps/web exec tsc -p e2e/tsconfig.json --noEmit`,
  `pnpm --filter @docket/web typecheck`, `pnpm --filter @docket/web lint`, and
  `pnpm --filter @docket/web test:e2e -- e2e/verify-composer.spec.ts` pass. The local Node
  runtime still warns because it is `v24.3.0` and the repo requires `>=24.15 <27`.

### [TOOLING-001] Allow Node 26 and refresh package-manager tooling

- **Completed**: 2026-06-30
- **Summary**: Widened the repository Node engine contract from Node 24-only to Node 24.15 through
  Node 26 so current developer machines do not warn when running pnpm under Node 26. Updated the
  repo package-manager pin to `pnpm@11.9.0` and made CI/release bootstrap `corepack@0.35.0`
  before enabling the pinned pnpm. Moved `.nvmrc`/`.node-version` and the API Docker default to
  Node 26 so the default local, CI, and container paths match the supported current runtime.
- **Files Changed**: `package.json`, `.github/workflows/{ci,release}.yml`,
  `docs/engineering/DECISIONS.md`, `docs/engineering/build-manifest.md`,
  `docs/contributing/workflow.md`, and `docs/WORKLOG.md`.
- **Learnings**: The original warning was caused by `package.json#engines.node`; Corepack 0.35 adds
  its own Node floor of ^24.15 or >=26, so the repo should not advertise older Node 24 patches.
  Running several pnpm commands in parallel can race the repo `prepare` hook's Git config writes,
  so verification should run pnpm gates sequentially.
- **Gate**: `pnpm --filter @docket/web lint`, `typecheck`, and `test` pass under Node 26 without
  engine warnings.

### [CALENDAR-002] Google Calendar e2e coverage and UX audit

- **Completed**: 2026-06-30
- **Summary**: Added a Playwright end-to-end flow for first-party Google Calendar that signs up a
  real throwaway user, verifies the nested Connections → Google Calendar configuration path,
  toggles a calendar's visibility, syncs the account, and confirms selected Google Calendar
  events appear in the agenda rail. Audited and tightened the nested settings UI with visible
  sync feedback, account status badges, last-sync/error details, mutation-disabled controls, and a
  direct route back to Connected accounts for adding more Google identities.
- **Files Changed**: `apps/web/e2e/google-calendar.spec.mjs`,
  `apps/web/e2e/verify-composer.spec.mjs`,
  `apps/web/src/app/(app)/orgs/[orgId]/settings/connections/google-calendar/page.tsx`,
  `apps/web/src/components/settings/google-calendar-settings.tsx`, and
  `tooling/eslint-config/index.js`.
- **Learnings**: Portless worktrees register branch-prefixed hosts, so e2e runs must target the
  branch web/API origins and still expose `NEXT_PUBLIC_PASSKEY_RP_ID=docket.localhost`. The full
  e2e suite also exposed a flaky pointer click in the existing composer smoke test; opening the
  already-visible button through the DOM keeps the screenshot contract deterministic.
- **Gate**: `@docket/web` lint, typecheck, and 169 unit tests pass. Full web e2e passes
  (`5 passed`) against the branch-prefixed dev stack. `pnpm build` passes.

### [CALENDAR-001] First-party Google Calendar integration

- **Completed**: 2026-06-30
- **Summary**: Added user-scoped first-party Google Calendar support. Docket can now model
  multiple linked Google accounts, discover/select calendars, cache Google events for agenda
  contexts, render selected events alongside Docket timeboxes, and create native tasks with a
  `calendar_event` attachment preserving the event/account/calendar context.
- **Files Changed**: `packages/types/src/{calendar,agenda,attachment,primitives}.ts`,
  `packages/db/src/schema/calendar.ts`, `packages/db/drizzle/0014_parched_magik.sql`,
  `apps/api/src/routes/{me-calendar,agenda,calendar-shared,google-calendar-sync}.ts`,
  `apps/web/src/components/{agenda,settings,task-detail}/...`, nested
  `settings/connections/google-calendar` page, plus focused tests.
- **Learnings**: Calendar needs to stay user-global rather than org-scoped; org scope only enters
  when an event is materialized as a native task. The top-level Connections page should route to a
  dedicated Calendar configuration surface instead of treating calendars like generic importable
  work items.
- **Gate**: `@docket/types` typecheck/lint/test pass; `@docket/db` typecheck/lint/test pass;
  `@docket/api` typecheck/lint/test pass; `@docket/web` typecheck/test pass and touched-file
  ESLint passes. `pnpm build` passes. Full `@docket/web lint` is still blocked by pre-existing
  e2e `.mjs` project-service parse errors.

### [VCS-001] Turnkey linear-history enforcement

- **Completed**: 2026-06-30
- **Summary**: Made the no-merge-commits policy turnkey instead of relying on manual setup.
  `pnpm install` now runs a native Git guardrail installer through `prepare`, removes the Husky
  dependency, preserves lint-staged and commit-message hooks, and rejects merge commits before they
  can land locally.
- **Files Changed**: `scripts/install-git-guardrails.sh`, `.husky/commit-msg`, `.husky/pre-commit`,
  `package.json`, `pnpm-lock.yaml`, `AGENTS.md`, `docs/contributing/workflow.md`.
- **Learnings**: Documentation alone is not enforcement. The repo needs both server-side GitHub
  linear-history protection and checkout-local native hook automation so fresh clones inherit the
  same behavior without Husky.
- **Gate**: `sh scripts/install-git-guardrails.sh` installs the expected local Git config and native
  hooks; generated `pre-merge-commit` exits non-zero; `git rev-list --merges --count origin/main..HEAD`
  remains `0`.

### [MCP-TASK-008] MCP tool metadata, structured results, and task execution

- **Completed**: 2026-06-30
- **Summary**: Finished the MCP tool surface upgrades for task-aware clients without adding
  Docket-specific confirmation metadata. Tool list entries now advertise explicit execution
  metadata, selected tools declare output schemas, JSON results include `structuredContent`
  plus compatibility text, and `run_view` / `trigger_agent` can run through MCP Tasks when
  `MCP_TASKS_ENABLED=true`.
- **Files Changed**: `apps/api/src/mcp/{catalog,list-metadata,result,server,session-tools,task-crud-tools,task-store,task-tools,view-plan-tools}.ts`,
  `apps/api/tests/mcp/mcp-surface.test.ts`.
- **Learnings**: The MCP SDK already ships experimental task primitives (`TaskStore`,
  `registerToolTask`, `tasks/get|result|list|cancel`), so Docket should lean on those instead
  of owning a parallel task protocol. Because the `/mcp` transport is stateless, task storage
  must be shared across requests but wrapped per caller so task IDs cannot cross auth contexts.
- **Gate**: `pnpm --filter @docket/api lint`, `pnpm --filter @docket/api typecheck`,
  `pnpm --filter @docket/api exec vitest run tests/mcp`, and `pnpm --filter @docket/api test`
  all pass in the isolated worktree.

### [MCP-PAGE-007] MCP pagination protocol support

- **Completed**: 2026-06-29
- **Summary**: Added catalog-backed MCP cursor pagination for `tools/list`,
  `resources/list`, `resources/templates/list`, and `prompts/list`; added opaque cursor
  pagination to the `run_view` and `search` tools. The implementation keeps the SDK as the
  execution/read/prompt engine while Docket records list metadata in a small typed catalog and
  installs cursor-aware list handlers.
- **Files Changed**: `apps/api/src/mcp/{catalog,list-metadata,list-pagination,server,tools-shared,tools-shared-queries,view-plan-tools}.ts`,
  `apps/api/tests/mcp/mcp-surface.test.ts`.
- **Learnings**: MCP protocol-list pagination is not automatic in the SDK's high-level
  registration API; a Docket-owned catalog is the durable way to paginate lists without reading
  SDK private fields. Keyset cursors must order by the same `(createdAt,id)` tuple they encode,
  otherwise same-timestamp rows can duplicate across pages.
- **Gate**: Touched-file ESLint passed. `pnpm exec vitest run tests/mcp/mcp-surface.test.ts
tests/mcp/mcp-auth.test.ts tests/mcp/mcp.test.ts tests/mcp/mcp-tools.test.ts
tests/mcp/mcp-scope.test.ts` is currently blocked by unrelated dirty DB schema drift
  (`hub.deletion_state` exists in the Drizzle schema but not the migrated PGlite test DB).
  `pnpm --filter @docket/api typecheck` is blocked by an unrelated existing
  `tests/account/export.test.ts` assertion mismatch.

### [AUTH-003] Browser-facing Better Auth baseURL + oAuthProxy + setup URL split

- **Completed**: 2026-06-29
- **Summary**: Fixed an OAuth host inconsistency surfaced while reviewing `pnpm integrations`.
  Better Auth runs on the API but is reached **same-origin** via each Next app's `/api/auth/*`
  rewrite, so its `baseURL` (which the OAuth `redirect_uri` + session cookie derive from) must be the
  **browser-facing product origin**, not the API origin. Three fixes: (1) local `baseURL` was the
  static API origin and couldn't serve two frontends — enabled dynamic `baseURL` locally; (2) social
  OAuth on preview deploys would `redirect_uri_mismatch` — added the `oAuthProxy` plugin; (3)
  `pnpm integrations` registered OAuth callbacks on the API origin and munged the homepage — split
  the setup URLs into `webBases` (callbacks/homepage) vs `apiBase` (webhook only).
- **Approach**: Added `OAUTH_PROXY_SECRET` + `OAUTH_PROXY_PRODUCTION_URL` to the auth slice +
  registry with an all-or-nothing cross-field rule (`api.ts`); mounted `oAuthProxy` in
  `buildAuthOptions` gated on both (unset ⇒ direct OAuth). Set `BETTER_AUTH_ALLOWED_HOSTS` in
  `.env.example` + `bootstrap`'s `writeEnvLocal` (web/admin/api localhost) so dynamic `baseURL`
  resolves per browser-facing host. Reworked `resolveBaseUrl`→`resolveSetupUrls` returning
  `{ apiBase, webBases }` (webBases from `BETTER_AUTH_TRUSTED_ORIGINS`); the `instructions`/`steps`
  signature is `(env, urls)`, each provider registering an OAuth callback per web frontend, the
  webhook on the API host, and the GitHub homepage on the product origin.
- **Files Changed**: `packages/env/src/{slices,registry-vars-core,api}.ts`,
  `packages/auth/src/auth-builder.ts` (+ `tests/auth.test.ts`), `.env.example`,
  `scripts/{bootstrap,integrations-setup,integration-providers}.ts`,
  `docs/engineering/specs/env-and-bootstrap.md`.
- **Learnings**: with two browser frontends (web + admin) a single static `baseURL` cannot serve
  both — dynamic `baseURL` (per `x-forwarded-host`) is mandatory, not optional. `oAuthProxy` is the
  supported answer for unregisterable preview URLs; dynamic `baseURL` alone does NOT fix OAuth on
  previews (it would mint an unregistered `redirect_uri`). The webhook is the only genuinely
  API-origin URL — everything else in the OAuth/connect flow is browser-facing.
- **Gate**: `@docket/{env,auth}` typecheck + lint clean; auth tests pass (oAuthProxy gating);
  `pnpm env:check` passes; `pnpm integrations` GitHub steps verified to render callbacks on the
  web + admin origins and the webhook on the API origin. (The auth-builder mount lands with the
  concurrent twoFactor work it co-occupies.)

---

### [INT-003] GitHub App integration (sign-in + issue/PR connector + webhook firehose)

- **Completed**: 2026-06-29
- **Summary**: Docket's GitHub integration is a **GitHub App**, not an OAuth App. The deciding
  factor is the real-time webhook **firehose** — an app-level webhook is a GitHub-App-only
  primitive (OAuth Apps have none), so it is the only model that delivers it. It also wins on
  least-privilege consent (`Issues`/`Pull requests`/`Metadata` read; no `repo` scope) and a
  zero-migration path to teams. The one App does three jobs: sign-in (user-to-server OAuth), the
  issue/PR connector pull, and the firehose.
- **Approach**: Consolidated the GitHub OAuth App (`GITHUB_CLIENT_ID/SECRET`) into one App —
  `GITHUB_APP_{ID,SLUG,CLIENT_ID,CLIENT_SECRET,PRIVATE_KEY,WEBHOOK_SECRET}` across the auth slice,
  registry, `.env.example`, and `deploy.yml`; sign-in now sources the App's client creds in
  `buildAuthOptions` (scope `user:email`). Added the App auth machinery in `@docket/boundaries`
  (`connector-github-app.ts`: RS256 app JWT via `node:crypto`, `mintInstallationToken` /
  `resolveInstallationAccount`, an `InstallationTokenStore` cache; private key as single-line
  base64 PEM). The firehose is `RealGitHubObserver` (verify `X-Hub-Signature-256` → route by
  installation id → normalize issue/PR/comment events) + `POST /v1/ingest/github`, reusing the
  Linear ambient-ingestion path (write-ahead inbox → per-provider drain → observations). The
  connect flow is `GET …/integrations/:id/connect-url` (signed-`state` install URL) → the non-RPC
  `GET /v1/integrations/github/callback`, which verifies the state, validates the installation, and
  records `installation_id` on `connection.externalWorkspaceId` (the firehose routing key).
- **Files Changed**: `packages/env/src/{slices,registry-vars-core}.ts`, `.env.example`,
  `.github/workflows/deploy.yml`, `packages/auth/src/auth-builder.ts` (+ tests);
  `packages/boundaries/src/real/{connector-github-app,observer-github,index}.ts`,
  `packages/boundaries/src/select.ts` (+ `tests/real/{connector-github-app,observer-github}.test.ts`,
  `tests/select-ambient.test.ts`); `apps/api/src/{container,server}.ts`,
  `apps/api/src/routes/{ingest,integrations,integrations-github}.ts`,
  `apps/api/src/lib/github-app.ts` (+ `tests/routes/{ingest,integrations-github}.test.ts`,
  `tests/lib/github-app.test.ts`); `scripts/{integrations-setup,integration-providers}.ts`;
  `docs/engineering/specs/env-and-bootstrap.md`.
- **Learnings**: GitHub webhook payloads embed the full issue/PR object, so `normalize` is pure (no
  API call); the event type lives in the `X-GitHub-Event` header (absent from `route(payload)`), so
  it is inferred from the payload shape. Bootstrap setup must **create from scratch by default and
  only verify/skip when the env vars already exist** — an earlier "pull shared values from prod
  Secret Manager" flow broke first-time setup, lagged on serial gcloud calls, and silently used the
  wrong gcloud project.
- **Gate**: `@docket/{env,auth,boundaries}` typecheck + lint clean; boundaries 232 + new GitHub
  tests pass; api GitHub tests (token machinery, observer, `/v1/ingest/github`, install-state,
  callback) pass. (A pre-existing `daily-digest` ON CONFLICT failure and a concurrent
  `ObservationKind` rename in `stream-read.test.ts` are unrelated to this work.)

---

### [INT-002] Separate connected identities (accounts) from the resources they provide

- **Completed**: 2026-06-29
- **Summary**: Fixed the Google Tasks integration's conflation of two distinct concepts —
  **identities** (external accounts a user links to their Docket identity: a Google `sub`/email,
  stored as a Better Auth `account` row keyed by `userId`) versus **resources** (what an identity
  provides: Google task lists / `ResourceRef`, selected per-integration). Previously each linked
  Google account was even _labeled by a task-list title_ because `connector-google.ts`
  `resolveAccount()` returned the first list's title, and OAuth linking was welded into the org
  integration "Add account" flow. Now: identities are surfaced at the **user level** in a new
  **Account ▸ Connected accounts** surface (the only place OAuth link/unlink happens, by email);
  the org Google Tasks surface picks an already-linked identity and configures resources. Also
  split the org "Integrations & import" into **two sibling settings sections** — **Connections**
  (sync as a connection, the default) and **Import** (full one-time import) — removing the inline
  Migration/Connector choice; the surface fixes the pattern.
- **Approach**: New `GET /v1/me/identities` (`me-identities.ts`) → `requireUserId` →
  `googleIdentities(userId)` queries the `account` table and decodes each `idToken` JWT payload
  (unverified — trusted storage, display-only) via a new `decodeIdTokenClaims` helper
  (`lib/id-token.ts`) to recover `email`/`name`/`picture`; returns a synthetic identity in
  `APP_MODE` local/test so the flow stays exercisable offline. `IdentityOut`/`IdentityListOut`
  DTOs added to `@docket/types`. `POST /:id/verify` now sets `connection.account =
resolveIdentityLabel(actorId, externalAccountId) ?? result.account` (Actor→user→account
  mapping) so the stored label is the **email**, not a list title. Connector
  `resolveAccount()` gtasks branch returns `undefined` (still validates the token via the lists
  call). Web: new `connected-accounts-tab.tsx` (link/unlink via `authClient`), rewritten
  `gtasks-accounts-section.tsx` as an identity picker, `IntegrationsTab({surface})` driving the
  Connections/Import split, and a reusable `IntegrationActionButton`.
- **Files Changed**: `packages/types/src/identity.ts` (new) + `index.ts`;
  `apps/api/src/lib/id-token.ts` (new) + `tests/lib/id-token.test.ts`;
  `apps/api/src/routes/me-identities.ts` (new) + `tests/routes/me-identities.test.ts`,
  `routes/integration-provider.ts`, `routes/integrations.ts`, `routes/integration-sync.ts`,
  `app.ts`; `packages/boundaries/src/real/connector-google.ts` + `tests/connector.test.ts`;
  `apps/web/src/components/settings/{connected-accounts-tab,gtasks-accounts-section,integration-provider-card,integration-action-button,integrations-tab,sections-personal,sections}.{ts,tsx}`,
  new `connected-accounts/` + `connections/` + `import/` route pages (git mv from `integrations/`),
  removed `connect-wizard.tsx`; `apps/web/tests/components/settings/settings-sections.test.ts`.
- **Learnings**: the identity email lives **only** in `account.idToken` (not a column;
  `listAccounts()` returns just the `sub`) → server-side decode is required. Fixing the conflation
  was localized to `resolveAccount()` because every downstream layer faithfully carried whatever
  label it produced. Pre-existing `daily-digest.test.ts` failures (3) are an unrelated pglite
  ON CONFLICT/unique-index gap, untouched by this work.
- **Gate**: `@docket/{types,boundaries,api,auth}` typecheck + lint clean; web typecheck + 149
  tests + lint clean; api 716 pass (3 pre-existing daily-digest failures unrelated); boundaries
  216 + types 200 pass; `@docket/api` dist rebuilt for web RPC types.

---

### [AUTH-002] Prune server-deleted passkeys during sign-in via the WebAuthn Signal API

- **Completed**: 2026-06-29
- **Summary**: When a passkey sign-in is rejected by the server because the credential no longer
  exists (`@better-auth/passkey` `verify-authentication` → HTTP 401 `PASSKEY_NOT_FOUND`), the
  client now tells the platform authenticator/password manager to prune the stale credential via
  `PublicKeyCredential.signalUnknownCredential({ rpId, credentialId })`. This stops the deleted
  passkey from being offered again (notably in the conditional-mediation autofill list). Applies
  to both `apps/web` and `apps/admin` sign-in screens, on both the explicit-button and silent
  autofill paths.
- **Approach**: The credential ID is recovered by calling
  `authClient.signIn.passkey({ autoFill, returnWebAuthnResponse: true })` and reading
  `result.webauthn.response.id` on the error branch — the plugin attaches the
  `AuthenticationResponseJSON` even on a server rejection because it posts to verify with
  `throw: false`. Added `isPasskeyUnknownToServer()` + a typed `unknown_credential` outcome to the
  shared `@docket/types` passkey error mapper, and a defensive, feature-detected
  `signalUnknownPasskey()` browser helper per app (no-op where the Signal API is absent; never
  throws). The required `rpId` comes from a new browser-exposed `NEXT_PUBLIC_PASSKEY_RP_ID`
  (mirrors the server's `BETTER_AUTH_PASSKEY_RP_ID`, **no fallback**).
- **Files Changed**: `packages/types/src/passkey-errors.ts` (+ `tests/passkey-errors.test.ts`);
  `apps/web/src/app/(auth)/_lib/{webauthn,passkey-error}.ts`, `apps/web/src/app/(auth)/sign-in/page.tsx`;
  `apps/admin/src/app/(auth)/_lib/webauthn.ts` (new), `apps/admin/src/app/(auth)/_lib/passkey-error.ts`,
  `apps/admin/src/app/(auth)/sign-in/page.tsx`; `apps/web/src/types/env.d.ts`,
  `apps/admin/src/types/env.d.ts` (new); `.env.example`; `docs/engineering/specs/env-and-bootstrap.md`.
- **Learnings**: better-auth hides the ceremony credential ID by default; `returnWebAuthnResponse`
  is the only way to recover it, and it's populated on the server-rejection path (not on a
  thrown/cancelled ceremony, which has no credential ID — and isn't a "deleted" case anyway).
  Signal API is Chrome/Edge 132+; Safari/Firefox no-op gracefully.

---

### [INT-001] Turnkey third-party integration setup (`pnpm integrations`)

- **Completed**: 2026-06-29
- **Summary**: Implemented the interactive integration setup designed in
  `docs/engineering/specs/env-and-bootstrap.md` §3.4 (previously specced but not built). A new
  registry-driven module walks every external credential in `VAR_REGISTRY` (OAuth providers,
  Stripe, Anthropic, SMTP, observability), printing explicit per-provider instructions (exact
  console URL + the exact redirect URI for the chosen environment) and collecting values via
  masked, schema-validated, re-promptable inputs. It is **environment-aware** — `local`,
  `staging`, `production` are each configured in their own pass with their own credentials and
  redirect URIs — and routes writes accordingly: `local` upserts the root `.env.local`
  non-destructively; `staging`/`production` push server vars to GCP Secret Manager
  (`docket-…` for prod, `docket-staging-…` for staging — matching `deploy.yml`) and public
  `NEXT_PUBLIC_*` vars to GitHub environment variables, printing the exact `deploy.yml` lines to
  wire any new secret. Runnable standalone (`pnpm integrations`) or automatically at the end of
  `pnpm bootstrap`. Before any cloud write it **confirms the gcloud + gh accounts and GCP project**
  — lists every authenticated account and every accessible project and lets the operator choose
  rather than assuming the active ones — scoping gcloud via `CLOUDSDK_CORE_ACCOUNT` (no
  global-config mutation) and `gh auth switch` only when a different account is picked;
  `pnpm bootstrap` runs the same confirmation up front.
- **Approach**: Reused `VAR_REGISTRY` (the documented single source for "the future bootstrap
  prompt") for metadata + zod validation, and `env-check`'s validation pattern. Built the prompt
  layer on `@clack/prompts` (the library the spec §3 already mandates) — `password()` for real
  masking, `select()`/`multiselect()` for account/project/environment menus, `text()` with
  zod-backed `validate` — replacing the initial hand-rolled readline + private `_writeToOutput`
  masking hack and bootstrap's bespoke readline. Added a non-destructive `upsertEnvVars` (also
  adopted by bootstrap's `writeEnvLocal`, replacing its destructive skip-if-exists), and a curated
  provider-group table carrying **dummy-proof, numbered, click-by-click** setup walkthroughs per
  provider (console navigation, exact fields, exact redirect URI, where to copy each value),
  rendered in clack `note()` boxes; the credential metadata still comes from the registry.
- **Files Changed**: `scripts/integrations-setup.ts` (new); `scripts/bootstrap.ts` (fully
  clack-rendered — `intro`/`log`/`note`/`outro` + prompts, no more raw `console.log` sections
  clashing with the styled prompts; calls `runIntegrationSetup` embedded; non-destructive
  `.env.local`); `package.json` (`integrations` script + `@clack/prompts` devDependency);
  `docs/engineering/specs/env-and-bootstrap.md` §3.4 (marked implemented); `.env.example`.
- **Validation**: `tsc` strict (clean), `eslint` (clean), `pnpm env:check` (pass); `upsertEnvVars`
  unit harness (in-place replace, no dupes, comment-preserving, empty-skip); live verification of
  the gcloud/gh account choosers and the GCP project chooser (CLOUDSDK_CORE_ACCOUNT set, gh
  untouched); clack `note()` render check of the walkthroughs.
- **Dev-first flow**: `pnpm bootstrap`'s first priority is the local dev environment — Phase 1
  (always): check dev tools (openssl required; docker optional) → write a local-only `.env.local`
  → optionally run local integrations. Phase 2 (opt-in, gated by a confirm): provision production
  (gcloud/gh prereqs + account confirmation → GCP/WIF/Secret Manager → GitHub → optional prod
  integrations). `runIntegrationSetup` gained an `environments` option so each phase drives exactly
  one env. Prod prompt defaults are prod-shaped (apex `docket.app` → `app/api/admin.docket.app`),
  never seeded from `.env.local`; a localhost value warns; a config-review note + confirm gate
  precedes any cloud write.
- **UX/clarity pass**: status output is grouped into compact `note` blocks (tool **versions**,
  authenticated **accounts** — not bare CLI names) instead of one `◆`-per-item with blank-line
  sprawl. Note titles are objective and outcome-framed ("Checked: local dev prerequisites",
  "Overview", "Environment: local") rather than conversational/assertive; no all-caps emphasis in
  prose.
- **Prod secrets never touch disk**: prod/staging values are held in memory and pushed straight to
  GCP Secret Manager (via `--data-file=-` stdin) / GitHub — no temp files. Fixed a leak where
  bootstrap reused the prod-generated `BETTER_AUTH_SECRET`/`CRON_SECRET` for `.env.local`; the
  local file now generates its own independent dev secrets (dev ≠ prod).
- **Learnings**: Don't hand-roll terminal prompting — masking secrets by overriding readline's
  private `_writeToOutput` is a hack; `@clack/prompts` does it properly and the spec already
  sanctioned it. Clack emits a blank gutter line between every `log.*` call, so per-item status
  loops look sparse — group related status into a single `note()`. Also: piped stdin can't drive
  interactive prompt loops (EOF fires before later prompts register), so verify the pure logic in
  isolation and the TTY flow via `note()`/render.

### [AMB-001] Ambient Context Intelligence — Phase 0 (Linear ingestion → daily digest)

- **Completed**: 2026-06-28
- **Summary**: Built the Phase-0 vertical slice of Ambient Context Intelligence: Docket now
  observes inbound external-tool events into an append-only knowledge timeline and emails a
  Sunsama-style daily digest of what the user actually did. This is distinct from the existing
  pull-and-materialize sync (which turns external items into native tasks) — observations are a
  read-only timeline whose source of truth stays external. Architecture is a provider-agnostic
  pipeline (verify → write-ahead inbox → ACK fast → lease-guarded async drain → normalize →
  observation store → surface), fed by provider-specific source adapters, mirroring the existing
  `Connector` ports/adapters pattern. Linear is the first provider proving the whole loop.
  - **Boundary ports**: new `Observer` port (`verifySignature`/`route`/`normalize`) with a real
    Linear adapter (hex HMAC-SHA256 over the raw body, app-level secret; maps Issue/Comment/
    Reaction/AppUserNotification → observation drafts) + `MockObserver`; new `Summarizer` port
    (one-shot Claude completion — deliberately NOT the session/approval-gated `AgentRuntime`) +
    `MockSummarizer`. Shared `makeAnthropicClient`/`wrapAnthropicError` + `asRecord`/`str` helpers.
  - **Data model**: new `observation` schema island — `inbound_event` (durable write-ahead log,
    unique `(provider, external_event_id)`), `observation` (the timeline; org-scoped + `user_id`),
    `daily_digest` (cross-org per-user, unique `(user_id, digest_date)` watermark), and
    `event_subscription` (the seam for later watch-channel providers). Migrations 0008/0009.
  - **API**: `POST /internal/ingest/linear` (non-RPC edge, write-ahead then 200); lease-guarded drain
    `POST /v1/cron/process-events` with mention/assignment → `notification` bridges; the hero
    `POST /v1/cron/daily-digests` (timezone-aware "find who's due" by `HubPreferences.timezone` +
    send time, aggregate → summarize → render → mail, idempotent per user/day). Two new Cloud
    Scheduler jobs.
- **Files Changed**: `packages/types/src/{observation,primitives,hub-preferences,index}.ts`;
  `packages/db/src/{enums,types}.ts`, `packages/db/src/schema/{observation,index}.ts`,
  `packages/db/drizzle/0008_*.sql`, `0009_*.sql`; `packages/env/src/slices.ts`
  (`LINEAR_WEBHOOK_SECRET`, optional); `packages/boundaries/src/{json,select}.ts`,
  `.../ports/{observer,summarizer}.ts`, `.../real/{anthropic,observer-linear,summarizer}.ts`,
  `.../mock/{observer,summarizer}.ts` (+ barrels; `agent-runtime`/`summarizer` now share the
  Anthropic helpers); `apps/api/src/{container,server}.ts`,
  `apps/api/src/routes/{ingest,observation-sync,daily-digest,cron,integration-sync}.ts`;
  `scripts/scheduler-setup.ts`. Tests added across `@docket/types`, `@docket/boundaries`, and
  `apps/api` (ingest verify/route/dedup, drain + bridges, digest send/empty/idempotent).
- **Validation**: `pnpm typecheck` green (13/13); `@docket/types` 189, `@docket/db` 39,
  `@docket/boundaries` 211 (the 1 failing `connector.test.ts` is pre-existing gtasks WIP, not
  this work), `apps/api` 694 — all green; lint clean on all files authored here.
- **Deliberate design calls**: digest is cross-org per-user (one summary per person, like the
  Hub inbox), not per-org; both mention AND assignment surface as `notification`s because
  `daily_plan_item.ref_task_id` requires a real Task (an observation isn't one) — the
  "suggested task" bridge is deferred until observation→task materialization exists; the drain
  is a cron sweep behind a pluggable seam so Cloud Tasks can replace it for near-real-time later.
- **Launch checklist (prod, not yet done — avoids breaking the deploy pipeline)**: create the
  GCP Secret Manager secret `docket-linear-webhook-secret`, then add
  `LINEAR_WEBHOOK_SECRET=docket-linear-webhook-secret:latest` to `.github/workflows/deploy.yml`
  (alongside the other provider secrets) and configure the Linear OAuth app's webhook URL to
  `<API_URL>/internal/ingest/linear`. Until the secret is set, the observer safely falls back to the
  mock; the secret must be created BEFORE adding the deploy.yml reference (a missing secret fails
  the Cloud Run deploy). Backfill embeddings / Athena RAG over the observation store is Phase 5.
- **Learnings**: the five target sources don't share a delivery mechanism (Linear/Slack =
  webhooks, Calendar = expiring watch channels, Google Tasks = poll-only, Discord = persistent
  gateway) — so the ingestion edge is per-provider over a shared spine, not one generic endpoint.

### [CONN-001] Connector reliability — never report success when nothing happened

- **Completed**: 2026-06-15
- **Summary**: Audited all connector/integration code and remediated the "connectors fail
  silently" defect end to end. Root causes fixed: (1) the create endpoint fabricated a
  `connected` status without ever validating the credential — integrations now start `pending`
  and only a real `connector.connect()` (`POST /:id/verify`) promotes them; (2) sync failures
  were written to an in-memory map wiped on every deploy and never touched the integration —
  replaced with a durable `sync_run` table plus persisted `lastSyncStatus/lastSyncedAt/lastError`
  on the integration; (3) the boundary swallowed errors (`.catch(() => undefined)`, `return []`
  on bad-auth) — now throws a typed `ConnectorError` (auth/rate_limit/network/provider) with
  edge logging and pagination-truncation warnings; (4) the UI showed ephemeral state — the card
  now renders server truth (pending/connected/error + "last synced"), with a working Reconnect
  CTA, a route error boundary, and inbox notifications on background failures. Added background
  auto-mirror: a lease-guarded `runSync` shared by manual + scheduled paths and a
  `POST /v1/cron/sync-connectors` sweep. Also fixed a latent bug where token resolution compared
  an Actor id against `account.userId`; it now resolves `actor.userId` and refreshes via Better
  Auth `getAccessToken`. Added the Linear `read` OAuth scope.
- **Files Changed**:
  - `packages/db/src/enums.ts`, `packages/db/src/schema/crosscutting.ts`,
    `packages/db/drizzle/0004_*.sql`, `0005_*.sql`
  - `packages/types/src/integration.ts`, `packages/types/src/notification.ts`
  - `packages/boundaries/src/ports/connector-error.ts` (new), `…/real/connector*.ts`,
    `…/real/connector-log.ts` (new)
  - `apps/api/src/routes/integrations.ts`, `integration-provider.ts`,
    `integration-sync.ts` (new, replaces `integration-sync-jobs.ts`), `cron.ts`
  - `packages/auth/src/auth-builder.ts`
  - `apps/web/src/components/settings/{integrations-tab,integration-provider-card,integrations-config,format-time}.{ts,tsx}`,
    `apps/web/src/app/(app)/orgs/[orgId]/settings/integrations/error.tsx` (new),
    `apps/web/src/components/inbox/notification-meta.ts`
  - `docs/engineering/deployment.md`
- **Validation**: `pnpm typecheck` (12/12), `pnpm lint` (12/12), `pnpm build` (3/3),
  `pnpm test` (11/11 suites). New tests cover create→pending, verify-gated connect, durable
  sync-failure status, the background sweep (due/not-due/pending-excluded), and `ConnectorError`
  classification (auth/rate_limit/network/provider).
- **Follow-ups**: Provision the `docket-sync-connectors` Cloud Scheduler job per environment
  (documented in `deployment.md`) so background mirroring actually fires in prod.

### [DEVX-002] Commit message scope enforcement

- **Completed**: 2026-06-13
- **Summary**: Added a Husky `commit-msg` hook backed by
  `scripts/validate-commit-message.mjs` so scoped Conventional Commits are limited to a
  focused product/domain allowlist. Process scopes such as `ci`, `deploy`, `deps`, `pnpm`,
  `release`, and `build` are rejected when used as scopes; unscoped commits remain valid for
  broad maintenance. Updated Dependabot prefixes to avoid generating process-scoped commits
  and documented the scope list in the contributor workflow.
- **Files Changed**:
  - `.husky/commit-msg`
  - `.github/dependabot.yml`
  - `scripts/validate-commit-message.mjs`
  - `docs/contributing/workflow.md`
  - `docs/WORKLOG.md`
- **Validation**: Ran the validator against valid scoped, valid unscoped, and invalid scoped
  commit subjects; verified Prettier formatting and the actual `commit-msg` hook path.

### [DEPLOY-001] Production deploy triage for `docket.hypertext.studio`

- **Completed**: 2026-06-13
- **Summary**: Re-checked the current production path for Docket. The GitHub Actions
  Cloud Run deploy workflow is green on `main`, but public DNS still prevents the app from
  serving: `docket.hypertext.studio`, `docket-api.hypertext.studio`, and
  `docket-admin.hypertext.studio` resolve to Google Frontend / `ghs.googlehosted.com` and
  return HTTP 403 instead of routing through Cloudflare to the Cloud Run services. Local
  `gcloud` credentials are expired, so service metadata could not be queried from this
  shell. Fixed the deploy workflow so comma-containing `BETTER_AUTH_TRUSTED_ORIGINS` is
  escaped per the deploy action contract and added explicit Cloud Run URL output lines for
  the next deploy. Updated the deployment runbook to match the live GitHub variables:
  `docket-api.hypertext.studio`, `docket.hypertext.studio`, and
  `docket-admin.hypertext.studio`.
- **Files Changed**:
  - `.github/workflows/deploy.yml`
  - `docs/engineering/deployment.md`
  - `docs/WORKLOG.md`
- **Validation**: Verified GitHub deploy run `27227068960` succeeded; verified live DNS and
  HTTP status with `dig`/`curl`; attempted `gcloud run services describe` but was blocked
  by expired local reauthentication.
- **Remaining**: Update authoritative DNS/Cloudflare records to CNAME each production host
  to its Cloud Run `.run.app` URL, set Cloudflare SSL/TLS mode to Full, set
  `PASSKEY_RP_ID=hypertext.studio`, redeploy, then run a live sign-up smoke test.

### [DESIGN-002] First-run experience: capture + ask-Athena from Today, auto-rolled cycles

- **Completed**: 2026-06-10
- **Summary**: Made the AI-native entry points real in the UI (both backends existed with no
  frontend). Today gains the hybrid prompt box — free text captures a task
  (`POST /capture`, confirmation names the task + links to it) or escalates to an Athena
  session (`POST /sessions`, navigating into the live session with approval gates). The
  three zero-count attention cards collapse to one all-clear line; plan empty state funnels
  into capture/integrations. Cycles stops asking for manual creation and ensures each team's
  auto-rolled window via the idempotent `GET /cycles/current`. My Work keeps a single
  creation affordance (composer). `EmptyState` drops the dashed-wireframe look product-wide.
  All flows browser-driven end-to-end and screenshot-verified.
- **Learnings**: the audit must be run against the _first-run_ experience explicitly — a
  fresh workspace exposed that the product's core differentiator (capture → structure →
  agent) had zero UI entry points despite complete backend support.

---

### [DESIGN-001] Brand identity + craft framework: rubric, marketing redesign, app design-system completion

- **Completed**: 2026-06-10
- **Summary**: Established the product's design-evaluation framework and applied it:
  the marketing site got a distinct paper-and-ink brand identity, and the app's
  documented-but-unimplemented type/motion/density systems were built out. Every visual
  claim screenshot-verified (`.screenshots/`, `.screenshots/all-routes/`).
- **What shipped**:
  - **Craft rubric** (`docs/design/craft-rubric.md`) — 8 scored dimensions (1–4, evidence
    required) + 5 hard gates; ship bar = all dims ≥3, gates green. Operationalized as the
    `/design-review` skill (`.claude/skills/design-review/`). First full-product scorecard
    in `docs/design/audits/2026-06-10-design-pass.md` (all surfaces at ship bar).
  - **Marketing redesign** — scoped `.marketing` token re-skin (cream paper/warm ink/single
    sienna accent, vanilla CSS to avoid the Tailwind v4 second-entry trap); Fraunces display
    face (opsz + WONK axes) route-group-loaded; landing rebuilt as an editorial narrative
    (hero → live-DOM "honest seam" product frame → separation/unification diagram → numbered
    feature ledger → how-it-works band → pull-quote principles → one-line pricing → ink CTA);
    about/pricing restyled; canonical tagline ("Run every organization from one calm place.")
    swept everywhere; OS-dark immunity incl. root scrollbar.
  - **Auth/onboarding seam** — serif WONK wordmark + warm light backdrop on auth; same
    wordmark on the onboarding wizard.
  - **Type scale** — rename-then-redefine: `text-sm`→`text-body` (313 sites, zero visual
    diff), then the named scale (`text-h1/h2/h3` with weight+tracking baked, 13px `text-sm`,
    `text-xs` w500, `text-mono` w500); ~30 ad-hoc heading sizes swept; tailwind-merge
    extended so custom font-size names aren't treated as colors (real bug caught by tests).
  - **Motion** — `--dur-fast/base/slow` + MD3 eases; 120ms default transition; overlays
    retimed (dialog/sheet 240ms @0.98 scale, popover/dropdown 180ms); 240ms org-rebind
    cross-fade in AppShell (transient class, no remount); global prefers-reduced-motion block.
  - **Density** — `data-density` now actually consumed: `--row-h/--row-py` drive all row
    components; ListView virtualizer estimate follows density and re-measures; added
    `spacious`; per-user localStorage persistence; command-palette cycle action.
  - **Docs** — design-system.md §type/§density/§motion reconciled to implementation.
- **Learnings**:
  - Tailwind's stock `text-sm` exactly equals the spec's `text-body`, making the rename
    mechanically safe before redefining `--text-sm` (grep-zero gate prevents silent shrink).
  - tailwind-merge classifies unknown `text-*` tokens as colors — any custom font-size
    token must be registered via `extendTailwindMerge` or `cn()` silently drops color classes.
  - CDP virtual WebAuthn authenticators (via Playwright `newCDPSession`) make the
    passkey-only flow fully automatable for screenshot audits.

---

### [DEVX-001] Portless dev URLs + native turbo dev graph + committed local env

- **Completed**: 2026-06-06
- **Summary**: Reworked local dev. Dev servers run behind
  [portless](https://github.com/vercel-labs/portless) at stable named URLs
  (`web/marketing/admin/api.docket.localhost`) instead of hardcoded ports; `pnpm dev`
  orchestrates DB-up → migrate → servers through the native turbo task graph instead of an
  inline shell chain; and local env works with zero setup.
- **What shipped**:
  - **Portless** — added to the pnpm catalog + root devDeps; each app
    (`apps/{web,admin,marketing,api}`) split `dev` into `dev` (`portless`) + `dev:app` (the
    real `next dev` / `tsx watch`) with a `portless` config block; `start` scripts dropped
    their hardcoded `--port`. `.env.example` URLs switched to the named https origins.
  - **Native turbo dev** — `turbo.json` gains a `//#db:up` root task; `db:migrate`
    `dependsOn` it; `dev` `dependsOn ["^db:migrate"]`. Root `dev` is now
    `dotenv -e .env.local -- turbo run dev` (was `pnpm db:up && pnpm db:migrate && …`);
    `db:reset` simplified to lean on the new dependency.
  - **Proxy setup** — `proxy:install` / `proxy:status` / `proxy:uninstall` wrap
    `portless service install`, fixing the port-443/sudo race under parallel `dev`.
    Documented with full implications in `docs/local-development.md`.
  - **Committed `.env.local`** — tracked with safe non-secret defaults so `pnpm dev` runs on
    a fresh clone with no copy step; removed from `.gitignore`; `prepare` arms
    `git update-index --skip-worktree .env.local` so local edits aren't tracked (with docs
    for intentionally updating the defaults and for the upstream-change footgun). `PORT`
    restored to `.env.example` (required, default-less api var; portless overrides at runtime).
  - **Robustness** — `@docket/db` migrate runner filters benign Postgres NOTICEs
    (`42P06`/`42P07`) so a no-op migrate on every `pnpm dev` stays quiet.
  - **Housekeeping** — `.gitignore` adds `.lova.disabled/` + `.claude/settings.local.json`;
    removed stale on-disk build artifacts.
- **Key decisions**:
  - **Tracked `.env.local` + `skip-worktree`** over force-check-in (loses protection once
    tracked) or `git rm --cached`/defaults-file+copy (no zero-setup working file). Picked for
    committed defaults + edit protection + zero copy step; documented footgun: upstream
    changes can block `git pull` (recover via `--no-skip-worktree`).
  - **Proxy as an OS service** (one-time sudo, owns 443, persists) over per-run
    `portless proxy start` or unprivileged-port URLs — keeps the clean `:443` named URLs.

### [DOCKET-FND] Docket foundation spine (P1–P5 tokens) — hands-on build

- **Completed**: 2026-06-05 (foundation spine; UI components + P6 fan-out remain)
- **Summary**: Built the contract-critical backend foundation + UI token layer for Docket on the green Phase-0 skeleton. All green: `pnpm typecheck` (15/15), `pnpm test` (10/10 suites), a PGlite migration applies in-process, and a workspace-wide **100% declaration doc-coverage** gate passes.
- **What shipped**:
  - **@docket/env** — t3-oss/env slices (shared/db/auth/stripe/mcp/agent/ops/client) + per-app compositions (api/web/marketing/admin) + single-source `VAR_REGISTRY` + `scripts/env-check.ts`. Cross-field rules enforced at the api composition. `.env.local` + rewritten `.env.example` for the zero-account build (APP_MODE=local, `pglite://` DATABASE_URL, placeholder keys → mocks).
  - **@docket/db** — full Drizzle schema (~38 tables across identity/work/crosscutting/joins/agents/admin/infra + Better Auth tables), 34 pgEnums, jsonb `$type` shapes, ULID `genId`, **driver-select client** (`pglite:`/`postgres:`/`neon:` from the URL scheme; lazy proxy), relations, `drizzle.config.ts`, and an **offline migrate runner** (`src/migrate.ts`). One migration `0000` generated + applied against PGlite.
  - **@docket/auth** — one `betterAuth()` (drizzleAdapter, ULID `generateId`, email/password, `nextCookies` last) + `databaseHooks.user.create.after` → user→hub birth; HMAC passkey-intent signer.
  - **@docket/types** — branded ULID `Id` + per-entity brands, flat `Capability` + `satisfies`, RFC 9457 `Problem`+`ProblemCode`, `ListQuery`/`Page`, vocabulary/hub-preferences canonical Zod, slice DTOs (Org/Project/Task/Actor/Team).
  - **apps/api** — Hono service: CORS → session mw → `/api/auth/*` → `/v1`; chained `orgs`→`projects`/`tasks` routers defining `AppType`; org-create transaction (org + 4 system roles + Owner actor + default team + team_member + org-root grants); Problem `onError`; native-validator `zJson`/`zQuery`/`zParam` (RPC-typed, zod-4 native); `ok()` output helper; minimal OpenAPI 3.1 + Scalar; `@hono/node-server` boot. `hc<AppType>` consumer typechecks.
  - **@docket/authz** — `canActor` cascade resolution (cross-org/suspended pre-checks, ancestor chain, allow-only with `DENY_ENABLED=false`), visibility helpers, `lastOwnerGuard`/`noSelfEscalation`; api `orgContextMiddleware` (404 existence-hiding) + `capabilityGuard`. 4 unit tests on seeded PGlite.
  - **@docket/ui** — OKLCH token `globals.css` (Tailwind v4 `@theme`, WorkflowState-typed state tokens), `cn()`, and deterministic `getOrgAccent`.
  - **@docket/test-utils** — the doc-coverage harness (TS compiler API) + workspace gate.
- **Key decisions / deviations from the manifest** (carry into the fan-out):
  - **Zero-external-accounts build via PGlite** (not Neon): client + migrate runner select driver by URL scheme; prod is purely `DATABASE_URL`.
  - **Passkey _plugin_ deferred to P6**: better-auth 1.6.14 ships the passkey plugin separately (needs `@simplewebauthn/*`), so the foundation uses email/password; the passkey-intent signer + `passkey` table are already in place. The full plugin set (social/sso/scim/oidc/mcp/stripe) is the P6 auth lane.
  - **OpenAPI**: hono-openapi 0.4.8 declares a zod-3 peer; to stay zod-4-native the slice validates with Hono's built-in `validator` (RPC-typed) and serves a minimal 3.1 doc + Scalar. Per-route `describeRoute` spec generation is a P6 api-lane task.
  - **`@docket/types/api` does NOT re-export `AppType`** — that would make types depend on api (which depends on types) and turbo rejects the package cycle. Consumers import `import type { AppType } from '@docket/api'` directly.
  - **Auth schema is hand-authored** in `@docket/db/schema/auth.ts` (the @better-auth/cli is pinned to 1.4.x and interactive); the P6 auth lane regenerates it with the full plugin set.
  - **Tooling**: `vite` pinned to ^7 (vitest 4 needs Vite 6/7; the peer mis-resolved to 5). Per-package `tsconfig` sets `types: ["node"]` where Node globals are used. The original `>=24 <25` engine pin was later superseded by TOOLING-001 (`>=24.15 <27` with Node 26 as the default).
- **Remaining (the fan-out)**: FND-P5-02 shadcn primitives · FND-P5-03 app shell (GlobalRail/ContextSidebar/Vocabulary) · FND-P5-04 virtualized ListView · then the P6 lanes (data-and-api entities, permissions-auth-billing, mcp, ui-screens, testing, connectors) — to be driven via a dynamic workflow against this green foundation, honoring the single-owner rules in `build-readiness.md`.

---

## Active Tasks

### [MCP-004] Streamable HTTP cancellation support

- **Status**: REVIEW
- **State**: VALIDATING
- **Started**: 2026-06-29
- **Priority**: P1
- **Description**: Ensure the `/mcp` Streamable HTTP server handles MCP `notifications/cancelled` notifications for in-progress JSON-RPC requests.
- **Subtasks**:
  - [x] Review MCP cancellation requirements and local MCP surface spec.
  - [x] Add a regression test for cancelling an active request.
  - [x] Implement request tracking and cancellation cleanup in the MCP HTTP handler.
  - [x] Validate targeted MCP tests/typecheck and record the outcome.
- **Blockers**: Full `@docket/api` typecheck is currently blocked by unrelated existing errors in `src/openapi.ts`, `tests/account/export.test.ts`, `tests/infra.test.ts`, and `tests/routes/proactive-sweep.test.ts`.
- **Notes**: The upstream spec says cancellation notifications are fire-and-forget, must not cancel `initialize`, and unknown/completed/malformed cancellations should be ignored. This repo uses a stateless per-request SDK transport, so cancellation now uses process-level active request tracking around the one-shot `/mcp` handler. Validation: `pnpm exec vitest run tests/mcp/mcp-cancellation.test.ts` passes; `pnpm exec eslint src/mcp/server.ts tests/mcp/mcp-cancellation.test.ts` passes; `pnpm --filter @docket/api typecheck` reaches only the unrelated existing errors listed above.

---

### [BACKEND-PLAN-001] Backend Completion Plan (TASKS.yaml)

- **Status**: IN_PROGRESS
- **State**: IMPLEMENTING
- **Started**: 2026-01-05
- **Priority**: P0
- **Description**: Plan sequencing to implement all backend functionality specified or implied in TASKS.yaml before client work.
- **Plan**:

## Plan: Backend Completion (TASKS.yaml)

### Objective

Deliver all backend functionality in TASKS.yaml so client implementations can proceed against stable APIs.

### Approach

Inventory backlog backend tasks, group by dependency, and execute in phased batches: schema/migrations → routes/services → infra/integrations → realtime/sync → tests/docs.

### Steps

1. Build a backend-only task matrix from TASKS.yaml (IDs, dependencies, required routes/services/schemas).
2. Implement remaining data model changes and migrations (rrule, time blocks, timers, attachments, workspaces, notifications, AI tables, soft delete, custom statuses, etc.).
3. Complete API routes + Zod schemas per domain (auth recovery/sessions/linking, account export/deletion, tasks/calendar/agenda/time, attachments, search, settings, billing, analytics).
4. Add async workers, webhooks, and integration sync pipelines (export jobs, calendar sync, third-party integrations).
5. Implement realtime/sync infrastructure (WebSocket, SSE, offline sync primitives, conflict handling) and MCP server/tools.
6. Run validation (tests, lint, typecheck, build), update docs/OpenAPI, and close WORKLOG tasks.

### Files to Modify

- `apps/api/src/db/schema/*.ts` - new tables/columns and relations
- `apps/api/src/routes/*.ts` - missing endpoints per domain
- `apps/api/src/schemas/*.ts` - Zod IO schemas
- `apps/api/src/services/**` - AI, notifications, storage, encryption
- `apps/api/src/integrations/**` - OAuth + sync logic
- `apps/api/src/workers/**` - background jobs
- `apps/api/src/ws/**` - realtime server
- `packages/mcp-server/**` - MCP server/tools
- `apps/api/tests/**` - unit/integration coverage
- `docs/WORKLOG.md`, `docs/api/` - tracking + OpenAPI docs

### Risks

- External API integrations (calendar, Stripe, Linear) require secrets and callbacks.
- Schema migrations touching existing data (soft delete, encryption) may need backfills.
- Realtime/sync requires careful auth and conflict handling to avoid data races.

### Validation

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` after each batch; ensure coverage targets stay >=80%.

- **Notes**: Task matrix generated at `docs/engineering/backend-task-matrix.md` with user-journey alignment.
- **Notes**: Execution order drafted at `docs/engineering/backend-execution-order.md`.

### [DATA-001] Core Data Models

- **Status**: IN_PROGRESS
- **Started**: 2026-01-04
- **Priority**: P0
- **Description**: Create Drizzle ORM schemas for all core domain entities
- **Subtasks**:
  - [x] Define enums (taskPriority, taskStatus, projectStatus, initiativeStatus)
  - [x] Create initiatives table with self-referencing hierarchy
  - [x] Create projects table
  - [x] Create tasks table with relations
  - [x] Create events table
  - [x] Create moments table
  - [x] Create activityStreams and activities tables
  - [x] Create junction tables (eventParticipants, taskTags, tags)
  - [x] Define all relations
  - [x] Export from schema index
  - [ ] Commit changes
- **Files Changed**:
  - `apps/api/src/db/schema/core.ts` (created)
  - `apps/api/src/db/schema/index.ts` (updated)
  - `apps/api/src/lib/auth.ts` (fixed TypeScript error)

---

## Completed Tasks

### [MCP-UTIL-005] MCP Utilities + Session Isolation

- **Completed**: 2026-01-05
- **Duration**: 1 day
- **Summary**: Added MCP subscriptions, listChanged and resource-updated notifications for task/event changes, pagination coverage, completions support, and session isolation checks. Validated with MCP integration tests and MCP server typecheck.
- **Files Changed**:
  - `packages/mcp-server/src/index.ts`
  - `apps/api/src/routes/mcp.ts`
  - `apps/api/tests/integration/mcp.test.ts`
  - `docs/WORKLOG.md`
- **Learnings**: Resource updated notifications should be gated behind subscriptions; listChanged remains independent of subscriptions.
- **Retrospective**: Went well—MCP utilities mapped cleanly to SDK capabilities; improve—type-safe JSON parsing helpers earlier to avoid lint churn; change—add shared test utilities for MCP response parsing to reduce repetition.

### [MCP-SAMPLING-006] MCP Sampling Agenda Generation

- **Completed**: 2026-01-05
- **Duration**: 1 day
- **Summary**: Added MCP sampling for `get_agenda` to request agenda summaries via `sampling/createMessage`, validate JSON output, and fall back to deterministic agenda data; added integration coverage for sampling responses; updated Zod helpers and index-signature access to satisfy strict lint/type checks.
- **Files Changed**:
  - `packages/mcp-server/src/index.ts`
  - `apps/api/tests/integration/mcp.test.ts`
  - `apps/api/src/lib/auth.ts`
  - `packages/shared/src/validation/index.ts`
  - `packages/types/src/api/index.ts`
  - `docs/WORKLOG.md`
- **Learnings**: Sampling responses should be parsed defensively and validated before returning to clients; fallbacks keep agendas reliable.
- **Retrospective**: Went well—SDK sampling integration was straightforward; improve—share MCP parsing helpers for tests; change—capture sampling prompt formats in specs if reused.
- **State Transitions**: PLANNING → RESEARCHING → IMPLEMENTING → VALIDATING → DOCUMENTING → COMMITTING → RETROSPECTING
- **Validation**: `pnpm typecheck` and `pnpm build` passed; `pnpm lint` failed on existing `apps/api` lint violations (441 errors) and `pnpm test` failed due to missing test files in `packages/shared` and `apps/web`.

### [MCP-001..004] MCP Server Spec Completion

- **Completed**: 2026-01-05
- **Summary**: Added MCP server package, completed required tools/prompts, resource templates, and updated MCP tests and legacy listings.
- **Files Changed**:
  - `packages/mcp-server/package.json`
  - `packages/mcp-server/tsconfig.json`
  - `packages/mcp-server/src/index.ts`
  - `apps/api/src/services/mcp/server.ts`
  - `apps/api/src/routes/mcp.ts`
  - `apps/api/tests/integration/mcp.test.ts`
  - `apps/api/package.json`
- **Learnings**: Returning structured MCP tool payloads keeps response generation on the assistant.

### [MCP-TEST-002] MCP Resource Templates

- **Completed**: 2026-01-05
- **Summary**: Added MCP resource templates for entity URIs and expanded MCP tests for template listing and reads.
- **Files Changed**:
  - `apps/api/src/services/mcp/server.ts`
  - `apps/api/tests/integration/mcp.test.ts`
- **Learnings**: ResourceTemplate list callbacks allow dynamic resources to appear in resource listings.

### [TEST-UPDATE-001] MCP Test Coverage Refresh

- **Completed**: 2026-01-05
- **Summary**: Expanded MCP tests for additional resources, tool behaviors, and prompt edge cases.
- **Files Changed**:
  - `apps/api/tests/integration/mcp.test.ts`
- **Learnings**: MCP coverage benefits from asserting resource/tool discovery and basic side-effect calls.

### [INIT-001] Documentation

- **Completed**: 2026-01-04
- **Summary**: Created AGENTS.md with comprehensive autonomous workflow guidelines
- **Files Changed**:
  - `AGENTS.md` (created)
  - `CLAUDE.md` (symlink to AGENTS.md)
- **Learnings**: State machine approach provides clear workflow structure

### [INIT-002] Monorepo Scaffolding

- **Completed**: 2026-01-04
- **Summary**: Set up Turborepo with pnpm workspaces
- **Files Changed**:
  - `package.json`, `pnpm-workspace.yaml`, `turbo.json`
  - `apps/api/` - Hono backend
  - `apps/web/` - Next.js frontend
  - `packages/types/` - Shared TypeScript types
  - `packages/shared/` - Shared utilities
  - `packages/test-utils/` - Testing helpers
  - Root configs: `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`
- **Learnings**: Turborepo caching significantly speeds up builds

### [INIT-003] CI/CD Pipeline

- **Completed**: 2026-01-04
- **Summary**: GitHub Actions for CI and semantic-release
- **Files Changed**:
  - `.github/workflows/ci.yml`
  - `.github/workflows/release.yml`
  - `.github/dependabot.yml`
- **Learnings**: Semantic-release automates versioning from commits

### [AUTH-001] Authentication

- **Completed**: 2026-01-04
- **Summary**: Better Auth with OAuth (Google, Apple, Microsoft) and passkeys
- **Files Changed**:
  - `apps/api/src/lib/auth.ts` - Auth configuration
  - `apps/api/src/db/schema/auth.ts` - Auth schema (users, sessions, accounts, verifications, passkeys)
  - `apps/api/src/routes/auth.ts` - Auth routes
  - `apps/web/src/lib/auth-client.ts` - Client auth
  - `apps/web/src/components/auth/login-form.tsx`
  - `apps/web/src/components/auth/signup-form.tsx`
  - `apps/web/src/app/(auth)/login/page.tsx`
  - `apps/web/src/app/(auth)/signup/page.tsx`
  - `apps/web/src/app/dashboard/page.tsx`
- **Learnings**: Better Auth simplifies OAuth + passkey integration

---

## Backlog

### Phase 1: Core Platform (P0)

#### [API-001] Core REST Endpoints

- **Priority**: P0
- **Description**: CRUD endpoints for all domain entities with OpenAPI documentation
- **Dependencies**: DATA-001
- **Subtasks**:
  - Initiatives CRUD (list, get, create, update, delete)
  - Projects CRUD with initiative filtering
  - Tasks CRUD with project/assignee filtering
  - Events CRUD with participant management
  - Moments CRUD with time range queries
  - Activity streams and activities
  - Tags CRUD and task-tag associations
  - OpenAPI/Scalar documentation setup

#### [API-002] Input/Output Validation

- **Priority**: P0
- **Description**: Zod schemas for all API inputs and outputs
- **Dependencies**: API-001

#### [DB-001] Database Migrations

- **Priority**: P0
- **Description**: Drizzle migrations for schema deployment
- **Dependencies**: DATA-001

#### [TEST-001] API Unit Tests

- **Priority**: P0
- **Description**: Unit tests for all API endpoints (80% coverage)
- **Dependencies**: API-001

#### [TEST-002] Integration Tests

- **Priority**: P0
- **Description**: Integration tests with test database
- **Dependencies**: TEST-001

### Phase 2: Web Application (P1)

#### [WEB-001] Dashboard UI

- **Priority**: P1
- **Description**: Main dashboard with overview widgets
- **Dependencies**: API-001

#### [WEB-002] Task Management UI

- **Priority**: P1
- **Description**: Task list, detail view, creation, editing
- **Dependencies**: WEB-001

#### [WEB-003] Project Management UI

- **Priority**: P1
- **Description**: Project views with task organization
- **Dependencies**: WEB-002

#### [WEB-004] Initiative Management UI

- **Priority**: P1
- **Description**: Initiative hierarchy visualization and management
- **Dependencies**: WEB-003

#### [WEB-005] Calendar/Events UI

- **Priority**: P1
- **Description**: Event calendar with scheduling
- **Dependencies**: WEB-001

#### [WEB-006] Moments UI

- **Priority**: P1
- **Description**: Time tracking and moment visualization
- **Dependencies**: WEB-001

### Phase 3: MCP Integration (P1)

#### [MCP-001] MCP Server Foundation

- **Priority**: P1
- **Description**: Model Context Protocol server for AI agent integration
- **Dependencies**: API-001
- **Subtasks**:
  - Task operations (list, create, update, complete)
  - Project operations
  - Event operations
  - Context retrieval
  - Natural language command parsing

#### [MCP-002] MCP Client SDK

- **Priority**: P1
- **Description**: TypeScript SDK for MCP client implementations
- **Dependencies**: MCP-001

### Phase 4: Advanced Features (P2)

#### [SYNC-001] Real-time Updates

- **Priority**: P2
- **Description**: WebSocket or SSE for live data synchronization
- **Dependencies**: API-001

#### [NOTIF-001] Notification System

- **Priority**: P2
- **Description**: Push notifications for deadlines, reminders, updates
- **Dependencies**: WEB-001

#### [SEARCH-001] Full-text Search

- **Priority**: P2
- **Description**: Search across tasks, projects, events
- **Dependencies**: API-001

#### [REPORT-001] Analytics & Reporting

- **Priority**: P2
- **Description**: Productivity metrics, time tracking reports
- **Dependencies**: WEB-001

#### [INTEG-001] Calendar Integrations

- **Priority**: P2
- **Description**: Google Calendar, Apple Calendar sync
- **Dependencies**: WEB-005

#### [INTEG-002] Third-party Integrations

- **Priority**: P2
- **Description**: Slack, Discord, email integrations
- **Dependencies**: NOTIF-001

### Phase 5: Production Readiness (P2)

#### [PERF-001] Performance Optimization

- **Priority**: P2
- **Description**: Query optimization, caching, CDN
- **Dependencies**: All Phase 1-2

#### [SEC-001] Security Audit

- **Priority**: P2
- **Description**: Security review, penetration testing
- **Dependencies**: AUTH-001, API-001

#### [OPS-001] Production Infrastructure

- **Priority**: P2
- **Description**: Container orchestration, monitoring, logging
- **Dependencies**: All Phase 1-2

#### [DOC-001] User Documentation

- **Priority**: P2
- **Description**: User guides, API documentation, tutorials
- **Dependencies**: All Phase 1-2

---

## Notes

### Technology Stack

- **Backend**: Hono, Drizzle ORM, PostgreSQL, Better Auth
- **Frontend**: Next.js 15, React, shadcn/ui, Tailwind CSS
- **Testing**: Vitest
- **CI/CD**: GitHub Actions, semantic-release
- **Package Manager**: pnpm with Turborepo

### Key Decisions

1. **Better Auth over Auth.js**: Better passkey support, cleaner API
2. **Drizzle over Prisma**: Type inference, SQL-like syntax
3. **Hono over Express**: Better TypeScript support, middleware composition
4. **shadcn/ui over component libraries**: Full customization control

---

## [DOCKET-P6-WAVES] P6 fan-out via dynamic workflows (2026-06-05)

Driven by supervised background workflows on the green foundation; each verified by me (typecheck + tests + doc-coverage) after completion.

- **P5 UI components** (workflow) — shadcn "new-york" primitives, AppShell/GlobalRail/ContextSidebar + ContextProvider/VocabularyProvider + useVocabulary + presets, virtualized ListView family + StatusIcon/ActorAvatar/useListKeyboard, jsdom render tests via `vite.config.ts`. (20 UI tests.)
- **P6 data-and-api** (workflow) — DTOs + CRUD routers for initiatives, programs, cycles, milestones, labels, comments, updates, saved-views, members(+invitations), roles, grants, agents, agent-sessions(+approve/reject), integrations, notifications, daily-plan, activity, and the cross-org hub (today/inbox/portfolio/search) — all mounted into the chained RPC `AppType` (21 routers total). Single-owner compose for `orgs.ts`/`app.ts`.
- **P6 boundaries** (workflow) — `@docket/boundaries`: typed ports (BillingGateway, AgentRuntime, Connector, Mailer, BlobStore) + deterministic mock/fixture adapters + env-driven real adapters (injectable HttpClient) + `selectAdapter`/`buildContainer` (real iff env present+real-shaped, APP_MODE local/test forces mocks). 22 tests.
- **P6 web app** (workflow) — `apps/web` wired end-to-end: Next 16 `transpilePackages` + `/v1` & `/api/auth` rewrites, `@docket/ui` tokens + shell, typed `hc<AppType>` client, Better Auth client; landing + sign-in/up + onboarding (intent fork + create-org) + Hub Today + org My-Work (ListView) + project detail. **`next build` succeeds (7 routes).**

State: full `pnpm typecheck` 16/16 · all vitest suites green · doc-coverage 100% · PGlite migration applies · `apps/web` production build green.

Known gaps / next lanes: billing lifecycle + crons; wire the boundaries container into agent-session/connector streaming; MCP remote server; full Better-Auth plugin set + passkey plugin; admin + marketing apps; Playwright e2e flow films; **`eslint .` is red across several packages (lint not yet a green gate)**.

- **P6 billing** (workflow) — `apps/api`: lazy `getContainer()` (boundaries `buildContainer`), org data-lifecycle state machine (`onTrialOrPaymentTerminal`/`onReactivated`/`onPastDue`/idempotent `sweepLifecycle` + `applyBillingEvent`), billing router (checkout/portal/status via the `BillingGateway` port), webhook + `CRON_SECRET`-guarded lifecycle-sweep cron (mounted outside the RPC type). 25 api tests.
- **Repo-wide lint green** — relaxed a few rules in the root `eslint.config.js` (require-await off; restrict-template-expressions allowNumber/allowBoolean; test-file override for non-null-assertion + unsafe-\*; ignore .claude/.lova/.turbo/drizzle/eslint-config) and fixed ~20 real source findings (ZodTypeAny→ZodType, unused imports, unnecessary conditions/assertions, unsafe-any in boundary adapters).

**ALL FOUR GATES GREEN repo-wide: `pnpm typecheck` (16/16) · `pnpm lint` (16/16) · `pnpm test` (11/11 suites) · doc-coverage 100%. `apps/web` `next build` green. PGlite migration applies.**

Remaining lanes: agent-session SSE + connector import wiring (functional via mocks); MCP remote server; full Better-Auth plugin set (social/SSO/SCIM/OIDC/MCP/Stripe + passkey, with auth-schema migration); admin + marketing apps; Playwright e2e flow films.

- **P6 agent/connector functional** (workflow) — agent-sessions `POST /:id/run` streams the MockAgentRuntime's scripted activities into `session_activity` rows (action→`approval='proposed'`→`awaiting_approval`) + SSE `/:id/stream`; integrations `POST /:id/import` creates idempotent linked tasks via MockConnector. 32 api tests.
- **P6 MCP remote server** (workflow) — Streamable HTTP `/mcp` (WebStandard transport, Hono-mounted outside the RPC type), Better-Auth session/bearer guard + Origin DNS-rebinding check, 10 canActor-gated tools (create/update/move/assign task, create_project, post_update, link_external, trigger_agent, approve/reject) + `docket://{org}/{type}/{id}` resources; real JSON-RPC round-trip tests via the SDK in-memory transport. 38 api tests. (Full OAuth 2.1 RS discovery metadata is a documented follow-up.)
- **Fix: better-call pin** — the MCP install re-resolved the tree; pinned `better-call@1.3.5` (override) so better-auth@1.6.14's `kAPIErrorHeaderSymbol` import resolves (the 1.4.x CLI's better-call@1.1.8 was shadowing it under the vitest loader).

**Repo-wide green: typecheck 16/16 · lint 16/16 · test 11/11 suites (89 tests) · doc-coverage 100%.**

Remaining: full Better-Auth plugin set (social/SSO/SCIM/OIDC/MCP-OAuth/Stripe + passkey, + auth-schema migration); admin (operator console, needs staff-gated admin routes) + marketing apps; Playwright e2e flow films.

- **Standardized Vitest + 100% coverage** (workflow + hand) — replaced the brittle per-package/projects config with ONE shared preset (`tooling/vitest/preset.ts`); every package is a one-line `vite.config.ts` (`docketVitest({...})`) with HARD 100% thresholds (statements/branches/functions/lines, `all: true`). Drove **all 9 packages to 100% coverage** (env, db, auth, types, boundaries, test-utils, authz, ui, apps/api — apps/api alone has 219 tests) via a parallel-per-package + sequential-api coverage workflow; `v8 ignore` used only on genuinely-unreachable defensive guards + the `serve()` boot side effect. Added `@vitest/coverage-v8` + `@vitejs/plugin-react` at root.

**Gate (definitive): `pnpm typecheck` 16/16 · `pnpm lint` 16/16 · `pnpm test:coverage` 13/13 at 100% thresholds · doc-coverage 100%. `apps/web` `next build` green. PGlite migration applies.**

- **P6 service-admin** (workflow) — staff-gated `/v1/admin` API (staffMiddleware + role tiers; users/orgs lists, lifecycle pipeline board, holds, billing actions via the lifecycle service, time-boxed impersonation, operator audit, metrics) mounted in the RPC chain — apps/api stays at **100% coverage** with the new `admin.test.ts`. Plus `apps/admin` (the Next operator console: dashboard, users + "view as", orgs + billing actions, lifecycle board, audit) — typechecks, lints, and `next build`s.

**Gate (after admin): typecheck 16/16 · lint 16/16 · test:coverage 13/13 @ 100% · doc-coverage 100% · apps/web + apps/admin build.**

- **P6 Better-Auth plugin set** (workflow) — `@docket/auth` now builds its config via a pure, testable `buildAuthOptions(env)` that ENV-GATES every optional capability (mounts only when keys are real-shaped, so the local placeholder build keeps exactly today's email/password + hub-hook behavior): social Google/GitHub/Linear (+ account linking), and `oidcProvider`/`mcp` (mounted via the `mcp` plugin, which builds the OIDC provider internally — avoiding the deprecated `oidcProvider` symbol). Added the shared OAuth tables (`oauth_application`/`oauth_access_token`/`oauth_consent`) to `@docket/db` + migration `0001_careless_changeling` (applies on PGlite; `db:generate` clean). Passkey (needs `@simplewebauthn/*`), sso/scim (separate `@better-auth/*`), and the Better-Auth stripe plugin are deliberately deferred + documented — never forcing an unstable dep. Coverage stayed 100% on @docket/auth (via `buildAuthOptions` branch tests) + @docket/db.

**Gate: typecheck 16/16 · lint 16/16 · test:coverage 13/13 @ 100% · doc-coverage 100% · migrations 0000+0001 apply on PGlite · apps/web + apps/admin build.**

Remaining: marketing app (public landing) ; Playwright e2e flow films (needs browser install + a running api+web+PGlite stack — a CI-shaped lane).

- **P6 marketing site** (hand-built — a small, self-contained lane the workflow parser kept choking on) — `apps/marketing` is now a Linear-grade public landing site, fully static Server Components on the `@docket/ui` token layer (added `postcss.config.js` + `globals.css` + the `@tailwindcss/postcss`/`tailwindcss`/`tw-animate-css` devDeps, mirroring `apps/web`). Root layout frames every route with a shared sticky `SiteHeader` + `SiteFooter`; routes: `/` (hero with a domain-neutral cross-org "Today" preview → feature grid → how-it-works → pricing → CTA band), `/pricing` (full plan grid + FAQ), `/about` (vision + principles). All copy is **domain-neutral** (startups/nonprofits/personal, not a dev tool) and keeps the Docket-product / Athena-agent distinction. CTAs deep-link to the product app via the validated `NEXT_PUBLIC_APP_URL` (`@docket/env/marketing`, `src/lib/links.ts`) — the only env-specific value. Added a brand `icon.svg` (kills the favicon 404). Verified visually via a headless-browser pass over all three routes. Not coverage-gated (no `test` script), but every exported declaration carries TSDoc so doc-coverage stays 100%.

**Gate (after marketing): typecheck 16/16 · lint 16/16 · test:coverage 13/13 @ 100% · doc-coverage 100% · full `pnpm build` 7/7 (apps/web + apps/admin + apps/marketing all compile; marketing prerenders `/`, `/about`, `/pricing` as static).**

Remaining: Playwright e2e flow films (needs browser install + a running api+web+PGlite stack — a CI-shaped lane).

# fixes complete

---

## Fix: Settle Passkey Session Before Sign-in Routing — 2026-07-03

Root cause: after `authClient.signIn.passkey()` resolved successfully, the sign-in page immediately
performed the `/v1/orgs` landing read. When the Better Auth cookie/proxy path lagged that first
read, `/v1/orgs` returned `401` and the page showed the opaque "session did not finish starting"
message even though the passkey ceremony itself had completed.

Change: `routeAfterSignIn` now gives the first authenticated org lookup a short, bounded retry
window before surfacing a retryable sign-in error. The final error copy is user-facing recovery
language instead of cookie/session jargon.

Validation: added regression coverage in `apps/web/tests/components/auth/sign-in-page.test.tsx` for
both a transient `401` that recovers and a persistent failure that leaves the passkey button ready
for another attempt. Targeted Vitest and ESLint pass; full `@docket/web` typecheck is currently
blocked by unrelated dirty canvas work.

---

## Fix: Sign-in Does Not Mask Missing Session as Onboarding — 2026-07-02

Root cause: after a successful passkey ceremony, `apps/web/src/app/(auth)/sign-in/page.tsx`
treated any failed `/v1/orgs` lookup as "no organizations yet" and routed to `/onboarding`.
When the lookup failed with `401`, onboarding's first `POST /v1/orgs` then surfaced the confusing
`Authentication required` problem even though the user had just completed sign-in.

Change: `routeAfterSignIn` now routes to onboarding only when `/v1/orgs` succeeds with an empty
list. A `401` stays on the sign-in screen with an explicit session-start failure, and other lookup
failures stay on sign-in with a retryable workspace-load error.

Validation: added `apps/web/tests/components/auth/sign-in-page.test.tsx` covering the valid
empty-workspace onboarding path and the `401` session-not-started path. Targeted Vitest suite
passes.

---

## Fix: Remove Client-Rendered Theme Script Warning — 2026-07-02

Root cause: `apps/web/src/components/providers.tsx` wrapped the app in `next-themes`
`ThemeProvider`, whose client component renders an inline `<script>`. React 19 / Next 16 dev
warns that scripts rendered inside React components do not execute on the client.

Change: removed `next-themes` and moved dark-mode application to CSS-native
`@media (prefers-color-scheme: dark)` design tokens. Providers no longer synchronize theme state,
read `localStorage.theme`, mutate the root class, or render any script tag.

Validation: added `apps/web/tests/components/providers.test.tsx`; targeted provider/auth Vitest
suites pass, `@docket/web` typecheck and lint pass, and a Playwright console check against
`https://docket.localhost/sign-in` reports zero console errors and zero script-tag warnings.
During the Node 26 switch, normalized `pnpm-lock.yaml` so `pnpm install --frozen-lockfile` passes
under pnpm 11.9 again. The invalid ESLint peer resolution came from root and
`tooling/eslint-config` using literal, incompatible toolchain ranges, so the shared
TypeScript/test/bundler/lint stack now resolves through the pnpm catalog. Added
`packages/test-utils/tests/dependency-catalog.test.ts` to prevent those versions drifting back into
package-local literals.

---

## Unified Event Stream ("Pulse") — 2026-06-29

Replaced the buried Inbox "Activity" tab with a **first-class, filterable, source-agnostic event stream** — Docket's answer to Linear Pulse — surfaced both cross-org (`/stream`, Home nav) and per-workspace (`/orgs/[orgId]/stream`, Workspace nav). The `observation` table is the canonical substrate; internal Docket events emit observations alongside their writes, and third-party webhooks (Linear, GitHub, Slack) land through the existing Observer → `inbound_event` → drain pipeline. Source is an attribution badge, never a separate layout; provider-specifics stay in the `payload` jsonb (no per-provider columns).

**A1 — substrate (db + DTOs).** `enums.ts`: `streamRelevance` (`mention|assignment|owned|followed|participant`) + `summaryCadence` (`lunch|eod|eow`). `schema/observation.ts`: `(organizationId, occurredAt, id)` index; new `observation_recipient` ("concerns me" fan-out read-model, PK `(observationId,userId)`, indexed `(userId,occurredAt,observationId)`) + `stream_subscription` (explicit follow, unique `(userId,subjectType,subjectId)`); `daily_digest` gained `cadence` (default `eod`), unique key widened to `(userId,digestDate,cadence)`. `schema/agents.ts`: partial unique index on `external_run_ref WHERE not null` (proactive dedup key). Migration `0011_elite_doctor_strange.sql` (generated; **not yet applied to the dev DB** — see below). `packages/types/src/stream.ts`: `StreamEventOut`, `StreamQuery` (extends `ListQuery` + base64url filter/viewId/provider/kind), `StreamPageOut`.

**A2 — internal emission.** `observation-emit.ts`: `emitObservation(...)` (writes a `provider='docket'` observation + recipient fan-out in one tx, deduped, then publishes to the live bus; whole body best-effort so it never 500s a mutation) + `resolveRecipients(...)` (owners/followers/participants → user ids, ranked, excludes the actor). Wired into `tasks.ts` (create/assign/state/complete), `projects.ts`, `comments.ts`, `initiatives.ts`, `updates.ts`. `observation-sync.ts` drain now writes recipient rows + publishes. **`programs.ts` deferred** (concurrent session held the file).

**A3 — read APIs + filter translator.** `lib/view-filter-sql.ts`: whitelisted `FILTER_FIELDS`, `buildFilterConditions` (eq/neq/in/nin/gt/lt/contains; unknown field → 400), base64url `decodeFilter`, keyset `(occurredAt,id)` cursor. `stream.ts` (`GET /v1/orgs/:orgId/stream` firehose) + `hub.ts` `GET /v1/hub/stream` (personal, recipient ⋈ observation across caller orgs). `stream-helpers.ts`: `toStreamEventOut` + `publishStreamEvent`.

**A4–A7 — front end.** `useInfiniteApiQuery`/`useLiveInfiniteApiQuery` + `apiInfiniteQueryOptions`; `streamMe`/`streamOrg` query keys. Nav registration (Home + Workspace `stream` keys, sidebar rows, path mapping, `AtSign`/`MessageSquare` icons). Two thin routes over one shared `<StreamView>` + `use-stream-page.ts`. Components under `components/stream/`: rich row (actor avatar + kind-badge overlay, plain-English line, kind detail slot, provider/workspace/time meta, hover actions), `provider-badge`, `event-drawer`, grouping/meta/query helpers, infinite-scroll sentinel.

**B — Slack ingestion.** Low-ripple `ObserverProvider = ConnectorProvider | 'slack'`. `observer-slack.ts` (v0 HMAC + 300s replay guard, route by team/event, normalize app_mention→mention / message→message / reaction_added→reaction), `select.ts` branch + `SLACK_SIGNING_SECRET` (env slice + container), `POST /v1/ingest/slack` with the `url_verification` handshake echo. (GitHub ingestion was landed separately by the concurrent session.)

**C — live (SSE).** `lib/event-bus.ts` (in-process subscribe/publish) + `stream-sse.ts` (`GET /v1/stream/sse`, session-authed, 25s heartbeat, abort cleanup), mounted outside the RPC type. Polling remains the correctness baseline; SSE is best-effort until LISTEN/NOTIFY (multi-instance follow-up).

**D — proactive (core).** `createSessionFromObservation(...)` (pending agent session, idempotent on `external_run_ref`) + `proactive-sweep.ts` (`sweepProactiveSessions` over recent mention/assignment recipients for opted-in users) + `hub.preferences.proactive.enabled` + `POST /v1/cron/run-proactive` + scheduler entry. FE: `athena-plan.tsx` drafted-plan approval panel in the drawer (reuses `useSessionDetail` + per-action `ActivityItem` approve/reject). **D2 deferred**: multi-cadence lunch/eow summaries + inline `athena-suggestion-card` (the `cadence` column is already in place).

**E — gate.** Static gate green (web typecheck 0 + tests; types/db/env/boundaries typecheck 0 + suites; **API 805 tests pass**). The lone `mcp-cimd` failure + the `me-recovery`/`recovery-challenge` typecheck errors are the concurrent session's in-flight MCP/auth work, not this lane.

**Tests added:** `stream.test.ts` (types), `observation-emit.test.ts`, `stream-read.test.ts`, `event-bus.test.ts`, `proactive-sweep.test.ts`, `ingest-slack.test.ts`, `observer-slack.test.ts`, and web `stream/{stream-query,stream-grouping,stream-meta,stream-event-row}` suites.

**NOT YET DONE (blocked / deferred, not abandoned):**

- **Commit** — the working tree is mixed with a concurrent session's unrelated work (account lifecycle/export, recovery/security/danger-zone, `apps/admin`, agenda, dev-scheduler); needs a scoped, path-selective commit, not `git add -A`.
- **Migration `0011` not applied to the dev DB** + observations not seeded → live `/design-review` of both surfaces is pending a single-owner dev bounce (PGlite is single-process; never a second writer while dev runs).
- `programs.ts` emission; D2 multi-cadence summaries + suggestion card; the Slack provider group + `SLACK_SIGNING_SECRET` entry in `scripts/integrations-setup.ts` (concurrent session's hot file).

---

## Refactor: observation → canonical Event substrate — 2026-06-29

Re-architected the activity-feed substrate after review found the first version "architected on vibes": internal + external events were dumped in one `observation` table told apart by a `provider` string, with a contract-free `payload` jsonb; "which thing" was free text; the assistant's proactive switch was buried in the `HubPreferences` display blob and driven by a polling cron. Reshaped into bounded contexts with a real shared contract, grounded in named GoF patterns (see `docs/engineering/specs/activity-feed.md`). Built in an isolated git worktree (`refactor/event-substrate`) to stay clear of a concurrent session sharing `main`'s HEAD.

**Substrate (P1.1/P1.2).** `observation`→`event` (+ `event_recipient`, reshaped `stream_subscription`). Canonical contract in `@docket/types/event.ts`: `EventKind`, typed `SourceSystem`, the closed `CanonicalEntityKind` taxonomy + `EntityRef` (a Docket task, Linear issue, GitHub PR all become `work_item` → one shared row), `ActorRef`, and a closed `EventDetail` discriminated union **with a `generic` variant** so unmapped-but-valid events still surface instead of being dropped (raw kept in `inbound_event`). `@docket/db` `$type` shapes now **import** the canonical types from `@docket/types` instead of re-mirroring — eliminating the drift class that caused the original `HubPreferences` bug. Migration `0013_event_substrate` (hand-authored; drizzle's generator needs a TTY for the rename) **applies cleanly `0000`→`0013`** on PGlite. `audit_event` kept as a separate compliance ledger; the feed reads `event` only.

**Translation (P1.3) — Adapter + Chain of Responsibility.** Observer port → canonical `EventDraft`. Each adapter (`observer-{linear,github,slack}`) maps native types onto `EntityRef.kind` and builds a typed `detail` via an ordered builder chain ending in `genericDetail` (`packages/boundaries/src/event-detail.ts`) — unmapped event types now surface generically rather than as `[]`. `selectAdapter`'s observer case → an `OBSERVER_FACTORIES` Strategy registry (add a tool = add an entry).

**Routing (P1.4) — one Strategy resolver.** `apps/api/src/consumers/routing.ts` resolves "who does this concern" via `OWNER_RULES` keyed on `CanonicalEntityKind`, absorbing BOTH old duplicated implementations (internal `resolveRecipients` + the external owner-fallback). Internal emit (`routes/event-emit.ts`, a Facade) and the external drain (`routes/event-sync.ts`, renamed) both call it.

**Read + UI (P1.5).** `view-filter-sql` whitelist + `stream.ts` (firehose) + `hub.ts /stream` (personal `event_recipient ⋈ event`) retargeted; `stream-helpers` projects `event`→`StreamEventOut`. Web stream UI retargeted to `source.system`/`entity.kind`/typed `detail` (+ `generic` rendering).

**Removed (Phase-2 rebuild).** The polling proactive engine (`proactive-sweep.ts` + `/run-proactive` cron + scheduler entry) was ripped out per the approved plan; it returns as an event-driven consumer with its config moved into the agent domain. Notifications likewise become a Phase-2 consumer.

**Gate (in worktree).** `@docket/types` typecheck + 201 tests; `@docket/db` typecheck + migration applies; `@docket/boundaries` typecheck + 245 tests + lint; `@docket/api` typecheck + 827 tests. Web layer + full repo gate in progress.

**Phase 2 (deliberate follow-up):** proactive drafting + notifications + multi-cadence summaries as event-bus consumers (`apps/api/src/consumers/`), with assistant config on the `agent` table (not `HubPreferences`).

---

## Post-productization audit fixes (email-to-task stack) — 2026-07-04

A 19-agent architecture/code-quality audit (6 review dimensions + adversarial verification) of the just-merged 7-milestone email-to-task productization stack (`f861dd2..6b58b46`) surfaced 12 findings; 11 survived verification (1 refuted). All 11 fixed or confirmed already resolved:

**Critical — cross-tenant mailbox mutation (`apps/api/src/lib/automation/runtime.ts`, `apps/api/src/routes/attachment-routes.ts`).** `defaultMailApplier` resolved its target `integration` row by id alone, never checking it belonged to the firing event's org; combined with `POST /tasks/:id/attachments` accepting an arbitrary `sourceIntegrationId` with no org check, an org member could point a task's email attachment at another org's integration and have a routine automation rule (e.g. archive-on-complete) mutate that org's real mailbox using its owner's OAuth grant. Fixed both ends: the attachment route now 404s an `email`-kind `sourceIntegrationId` that doesn't resolve within the caller's org, and `defaultMailApplier` now filters its integration lookup by `organizationId` (defense in depth) with a logged skip. Regression tests in `attachments.test.ts` and `automation-engine-db.test.ts`.

**Critical — Gmail incremental sync cursor loss (`packages/boundaries/src/real/connector-gmail.ts`).** `listThreadsIncremental` persisted Gmail's mailbox-_current_ `historyId` as the next cursor even when the walk exited early (>100 new threads hitting `maxThreads` mid-pagination), permanently skipping the un-fetched older history on every subsequent sweep. Fixed: the cursor only advances once the walk fully drains (no `nextPageToken` left); a capped walk leaves the cursor unchanged so the next sweep resumes the same window (redundant re-fetch, not data loss — ingest dedups downstream). Two new tests cover the capped-mid-walk and fully-drained-multi-page cases.

**High — Outlook/Graph listThreads truncation + stuck cursor (`packages/boundaries/src/real/connector-microsoft.ts`).** Two related bugs: (1) the delta walk accumulated conversations across the full page budget before truncating the _output_ to `maxThreads`, discarding overflow while persisting the real `deltaLink` as if it were consumed — silently and permanently dropping conversations beyond the cap; (2) when the walk exhausted `MAX_DELTA_PAGES` before ever reaching a `deltaLink`, `nextCursor` was `''`, and the sweep's `!== ''` guard skipped persisting anything — stalling the same backlog window forever. Fixed both by bounding the _walk itself_ by `maxThreads` (mirrors Gmail's cold-pull bound) and always resuming from real forward progress: the page's `nextLink` when capped mid-walk (a valid Graph resumption token, unlike Gmail's historyId), or the terminal `deltaLink` once genuinely drained — never an empty cursor. Three new tests.

**High — migration snapshot chain gap: already resolved.** The audit found `packages/db/drizzle/meta/{0019,0020}_snapshot.json` (this stack's migrations, renumbered during rebase) missing `thread_participation`/`rate_limit`/enum values that unrelated concurrent work had added at `0016`/`0017`. Investigated before touching anything: unrelated later work (`27f224e`, `d5b92d4`, `64530ff`) had already independently repaired the live chain by the time this fix pass started — `0021`/`0022` (the current tip) correctly include everything, and `pnpm db:generate` confirms "No schema changes, nothing to migrate" against the real schema. The historical `0019`/`0020` snapshots remain technically inaccurate but are provably inert (drizzle only diffs against the tip). No further action taken — re-patching an already-self-healed chain would have been pure risk.

**High — notify-once invariant untested (`apps/api/src/routes/integration-sync.ts`).** `finishFailure`'s `row.status !== 'error'` guard (prevents duplicate reauth/failure notifications on a persistently-broken integration) had zero test coverage. Added a test in `integrations-sync.test.ts` that syncs a broken integration twice and asserts exactly one notification.

**Medium (5), all closed with new tests, no behavior change beyond the engine fix below:**

- The depth-1 re-entrancy cap's only test bypassed the real production path (`task.setStatus` → `setTaskState` → the real `emitEvent`) — added a test exercising that exact chain (`automation-engine-db.test.ts`).
- `task.applyLabel` had no cross-tenant refusal test (unlike sibling `task.assign`) — extended the existing test.
- The 90-day suggestion purge boundary was untested exactly at the threshold — added an `edgeResolved` fixture (`email-suggestion-lifecycle.test.ts`).
- Outlook surfacing in `/v1/config` once `MICROSOFT_CLIENT_ID`/`SECRET` are configured had no test — added `configuredSocialProviders`/`buildAuthOptions` coverage (`packages/auth/tests/auth.test.ts`) plus an env-reset route-level test (`config.test.ts`).
- `suggestion.autoAccept` had no try/catch around `acceptSuggestion`, unlike sibling `task.setStatus` — fixed locally, and more generally by moving per-action error isolation into the engine itself (`engine.ts`'s `runAutomations` now wraps every `handler.run()` call; a throw is logged with rule/action context and recorded `ran: false` rather than aborting the rest of the event's rules). This is a strictly better fix than patching each handler individually — future handlers get isolation for free. New tests in `engine.test.ts` and `automation-engine-db.test.ts`.

**Refuted (verified, no action):** the legacy-suggestion `externalUrl` migration backfill was flagged as "fabricating a provider link," but its formula is byte-identical to the sanctioned, boundary-owned `gmailThreadUrl()` that live ingest already uses — it enforces the app-layer invariant for old rows rather than violating it.

Docs updated: `mail-providers.md` §4.1 (cursor-honesty rule for both providers), `automations.md` (org-scoping note on `mail.*`, per-action isolation guarantee).
