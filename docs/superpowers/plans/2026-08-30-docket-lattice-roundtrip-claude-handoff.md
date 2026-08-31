# Docket-to-Lattice Round Trip: Claude Handoff

> **Reader**: The Claude agent taking ownership of the Docket, Lovelace, and Mac Studio release
> **Required action**: Finish the implementation and prove both production round trips without
> changing the completion criteria in the approved design
> **Recorded**: 2026-08-30 in `America/Los_Angeles`
> **Release status**: Not ready to merge in Athena and not proven in production

The approved design remains the authority for behavior and proof:
[Docket-to-Lattice Mac Studio Round Trip](../specs/2026-08-28-docket-lattice-roundtrip-design.md).
This handoff records current implementation and production state. It does not replace the design.

The required path remains:

`Docket (Athena) -> Lovelace Lattice -> Mac Studio -> Lovelace Lattice -> Docket (Athena)`

Docket must never switch to cloud compute when the selected Lattice runtime is unavailable. The
production proof must use the existing task and workspace named below. Do not create demo data.

## Repository state

| Repository | Worktree or checkout                                                      | Branch and state                                                                                                                   |
| ---------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Athena     | `/Users/williecubed/.codex/worktrees/docket-lattice-roundtrip/athena-web` | `codex/docket-lattice-roundtrip`; 11 commits ahead and 0 commits behind `origin/main` after the handoff rebase; zero merge commits |
| Lovelace   | `/Users/williecubed/.codex/worktrees/docket-lattice-roundtrip/lovelace`   | `codex/docket-lattice-roundtrip`, local `main`, and `origin/main` all equal `6615728e13`; zero merge commits                       |
| Cello      | `/Users/williecubed/cello`                                                | `main` equals `origin/main` at `b3a12c876358a46f063a24362677b9cea03f4db5`                                                          |

Every `origin` remote uses SSH. Keep history linear. Athena forbids pull requests. Integrate finished
Athena commits through a rebase and fast-forward or a linear cherry-pick. Do not merge the current
Athena branch into `main`: the cancellation implementation described below is incomplete.

Six Athena safety stashes existed before this handoff. Preserve them. They contain earlier recovery
material and are not part of the current branch.

## Work that is complete on the branches

Lovelace has the public OAuth-protected relay controller, account binding, idempotent submission,
cursor and expiry metadata, durable PostgreSQL relay store, deployment rollout verification, public
SDK contract, generated OpenAPI, Scalar reference content, and the `docket-athena` public PKCE
registration. The reviewed feature tip is `c8b4e0dbe623871e0d499c653c15b2926b1a53fd`.
The production-input correction at `6615728e13` is integrated into Lovelace `main`.

Athena has private `athena_assignment` ownership, durable `agent_delegation` rows, pre-minted work
ids, stable logical submission ids, encrypted reply keys, bounded scheduler submission and polling,
proposal creation, approval settlement, cancellation entry points, terminal acknowledgement, and
no-cloud-fallback routing. The latest committed Athena repair is `5e0a2a074`. The following
branch-head commit preserves the handoff and RED cancellation work.

Before the final review findings, Athena passed 136 focused API tests, 7 database migration and
schema tests, API and database lint and type checks through Turbo, and commit hooks. Those results
do not cover the uncommitted cancellation-intent work in this handoff.

## Athena work that is intentionally incomplete

The handoff commit preserves RED tests and the database shape for durable cancellation intent. It
adds nullable `agent_delegation.cancellation_requested_at`, migration `0116_cuddly_mordo`, the
Drizzle snapshot, and race tests. The runtime implementation in
`apps/api/src/agent/lattice-delegations.ts` has not been changed to satisfy them.

Finish one cancellation-pending design without adding a new public delegation status:

1. A cancellation request against a leased `prepared` row must set cancellation intent without
   clearing its reply key, work id, or submission lease.
2. The in-flight submitter must check cancellation intent before and after `submitWork`.
3. If Lattice accepted the work, Docket must call `cancelWork`. A failed compensating cancellation
   must leave the row `submitted`, retain the reply key, work id, and cancellation intent, and set a
   retry time.
4. The scheduler must process cancellation intent before it polls or submits work. It may settle a
   user cancellation as `canceled` only after Lattice returns `cancelled` or the stable
   unknown-work safety response.
5. Access loss must use the same durable remote cancellation path. It must settle locally as
   `failed` with a stable Docket-owned access code only after remote cancellation or unknown-work
   safety. It must not write task activity.
6. `pollSubmitted` must reauthorize after `pollEvents` and again inside the transaction before it
   writes `workState`, `relayCursor`, `nextPollAt`, or session progress.
7. Transient submit and poll failure writes must recheck the owner, assignment, connection,
   account, and runtime inside their transaction.

The current RED tests cover cancellation during a leased submit, accepted work after access loss,
retry after a failed compensating cancellation, transient submit and poll write fences,
non-terminal poll write fencing, and access loss during the poll network call. Run the focused API
suite through Turbo with at most two workers. Do not call Vitest through an ad hoc pnpm chain.

Two independent reviews rejected the previous commit. One review found orphaned accepted work after
post-submit access loss. The other found post-poll progress after revocation, transient retry writes
after revocation, and cancellation racing an active submission lease. Require both reviews to pass
after the implementation.

## Lovelace package publication

The registry does not contain either required release:

- `@lovelace-ai/compute@0.0.2`
- `@lovelace-ai/lattice-relay-client@0.0.2`

The reviewed tarballs remain on this machine:

- `/tmp/lovelace-sdk-pack.RpB3jD/lovelace-ai-compute-0.0.2.tgz`
  - SHA-256: `96aa1a2e21fe8c85665fb32bb80ad1968bb7177de22e43ca7943454d4a0145de`
- `/tmp/lovelace-sdk-pack.RpB3jD/lovelace-ai-lattice-relay-client-0.0.2.tgz`
  - SHA-256: `7c849a06c0c3fb53e7f899f11eb0a76122702745003148f487b9a522a77fc1e1`

The npm account is signed in as `williecubed`, but write operations require manual web TFA. Do not
open or control a browser. Generate a fresh npm CLI authorization URL in the terminal, give it to
the user, and wait for the user to approve it. Publish `compute` first. Verify it anonymously. Then
publish `lattice-relay-client` and verify it anonymously.

Athena still requests `@lovelace-ai/compute`, `@lovelace-ai/lattice-relay-client`, and
`@lovelace-ai/lattice-relay-crypto` at `^0.0.1`. After publication, update only compute and
relay-client to `0.0.2`. Relay crypto stays at `0.0.1`. Use the repository dependency command and
Turbo graph. Do not run the broad changeset release because existing changesets request minor
versions and the user requires public packages to remain `0.0.x` until an AI-deslop review.

## Production mTLS and Google state

Google authentication and ADC were refreshed for `willie@reasonabletech.co` in project
`project-lovelace`. Use `/Users/williecubed/google-cloud-sdk/bin/gcloud` because `gcloud` is not on
the default shell path.

Terraform production state has lineage `c9397778-6309-04c2-a535-012c0d198de0` and serial `21`. It
tracks the Cloud Run target, project data, trust config, static IP, managed certificate, and
serverless NEG. It does not track a backend service or server TLS policy. Do not push
`errored.tfstate` into the backend.

Google repeatedly failed production global backend creation after about 21 minutes with
`INTERNAL_ERROR`. The latest completed failure is
`operation-1788136445121-65a4cf59f1312-5911ebab-07648244`, with code
`-2264208592806602654`. Two later minimal creates remained `RUNNING` at progress `0` when this
handoff was recorded:

- `operation-1788138401288-65a4d6a37d036-42cf63ee-7c7df6d8`
- `operation-1788138537669-65a4d7258d53d-03798609-89037f72`

Google currently lists both untracked objects:

- `lovelace-production-acctsmtls-backend`
- `lovelace-production-acctsmtls-backend-v2`

The current server TLS policy operation is
`operation-1788136445314-65a4cf5a206eb-9aa00d35-3b87ac88`. It was still pending after Terraform's
30-minute timeout. The policy object was readable as
`lovelace-production-acctsmtls-server-tls` with
`ALLOW_INVALID_OR_MISSING_CLIENT_CERT`, which is required because public OAuth and internal mTLS
share `auth.uselovelace.com`.

Do not retry Terraform blindly. First wait for all three Google operations to become terminal.
Then list the live objects and compare them with state. Import only the exact object that production
will keep. Do not delete the second backend without explicit destructive-action approval. Run a
targeted plan and require only creates or in-place updates before applying the URL map, proxy, and
forwarding rule. Run a full plan after recovery.

The static production edge IP is `136.69.82.31`. Do not move Cloudflare DNS or lock Cloud Run
ingress until the managed certificate is active and public OAuth discovery works through the load
balancer. A terminal probe at handoff time received no bytes from either
`https://auth.uselovelace.com/health` or `https://lattice.uselovelace.com/health` before a 10-second
timeout. Cloud Run still reported ready revisions `accounts-service-production-00014-mpk` and
`lovelace-lattice-gateway-00007-dlr`. Treat public health as unverified until a fresh terminal probe
returns HTTP 200.

The production `terraform.tfvars.example` now names every required root variable. It supplies no
runtime default and contains no real credential.

## Mac Studio state

SSH alias `WillieStudio` reaches `WillieStudio.local`. LM Studio responds on
`http://127.0.0.1:1234/v1` and lists `poolside/laguna-s-2.1`. At handoff time, launchd did not own a
`dev.williecubed.lattice-daemon` job and no `lattice-daemon` process was running.

Do not start an unmanaged daemon. Pair the current validated binary with a one-use device code,
using `https://auth.uselovelace.com` explicitly. The user must open any authorization URL. Install
one launchd job named `dev.williecubed.lattice-daemon`. Configure provider `lmstudio`, model
`poolside/laguna-s-2.1`, base URL `http://127.0.0.1:1234/v1`, one concurrent agent task, relay tools
enabled, and no auto-consented shell or filesystem tools for the production proof.

## Release order

1. Finish the Athena cancellation-intent lifecycle. Pass both independent reviews and bounded
   Turbo gates.
2. Resolve the Google mTLS operations and restore terminal HTTP 200 for Accounts and the gateway.
3. Publish the two exact `0.0.2` packages and update Athena's lockfile.
4. Rebase Athena onto current `origin/main`. Run all protected checks. Fast-forward `main` only
   after the branch is coherent.
5. Deploy Athena's database migration before the API. Then deploy the web app and complete required
   production configuration. Do not provide partial optional configuration.
6. Pair and install the Mac Studio launchd runtime. Confirm one identity and fresh heartbeats.
7. Prove chat inference and durable assignment on the existing production task. Run the scheduler
   again and prove no duplicate work or comment.
8. Prove the PostgreSQL relay with two signaling instances, one lease claimant, restart survival,
   and readable results. Run protected checks and synchronize every relevant `main` with its remote.

## Production proof target

Use workspace `01KY1N724K30F3MCPQMRC7GVD3` and existing task
`01KZPJFGZMXQHVHYB1BJR88F5G`. The task URL is:

`https://docket.hypertext.studio/orgs/01KY1N724K30F3MCPQMRC7GVD3/tasks/01KZPJFGZMXQHVHYB1BJR88F5G`

Do not create a demo task, workspace, account, or synthetic assignment. Correlate the Docket task,
assignment, session, delegation, Lattice work id, Mac Studio daemon log, Laguna request, sealed
result, proposal, approved task comment, and duplicate-free second scheduler pass.

Browser automation is forbidden for this handoff. The user cannot access those browser sessions.
Use terminal evidence. Give the user manual authorization URLs and codes. The final authenticated UI
screenshot remains a release gate and requires the user to reauthorize an accessible browser path.
