# Cloudflare Athena execution

## Purpose

Production can hand personal Athena generations to Cloudflare Queues and Workflows while Docket
keeps all authoritative state, authorization, prompts, transcripts, credentials, and tool effects
in Postgres and the API process. Local and test modes always use the existing synchronous path.

The boundary carries exactly three values:

```json
{ "sessionId": "...", "generation": 1, "workflowId": "...:1" }
```

The deterministic Workflow id is `sessionId:generation`. Prompts, user ids, workspace ids, tool
inputs, provider credentials, and MCP credentials must never be added to this message.

## Runtime flow

1. Docket locks the Athena owner and session, enforces owner concurrency, and commits a new
   `agent_session_run` row with `status='queued'`.
2. Docket signs `POST /enqueue` with the Docket-to-Cloudflare secret. The runner authenticates the
   complete method/path/body/timestamp/nonce request and asks Docket to persist the authenticated
   nonce before it sends the opaque message to Queue.
3. The Queue consumer creates `docket-athena-execution` with the deterministic instance id.
   Duplicate Queue delivery resolves the existing instance and is acknowledged; transient failures
   retry that message independently and eventually move to the DLQ.
4. The Workflow signs `POST /internal/athena/execution/advance` with the separate
   Cloudflare-to-Docket secret. Docket claims only the exact queued generation, restores the owner
   from Postgres, and runs one existing generation quantum behind its lease fence.
5. A completed quantum commits the next queued generation before the Workflow dispatches it. A
   terminal session ends. Approval or input settles the run as `waiting` and the Workflow enters a
   durable event wait.
6. An owner decision or reply is committed in Docket first, then signed `POST /wake` delivers a
   `docket_wake` event. The Workflow calls Docket again; Docket creates the next generation and the
   Workflow dispatches it.

Cloudflare limits one `waitForEvent` timeout to 365 days. The Workflow uses deterministic yearly
wait epochs and starts another epoch after timeout, so this infrastructure limit is not a Docket
job-duration limit. See Cloudflare's current [event wait documentation](https://developers.cloudflare.com/workflows/build/waiting-for-events/)
and [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/).

## Resource contract

The checked-in [`wrangler.jsonc`](../../apps/runner/wrangler.jsonc) declares:

| Resource | Name                      | Purpose                                        |
| -------- | ------------------------- | ---------------------------------------------- |
| Worker   | `docket-athena-runner`    | Signed ingress, Queue consumer, Workflow class |
| Queue    | `docket-athena-runs`      | Opaque persisted generation messages           |
| DLQ      | `docket-athena-runs-dlq`  | Messages exhausted after five delivery retries |
| Workflow | `docket-athena-execution` | One durable instance per run generation        |

Queue delivery is at least once. The implementation therefore uses per-message acknowledgement,
deterministic Workflow ids, Docket generation uniqueness, and replay-safe callbacks rather than
assuming a message is delivered once. The configuration follows Cloudflare's current [retry and
batching contract](https://developers.cloudflare.com/queues/configuration/batching-retries/) and
[dead-letter queue guidance](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).

## Configuration and secrets

Docket API configuration:

```dotenv
ATHENA_ASYNC_RUNNER_ENABLED=true
CLOUDFLARE_ATHENA_RUNNER_URL=https://docket-athena-runner.<account>.workers.dev
CLOUDFLARE_TO_DOCKET_HMAC_SECRET=<32-or-more-random-characters>
DOCKET_TO_CLOUDFLARE_HMAC_SECRET=<different-32-or-more-random-characters>
```

Runner secrets/vars are shown in [`apps/runner/.dev.vars.example`](../../apps/runner/.dev.vars.example).
The two HMAC values must be distinct and the matching directional value must be identical on both
sides. Do not put either secret in `wrangler.jsonc`, Queue messages, logs, or repository files.

Production boot fails when the feature is enabled without the runner URL and both distinct secrets.
`APP_MODE=local|test` stays synchronous even if the feature flag is accidentally true.

## Provision and deploy

These are operator commands, not repository validation commands. They create or mutate Cloudflare
resources and must be run only for the intended account after reviewing `wrangler whoami` and the
active Wrangler profile.

```bash
cd apps/runner
pnpm exec wrangler queues create docket-athena-runs
pnpm exec wrangler queues create docket-athena-runs-dlq
pnpm exec wrangler secret put DOCKET_TO_CLOUDFLARE_HMAC_SECRET
pnpm exec wrangler secret put CLOUDFLARE_TO_DOCKET_HMAC_SECRET
pnpm exec wrangler secret put DOCKET_API_URL
pnpm exec wrangler deploy
```

`DOCKET_API_URL` is operational configuration rather than a credential, but it is stored as a
Worker secret so production origin changes do not require committing an environment-specific URL.
Deploy creates/updates the Worker and declared Workflow binding; the Queue and DLQ must already
exist.

## Validation without deployment

```bash
pnpm --filter @docket/runner test
pnpm --filter @docket/runner typecheck
pnpm --filter @docket/runner lint
pnpm --filter @docket/runner wrangler:dry-run
pnpm --filter @docket/runner wrangler:startup
```

Wrangler generates [`worker-configuration.d.ts`](../../apps/runner/worker-configuration.d.ts) from
the checked-in configuration. `wrangler types --check` fails when it drifts. The local test pool
uses the same configuration and current Workers runtime. Refer to the current [Wrangler
configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/) and
[Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
when upgrading.

## Operations and recovery

- A growing DLQ means the original Docket rows remain authoritative. Inspect the Docket run status,
  Worker structured logs, Queue message attempts, and Workflow instance status before replaying.
- Retrying a queued Docket request reuses the same queued generation. Retrying a Workflow callback
  returns the already-persisted wait, terminal state, or successor generation. If that callback
  finds its exact generation still `running` with an expired lease, it reclaims the row with an
  incremented attempt and a new fencing token; a fresh lease remains unavailable, and the prior
  token cannot commit transcript, activity, or tool-effect state.
- Never replay an `executing` action automatically. That state is the existing non-repeatable MCP
  dispatch boundary and requires human attention after interruption.
- Rotate secrets one direction at a time with a coordinated Docket/Worker update. Requests signed
  with the previous value fail closed; there is intentionally no implicit dual-secret window.
- Disable `ATHENA_ASYNC_RUNNER_ENABLED` to route new personal mutations synchronously. Existing
  queued and waiting Workflows still need to be drained or deliberately retired.

## Teardown

Teardown is destructive and deletes pending messages or Workflow instances. Disable the Docket
feature flag first, inspect/drain the Queue and DLQ, and retain database rows for audit/recovery.

```bash
cd apps/runner
pnpm exec wrangler queues pause-delivery docket-athena-runs
pnpm exec wrangler workflows delete docket-athena-execution
pnpm exec wrangler delete docket-athena-runner
pnpm exec wrangler queues delete docket-athena-runs
pnpm exec wrangler queues delete docket-athena-runs-dlq
```

No provisioning, deployment, secret mutation, or teardown command is part of normal CI.
