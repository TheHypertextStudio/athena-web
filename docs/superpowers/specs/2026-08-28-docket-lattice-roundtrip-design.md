# Docket-to-Lattice Mac Studio Round Trip

> **Status**: Approved in conversation; awaiting written-spec review
> **Date**: 2026-08-28
> **Audience**: Athena and Lovelace maintainers who will implement, deploy, and prove this path
> **Required action**: Confirm this boundary before implementation starts in Athena and Lovelace

## Decision

Docket will submit durable Athena work to the owner's selected Lovelace Lattice runtime. The
Lovelace gateway will authorize the owner and forward the encrypted work through the Lattice relay.
The Mac Studio daemon will claim and execute that work with its local LM Studio service. The daemon
will seal the result for Docket's one-use reply key and send it back through the relay. Docket will
open the result and add it to the original task as a reviewable Athena proposal.

The supported path is exactly:

`Docket (Athena) -> Lovelace Lattice -> Mac Studio -> Lovelace Lattice -> Docket (Athena)`

Docket will not fall back to a cloud model when the selected Mac Studio cannot take the work. A
fallback would produce an answer while lying about where it ran. Docket will persist a stable
failure code and show the failure on the Athena session instead.

The container diagram records the deployable services and their network boundaries:
[Docket-Lattice round-trip containers](./diagrams/2026-08-28-docket-lattice-roundtrip-containers.mmd).

## Current Hold-Up

The path does not fail at one hidden switch. Five production boundaries are incomplete or broken
as of August 28, 2026.

First, `https://lattice.uselovelace.com` does not complete a TLS handshake from either the current
machine or the Mac Studio. Its DNS record points at Google-hosted infrastructure, but clients get
an unexpected end of file before HTTP begins. Docket cannot reach the configured gateway until the
Lovelace domain mapping and certificate work.

Second, Docket's current OAuth integration defaults to `https://accounts.uselovelace.com`. That
host returns HTTP 500 for OpenID discovery. Current Lovelace deployment configuration names
`https://auth.uselovelace.com` as the accounts service. The implementation must establish one
canonical issuer and make discovery, authorization, token exchange, callback validation, and
gateway audience checks agree on it.

Third, the Lattice gateway currently supports personal-runtime discovery and OpenAI-compatible
inference. It does not expose a user-authorized controller surface for durable `agent_task` work.
Lovelace already contains the relay controller, reply-key encryption, compute contracts, and a
stdio MCP delegate client. Docket cannot use that MCP client in production because the client
keeps reply keys in a file under one home directory. Docket runs as a scaled service and needs the
same protocol behind a database-backed session store.

Fourth, the signaling service can persist relay state only when `LATTICE_RELAY_STATE_FILE` is set.
Its production Cloud Run configuration sets neither that variable nor a durable volume. The
service also permits scale-to-zero. A restart can therefore lose accepted work, status, and sealed
results. Production delegation needs a database-backed relay store before Docket can trust an
accepted work id.

Fifth, the Mac Studio has LM Studio listening on `127.0.0.1:1234`, and it reports 11 local models.
The machine also has several Lattice daemon processes left running since July. Launchd owns none
of them, and the current Lattice CLI is not installed there. This is not an operable runtime. One
current daemon must run under launchd with one identity, one configuration, health reporting, and
bounded restart behavior.

Athena's current `main` already sends interactive model turns through a selected personal Lattice
runtime. It does not submit durable task work. A recovered C5 branch added a durable scheduler,
idempotency guards, and the proposed-comment return path. Its production adapter was explicitly
`null`, so it never closed the network loop. Its migrations also predate the current database
history. We will port its tested behavior into current `main`; we will not cherry-pick its code or
migrations wholesale.

## Container Design

The Docket API owns the business transaction. It selects an eligible agent-delegated task, records
one delegation, mints the reply key, submits the work, polls the work id, and creates the Athena
proposal. The Docket web app only displays that durable state and controls approval.

The Lattice gateway owns product authorization. It accepts the owner's Lovelace OAuth token. It
checks the delegation scope and account ownership. It then calls the relay controller with an
account-bound internal credential. Docket never stores Lovelace's static relay account token.

The signaling service owns durable transport state. It records work before it returns acceptance.
It lets the registered Mac Studio runtime claim that work. It stores progress and the sealed result
until Docket acknowledges terminal delivery or the retention period expires.

The Mac Studio daemon owns execution. It opens the task with its registered work key. It runs the
requested agent task in an isolated worktree when a repository is present. It uses the allowed
tools and the selected LM Studio model. It seals the terminal result to the reply public key and
posts that result to the relay.

LM Studio owns local model inference only. It does not know about Docket, OAuth, relay leases, or
task approval.

## Docket Delegation Lifecycle

Docket will create one `agent_delegation` row for each attempt. The row will bind the task, owner,
Athena session, Lattice connection, target runtime, logical submission id, external work id,
current work state, encrypted reply-key material, polling schedule, failure code, terminal outcome,
and returned activity id.

The logical submission id will derive from the immutable Docket delegation id. Retrying a timed-out
HTTP request will therefore reach the same relay work item. A partial unique index will allow only
one open delegation for a task. The result claim will require an open status and a null returned
activity id. Those constraints prevent two scheduler ticks from submitting or posting the same
work twice.

The scheduler will run the delegation drain on the existing Athena trigger cadence. One pass will
perform bounded work in this order:

1. It will poll previously submitted delegations whose next-poll time has arrived.
2. It will settle terminal failures with stable codes and retry eligibility.
3. It will create one proposed task comment for each usable terminal result.
4. It will submit a bounded number of eligible agent-delegated tasks.

The scheduler will re-authorize the owner against the workspace and task on every pass. A stale
session will not preserve access after the owner loses permission. The scheduler will only use an
enabled Lattice connection with an explicit runtime id. It will not choose another device.

The returned report will become a `session_activity` action with `approvalStatus: 'proposed'`. The
Athena session will enter `awaiting_approval`. The existing approval path will add the comment to
the task after the owner approves it. The delegation drain will not write task content with a
privileged side door.

## Lovelace Controller Boundary

Lovelace will expose an OAuth-protected delegation controller through the public Lattice gateway.
The gateway contract will cover these operations:

- submit one encrypted `agent_task` to an explicit runtime;
- read work status and the recommended next polling delay;
- read and acknowledge a terminal sealed result;
- cancel work when Docket cancels the owning Athena session.

The request will carry the logical submission id, instruction, acceptance criteria, explicit tool
policy, optional repository reference, execution mode, target runtime id, reply public key, and
Docket trace metadata. The response will carry the stable work id, runtime identity, state,
deadline, and next polling delay.

The gateway will translate the user OAuth grant into an account-bound relay credential. The relay
will reject a runtime outside that account. The gateway will not accept an arbitrary account id
from Docket as proof of ownership.

Lovelace will publish one supported package boundary for the relay controller, crypto, and compute
contracts. Athena currently restates parts of the inference SDK because the upstream package is not
published. Delegation must not add another hand-copied protocol. The published boundary will carry
a changeset and will remain compatible with the gateway's deployed API.

## Authentication And Encryption

Docket will request the narrow Lovelace scopes required to list the owner's personal runtimes and
submit, inspect, cancel, and read that owner's delegated work. Lovelace must document those scopes
before Athena requests them. Existing inference and catalog scopes do not grant task execution by
implication.

Docket will generate a fresh reply-key pair for each delegation. It will send only the public key
with the work request. It will encrypt the private key with Docket's existing credential encryption
before database storage. The API will decrypt it only when it opens a terminal result. Docket will
clear the private key after it records the opened result or terminal failure.

The Mac Studio daemon will open the work with its registered runtime work key. It will seal the
result with the reply public key. The relay and gateway will transport ciphertext. They will not
need Docket's private key or the plaintext result.

Logs will include opaque delegation and work ids. Logs will not include OAuth tokens, private keys,
full task descriptions, model prompts, or plaintext results.

## Relay Durability

The signaling service will replace its production process-local relay map with a durable store.
The store must support atomic create-if-absent by account and logical submission id, runtime claim
leases, lease expiry, progress updates, terminal-result writes, result acknowledgement, cancellation,
and retention cleanup.

The relay will persist accepted work before returning HTTP success. It will preserve work across a
Cloud Run restart and scale-to-zero cycle. Two service instances must not let two runtimes claim the
same lease. A repeated submission with the same logical id must return the original work id and
must not enqueue a duplicate.

The initial retention policy will keep unacknowledged terminal results for seven days. It will keep
acknowledged metadata for 30 days without retaining plaintext because the relay never receives
plaintext. Those values may change only after production measurements show that they are too short
or too costly.

## Mac Studio Runtime

The Mac Studio will run one launchd job under the personal namespace
`dev.williecubed.lattice-daemon`. The job will start the current Lovelace daemon in foreground mode.
Launchd will restart it after a crash with a bounded backoff. The daemon will use one registered
runtime identity and will report its current version, selected model, work-key id, and last relay
heartbeat.

The cleanup will stop the stale unmanaged daemon processes only after the managed job passes a
health check. The current dirty Lovelace checkout will remain untouched until its four tracked
network changes are reviewed and preserved on a branch. The runtime install will come from a
validated Lovelace commit rather than from that dirty checkout by accident.

An `agent_task` with a repository reference will execute in one isolated worktree under a bounded
directory. The daemon will enforce the submitted tool policy. It will cap concurrent agent tasks at
one on this 16 GB machine while Chrome, Postgres, Redis, and LM Studio remain active. A reasoning-
only task without a repository may run without a worktree, but it will retain the same lease,
timeout, logging, and sealing rules.

## Failure Contract

Docket will persist stable failure codes rather than provider prose. The first implementation will
distinguish at least `oauth_invalid`, `scope_missing`, `runtime_not_found`, `runtime_offline`,
`runtime_key_expired`, `submission_rejected`, `relay_unavailable`, `unknown_work`, `work_expired`,
`execution_failed`, `result_invalid`, and `result_decryption_failed`.

Transient gateway errors, a temporarily offline runtime, and a live work lease will remain
retryable. An unknown work id, expired work, invalid result, revoked owner access, or unusable key
will settle the attempt. A later scheduler pass may create a new attempt only after the old attempt
is terminal and its cooldown has elapsed.

The Athena activity stream will show Docket-owned copy for each failure class. It will name the
selected Mac Studio when that information is safe to show. It will never render raw relay or daemon
error text.

## Implementation Order

The work will proceed through gates that can each fail without hiding the next problem.

1. Lovelace will fix the gateway TLS mapping and canonical OAuth issuer. Discovery and token
   exchange must pass from both Docket's deployment environment and the Mac Studio.
2. Lovelace will add the durable relay store and prove restart-safe idempotent submission and one-
   claimant leases.
3. Lovelace will expose the OAuth-protected controller contract and publish the supported client
   boundary.
4. The Mac Studio will install one current managed daemon and prove a direct Lovelace controller to
   Studio to controller encrypted round trip.
5. Docket will add the current-schema delegation record, encrypted database session store,
   scheduler drain, proposal return path, and failure UI through behavior-first tests.
6. Staging will prove the complete Docket-to-Studio round trip before any production task runs.
7. Production will use one existing real Docket task that the owner explicitly delegates to
   Athena. The proof will not create a synthetic task, workspace, or account.

## Proof Of Completion

The feature is complete only when one production run provides all of this evidence:

- The Docket task existed before the proof and shows Athena as its delegate.
- One Docket delegation id maps to one Lattice logical submission id and one Lattice work id.
- Lattice records the selected runtime as the owner's Mac Studio.
- The Mac Studio log records that work id, the managed daemon version, and the selected local model.
- LM Studio handles the inference request on `127.0.0.1:1234` while that work lease is active.
- The daemon posts one sealed terminal result through the Lattice relay.
- Docket opens that result and creates one proposed Athena task comment with the delegation id,
  work id, runtime name, outcome, and report.
- A scheduler retry creates neither a second Lattice work item nor a second Docket proposal.
- The authenticated Docket UI shows the returned proposal on the original task. A screenshot records
  that state.

API health, unit tests, relay status, and daemon logs cannot substitute for this correlated proof.
They prove parts of the path. They do not prove the round trip.

## Rejected Alternatives

Docket will not run the existing `lattice-delegate-mcp` stdio server as a production sidecar. Its
file-backed reply-key store assumes one durable home directory. That assumption does not hold for a
scaled Docket service, and a wrapper would hide the missing durable contract rather than fix it.

The Mac Studio will not poll Docket for tasks and post results directly to Docket. That design could
run work on the machine, but it would bypass the required Lovelace Lattice return path and create a
second authentication protocol between Docket and the Studio.

Docket will not send durable task work through the OpenAI-compatible chat-completions endpoint.
That endpoint handles one inference turn. It has no durable work id, claim lease, cancellation,
repository execution policy, or sealed asynchronous result.

Docket will not cherry-pick the recovered C5 branch. That branch contains the right behavioral
shape but no production adapter, and its database history is stale. Current tests will restate its
idempotency and approval guarantees against the present schema.

## Non-Goals

- Shared marketplace compute or automatic routing to another person's machine.
- Silent failover from the Mac Studio to a cloud provider.
- Autonomous approval of returned task mutations.
- More than one concurrent delegated agent task on the Mac Studio in the first release.
- A new scheduler service when the existing Athena trigger cadence can carry bounded delegation
  work.
- Production demo tasks, demo workspaces, or synthetic proof records.

## Rollback

Docket will gate new submissions behind an environment-controlled capability. Disabling it will
stop new submissions while existing rows continue to poll and settle. A second emergency control
will stop polling without deleting rows or keys. The database migration will remain additive.

Lovelace can reject new controller submissions while preserving status and result reads for work
already accepted. The managed Studio daemon can stop claiming new work while it finishes or returns
its active lease. No rollback step will delete relay work or Docket delegation history.

## Open Decisions

The Lovelace maintainers must choose the durable relay store that fits the current production
platform. The store must satisfy the atomic lease and idempotency rules above. The implementation
plan cannot name a database migration until that deployment choice is confirmed from the current
Lovelace infrastructure.

The final delegation OAuth scope names must come from Lovelace's canonical scope registry. Docket
will consume those names after Lovelace publishes them. Docket will not invent provider scope names
in advance.
