# External Agent Interoperability Implementation Plan

> **Reader:** The engineer implementing and reviewing Athena's external agent boundary. The reader
> must complete the Linear tasks in order, preserve the durable-core invariants, and withhold
> Linear from production until its sandbox gate passes. Slack, GitHub, and Jira remain typed
> architecture targets rather than product implementations in this slice.

**Goal:** Let a person start, continue, approve, authenticate, stop, and receive Athena work from
Linear, Slack, GitHub, or Jira Rovo without adding a second execution queue or weakening Docket
authorization.

**Architecture:** Provider adapters own signature verification, strict wire schemas, canonical
normalization, native rendering, and publishing. `inbound_event` owns webhook deduplication and
leasing. `agent_session_run` owns model execution. `session_activity` owns the canonical transcript.
`agent_session_external_link` owns one provider origin and the independent outbound cursor. The
generic registry keeps provider wire types paired at compile time. The database and session core
remain provider-neutral.

**Stack:** TypeScript, Zod, Hono, Drizzle/PostgreSQL, Vitest, Slack Web API, GitHub App REST API,
Linear Agent GraphQL API, and A2A 1.0 JSON-RPC.

The approved design is
[`2026-08-28-external-agent-interoperability-design.md`](../specs/2026-08-28-external-agent-interoperability-design.md).

## Task 1: Add the typed adapter boundary

**Files:**

- Create `packages/integrations/src/agent-surface.ts`.
- Create `packages/integrations/src/agent-surface-linear.ts`.
- Create `packages/integrations/src/agent-surface-slack.ts`.
- Create `packages/integrations/src/agent-surface-github.ts`.
- Create `packages/integrations/src/agent-surface-jira-a2a.ts`.
- Create `packages/integrations/src/agent-surface-registry.ts`.
- Create `packages/integrations/tests/providers/agent-surface-contract.test.ts`.
- Modify `packages/integrations/src/index.ts`.

1. Write a failing contract test that imports all four adapters, checks their capability manifests,
   verifies representative signed payloads, normalizes every canonical event variant, and renders
   every activity/control variant.
2. Run `pnpm --filter @docket/integrations test -- agent-surface-contract.test.ts --maxWorkers=2`
   and confirm the imports fail.
3. Add `AgentSurfaceProvider`, `SurfaceTypeFamily`, `AgentSurfaceRegistry`, `SurfaceTypes`,
   `AgentSurfaceAdapter`, `CanonicalAgentEvent`, `CanonicalAgentActivity`, and the supporting
   references and capability types. Export every public type with TSDoc.
4. Implement strict Zod schemas after signature verification. Keep each provider's wire types in
   its adapter file. Do not put provider types in the canonical module.
5. Define `agentSurfaceAdapters` with `satisfies` and implement `agentSurfaceFor<P>()` without a
   cast at call sites.
6. Run the focused test, package typecheck, lint, and Prettier check.

## Task 2: Generalize the durable external link

**Files:**

- Modify `packages/db/src/schema/agents.ts`.
- Add the next generated file under `packages/db/drizzle/` and update its metadata.
- Create `packages/db/tests/migrations/external-agent-link-migration.test.ts`.
- Modify schema completeness tests when the new indexes require coverage.

1. Write a failing migration test that upgrades a link with `external_issue_id`, preserves its
   value as `external_work_item_id`, adds relay state, and rejects duplicate
   `(provider, external_workspace_id, external_session_id)` ownership.
2. Run the focused database test and confirm the missing migration fails.
3. Rename the issue field. Add `relay_status`, `relay_attempts`, `next_relay_at`,
   `last_relay_error`, and `updated_at`. Add the provider-session unique index and retry-due index.
4. Generate the Drizzle migration. Inspect the SQL and snapshots. Do not hand-edit generated
   metadata.
5. Run the migration test, database typecheck, lint, and the database test suite with two workers.

## Task 3: Put external agent deliveries through the shared inbox

**Files:**

- Create `apps/api/src/lib/external-agent-inbox.ts`.
- Create `apps/api/src/routes/ingest-agent-surface.ts`.
- Create `apps/api/src/routes/external-agent-sweep.ts`.
- Create `apps/api/tests/lib/external-agent-inbox.test.ts`.
- Create `apps/api/tests/routes/ingest-agent-surface.test.ts`.
- Create `apps/api/tests/routes/external-agent-sweep.test.ts`.
- Modify `apps/api/src/routes/event-sync.ts`, `apps/api/src/routes/cron.ts`, and
  `apps/api/src/server.ts`.

1. Write failing tests for exact raw-body verification, installed-workspace routing, duplicate
   delivery acknowledgement, fast 2xx response, lease recovery, canonical processing, and one run
   generation per canonical trigger.
2. Confirm the tests fail because the shared surface route and processor do not exist.
3. Implement one parameterized webhook route. Let the adapter verify first. Insert the verified
   delivery into `inbound_event` with provider names `linear_agent`, `slack_agent`, `github_agent`,
   or `jira_a2a`. Return 2xx after persistence. Never wait for model execution.
4. Extend the inbox sweeper to dispatch external-agent providers to `processExternalAgentEvent`.
   Keep the existing observer normalization path unchanged.
5. Process canonical events transactionally. Resolve the external actor, create or resume the
   session, insert an inbound response once, apply conditional approval or stop transitions, and
   queue one generation only after the canonical state commits.
6. Preserve `external_activity_id` deduplication by deriving a stable source key and checking it
   before inserting the response or applying a control.
7. Run focused tests, API typecheck, lint, and Prettier check.

## Task 4: Make outbound relay independent and provider-neutral

**Files:**

- Create `apps/api/src/lib/external-agent-relay.ts`.
- Create `apps/api/tests/lib/external-agent-relay.test.ts`.
- Modify `apps/api/src/routes/external-agent-sweep.ts` and `apps/api/src/routes/cron.ts`.
- Remove `apps/api/src/lib/linear-agent-relay.ts` after its cases move to the shared suite.
- Modify `apps/api/src/routes/linear-agent-sweep.ts` so it only drives due runs, or remove it when
  the generic sweep owns both phases.

1. Write failing tests for cursor-lagged terminal sessions, updated approval rows, inbound-message
   echo suppression, ordered stop-on-failure behavior, retry backoff, revoked credentials, and
   successful retry cursor advancement.
2. Confirm the tests fail because relay selection still depends on due model runs.
3. Select links whose cursor trails a session activity or whose `nextRelayAt` is due. Build the
   adapter and installed credential by provider. Render and publish rows in `(updatedAt, id)` order.
4. Advance the cursor only after a successful publish or deliberate inbound-row skip. Reset retry
   fields after success. On failure, increment attempts, store application-owned diagnostics, and
   schedule bounded exponential backoff.
5. Mark revoked installations and links errored without exposing provider text to the user.
6. Run focused tests and the bounded API checks.

## Task 5: Close every Linear Agent blocker

**Files:**

- Modify `packages/integrations/src/linear-agent.ts` and its tests.
- Modify `apps/api/src/lib/linear-agent-connect.ts` and its tests.
- Modify `apps/api/src/lib/linear-agent-credential.ts` and its tests.
- Modify `apps/api/src/routes/integrations-linear-agent-oauth.ts` and its tests.
- Replace `apps/api/src/routes/ingest-linear-agent.ts` with the shared route registration and
  migrate its tests.
- Modify `apps/api/src/routes/agent-session-runner.ts` and approval tests only where the canonical
  processor needs a reusable transaction boundary.
- Modify `apps/web/src/components/settings/linear-agent-install-card.tsx` and its tests.

1. Add failing tests for installed organization discovery, workspace id/name/app actor persistence,
   `promptContext` extraction, `created`, `prompted`, `select`, `auth`, and `stop` signals, missing
   identity continuation, native selection rendering, and an independent relay retry after a
   terminal run.
2. Implement Linear's organization/viewer discovery after OAuth exchange. Store the workspace and
   app actor reference on `integration.connection`. Route webhooks by that verified workspace.
3. Normalize the documented `promptContext` into the canonical prompt and guidance. Remove the
   generic mention prompt.
4. Translate Linear signals into canonical approval, authentication, and stop events. Render
   native `select` and `auth` controls with signed opaque values.
5. Keep the external URL update as a strict fast acknowledgement with a timeout. Let the durable
   relay recover its failure.
6. Run all Linear Agent tests and bounded package checks.

## Task 6: Complete two-way Linear issue synchronization

**Files:**

- Modify the Linear `WorkGraphConnector` implementation and tests under
  `packages/integrations/src/` and `packages/integrations/tests/`.
- Modify Linear OAuth scope declarations and connection UI tests.
- Modify API reconciliation tests that currently update only linked tasks.
- Update the Linear integration documentation.

1. Write failing connector tests for issue create, title/body/status/priority/assignee/due-date
   updates, parent/child and blocking relationships, completion, cancellation, retry, and
   idempotency.
2. Write failing OAuth tests that require Linear `write` scope and a reauthorization state when an
   existing grant is read-only.
3. Implement full issue writes through `WorkGraphConnector`. Keep projects, cycles, and label
   definitions inbound-only and reject unsupported outbound mutations with stable error codes.
4. Extend reconciliation to create missing outbound issues and reconcile supported field and
   relationship changes without loops.
5. Run the connector, reconciliation, API, and UI tests.

## Deferred target: Slack Agents

**Files:**

- Extend `apps/api/src/lib/slack-app.ts` and its tests.
- Extend `apps/api/src/routes/integrations-slack.ts` and its tests.
- Register the Slack adapter with the shared route and relay.
- Add Slack agent route, processor, and relay cases to the shared API suites.
- Modify the Slack connection UI and tests.

The shared generic boundary keeps Slack's wire family and capability declaration type-checked.
This implementation does not register Slack credentials, routes, or outbound publication. A later
Slack product slice must do the following work:

1. Write failing tests for Slack URL verification, signature timestamp replay rejection, app
   mentions, direct messages, thread follow-ups, installation routing, channel access checks,
   bot-message echo suppression, Block Kit approvals, account-link buttons, stop controls, status
   updates, and final threaded responses.
2. Expand OAuth scopes for the bot and store bot token, bot user id, team id/name, and installing
   user separately. Preserve the existing user token boundary for observer features.
3. Normalize mention and DM events only after the installation can read the channel. Use the
   thread timestamp as the external session id.
4. Publish progress and results in-thread. Use Block Kit buttons with signed opaque approval and
   stop values. Verify interactive payload signatures through the same inbox.
5. Run all Slack agent tests and bounded package checks.

## Deferred target: GitHub Agent surface

**Files:**

- Extend `packages/integrations/src/github-app.ts` and its tests.
- Extend `apps/api/src/lib/github-app.ts` and its tests.
- Extend `apps/api/src/routes/integrations-github.ts` and its tests.
- Register the GitHub adapter with the shared route and relay.
- Add GitHub cases to the shared API suites and connection UI tests.

The shared generic boundary keeps GitHub's wire family and capability declaration type-checked.
This implementation does not register GitHub agent commands or outbound publication. A later
GitHub product slice must do the following work:

1. Write failing tests for installation routing, HMAC verification, issue and pull-request command
   parsing, comment follow-ups, bot echo suppression, repository permission boundaries, check-run
   progress, requested-action approvals, signed issue-reply fallbacks, stop, and final results.
2. Persist the installation account and app actor reference. Mint installation tokens only for the
   linked installation and repository.
3. Use the issue or pull request node as the external work item. Use its comment thread as the
   external session. Ignore events that do not address Athena.
4. Publish pull-request progress through check runs. Publish issue progress through comments. Use
   `requested_action` buttons where GitHub supports them and signed command links or replies where
   it does not.
5. Run all GitHub agent tests and bounded package checks.

## Deferred target: Jira Rovo A2A 1.0

**Files:**

- Register a Jira A2A endpoint with the shared processor and relay.
- Add Jira configuration and credential helpers under `apps/api/src/lib/`.
- Add Jira A2A API and adapter tests.
- Add the Jira connection surface and tests.

The shared generic boundary keeps Jira's A2A wire family and capability declaration type-checked.
This implementation does not register Jira credentials, callbacks, or outbound publication. A
later Jira product slice must do the following work:

1. Write failing tests for authenticated JSON-RPC messages, task creation, follow-up messages,
   input requests, cancellation, streaming/status artifacts, duplicate request ids, tenant
   routing, and invalid method or schema rejection.
2. Implement the A2A 1.0 request and response schemas. Treat the A2A task id as the external
   session. Translate input requests and cancellation into canonical controls.
3. Publish status, artifacts, authentication URLs, approval requests, and final messages through
   the A2A response or configured callback without changing the durable core.
4. Run Jira contract tests and all shared surface tests.

## Task 7: Linear release gate and documentation

**Files:**

- Update `.env.local`, environment schemas, deployment manifests, and their tests for required
  Linear configuration. Keep Linear disabled by default.
- Update connection setup documentation and operational runbooks.
- Add Linear sandbox scripts or documented commands under `scripts/`.
- Complete `docs/WORKLOG.md`.

1. Add failing environment and deployment-policy tests for per-provider enable flags, webhook
   secrets, OAuth/App credentials, callback origins, and production deny-by-default behavior.
2. Add provider contract drift tests that replay recorded, redacted sandbox fixtures.
3. Run package typechecks, lint, unit/integration tests, migration tests, and production builds with
   concurrency capped at two.
4. Install each provider in a disposable sandbox. Prove start, follow-up, approval, authentication,
   stop, result, duplicate delivery, provider outage, and retry recovery. Capture provider-native
   screenshots where the surface is visual.
5. Enable Linear only after its sandbox proof. Repeat the gate for Slack, GitHub, and Jira in that
   order. Do not enable a preview API in production without a current successful contract probe.
6. Verify the deployed SHA, health, cron execution, inbox drain, relay retries, and one real
   provider round trip. Record blockers when credentials or provider access prevent a gate.
7. Update the worklog with validation, deployment state, live state, open constraints, and
   retrospective. Commit each coherent provider slice with the `agents` scope.
