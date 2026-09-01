# Bring your own model: Athena on a Lovelace Lattice device

> **Reader**: the maintainer who must ship and verify the Docket–Lattice production round trip
> **Required action**: preserve the no-fallback boundary and complete both production proofs
> **Status**: implemented locally; production rollout and proof remain open
> **Owner**: Athena model backend
> **Last updated**: 2026-08-30

Someone can point Athena's model work at a computer they own. They authorize Docket from their
Lovelace account, pick one of the machines they have paired with Lattice, and from then on Athena's
chat replies are generated there instead of on Docket's model service. Personal Athena assignment
jobs use the same machine through a durable sealed relay work item. Docket retains the work
identity, reply key, progress cursor, and review state until the job settles.

The reason to want this is not novelty. It is that "where did my data go" becomes answerable: the
prompt, the workspace context, and the reply never leave a machine the person controls.

---

## 1. What Lattice is, in the terms this document needs

Lovelace Lattice is a compute network. A **personal runtime** is one computer someone has paired
with it — a laptop or desktop running the `lattice-daemon`, which fronts a local model server
(Ollama or LM Studio). The daemon polls **outbound**; there is no inbound port, no tunnel, and no
callback from the cloud into the home network.

Work reaches that machine through Lovelace's **hosted gateway**. Chat sends an ordinary
OpenAI-compatible request with the model selector `lattice:personal:<latticeId>`. Assignment work
sends a caller-minted work id and a sealed schema-version-2 `agent_task` through the public personal
relay routes. The daemon polls outbound in both cases.

**Docket never talks to the device.** It talks to the gateway. That is not an implementation
detail — it is what makes the feature work for a laptop behind NAT on hotel wifi.

## 2. The credential model, and why it cannot be a key

The thing being authorized is a _person's own hardware_. A developer API key proves which developer
is calling; it cannot express whose laptop to wake. Lattice enforces this at the SDK boundary:
personal-runtime dispatch with an API-key credential throws
`PersonalRuntimeRequiresUserTokenError` **before any request is sent**.

So the credential is a per-user OAuth grant, obtained through Sign in with Lovelace:

- **Issuer**: `https://auth.uselovelace.com` (`/oauth/authorize`, `/oauth/token`).
- **Client**: public client `docket-athena`.
- **Flow**: authorization code + PKCE (S256). Docket stores no client secret for this grant.
- **Stored**: access token, refresh token, granted scope — sealed with AES-256-GCM
  (`lattice_credential.ciphertext`). No Lovelace password ever reaches Docket.

### The scopes, and the ones deliberately not requested

| Scope                          | Why Athena needs it                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `openid profile email`         | Bind the Lovelace grant to the Docket owner who approved it.                                              |
| `offline_access`               | Refresh the owner grant without sending the person through consent for every job.                         |
| `lattice:compute:inference`    | Use an existing personal runtime for chat and durable relay work.                                         |
| `lattice:compute:catalog:read` | Populate the device and model surface from the gateway catalog instead of a Docket-owned hard-coded list. |

Not requested, and why:

| Scope                                     | Why not                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lattice:compute:personal_runtime:manage` | Creates, revokes, and mints daemon credentials for devices. Athena sends work to machines the person already paired; it has no business minting machine credentials on their account.             |
| `lattice:compute:marketplace`             | Permits routing onto shared third-party capacity. The entire point of the feature is that work runs on the person's own machine, so Athena must not even hold the authority to send it elsewhere. |
| `lattice:compute:usage:read`              | Billing history. Athena never shows it.                                                                                                                                                           |
| `lattice:compute:streaming`               | The session/WebSocket family. Athena's Lattice turns use request/response.                                                                                                                        |

A narrowed grant is caught at the callback (`missingLatticeScopes`) and the connection is marked
`insufficient_scopes` rather than being discovered mid-conversation later.

## 3. The invariant: no silent fallback, ever

**If the chosen device cannot serve a turn, the turn fails with a reason. It never runs somewhere
else.**

This is the whole feature. Someone who chose local inference for privacy must be able to tell, from
inside Docket, whether their data left the machine — and a quiet hop to a cloud model would take
that away without any visible signal.

It is enforced at four layers, deliberately redundantly:

1. **The gateway.** `runtime_unreachable` is terminal upstream; the gateway does not reroute a
   personal-runtime request onto shared capacity.
2. **`runLatticeChat`** checks readiness before dispatch and maps every failure to a
   `LatticeUnavailableReason`. There is no branch that returns text on failure.
3. **`LatticeAgentTurnRuntime.streamTurn`** does not catch. A port failure propagates with its
   reason intact. Its deliberate public entry point is
   `@docket/athena/turn/adapters/lattice`.
4. **`resolveOwnerBackend`** throws rather than degrading when a stored grant cannot produce a
   usable token.

Tests count Docket generation rows and remote submissions. An offline selected runtime keeps the
delegation queued and produces zero Docket generation rows.

The sequence diagram separates the two execution paths and shows where Docket owns durable state:
[`lattice-athena-round-trip.mmd`](./lattice-athena-round-trip.mmd).

## 4. Tool calling over a text-only wire

Lattice's OpenAI-compatible surface carries `{ role, content: string }`. Its request type has no
`tools` field, its message type has no `tool_calls` array and no `tool` role, and its response
carries a single text message (upstream `OpenAiChatMessage` / `OpenAiChatCompletionResponse`).
Athena's loop is built on tool calls. Something has to bridge that, and the only place a bridge can
live is inside the text.

The private text-protocol module behind `@docket/athena/turn/adapters/lattice` defines one:

- Tools are described in the system prompt, each with the **shape-preserving** part of its JSON
  Schema: every keyword that decides what input is valid (`type`, `properties`, `required`,
  `enum`, `items`, `anyOf`, …) rendered as compact JSON, with documentation-only keywords
  (`description`, `title`, `examples`, `$comment`, …) removed at every level and the tool's own
  description cut to its lead paragraph. Validation still runs against the registered schema. A
  paraphrase of the shape would produce inputs that fail validation, and recovering costs a whole
  turn on the person's hardware; but a local model also pays prompt processing for every token of
  every tool on every turn, and the full toolbox with its prose ran a one-line turn to ~40k
  tokens — more than a 32k-context model accepts. The paired model must be loaded with at least a
  **64k context** (on the Mac Studio the LM Studio watchdog loads `poolside/laguna-s-2.1` at
  65,536), and the gateway allows a personal runtime five minutes for a standard turn, which
  Docket's turn timeout matches.
- A call is a lone fenced JSON block: `{"tool": "<name>", "input": { … }}`.
- A result comes back as a user message prefixed `TOOL RESULT (<id>) OK|FAILED`.

The parser's three rules exist to stop a model's _description_ of a tool call from becoming a real
one:

1. A tool call is the whole reply, or it is prose. More than ~40 characters of surrounding text
   means the model was explaining.
2. Two blocks is prose — picking one would be a guess.
3. Malformed JSON is never repaired, and a call to a tool that was not offered this turn is prose.

Tool-use ids are deterministic (`toolu_lat_0000`, continuing the transcript's count) because the id
is the join key between a `tool_use` block and its `tool_result`, and both are persisted — a
conversation resumed after a restart must pair them exactly as it did the first time.

`thinking` blocks are dropped when flattening: their provider signature is meaningless to a local
model, and replaying another model's private deliberation as instruction is worse than dropping it.

## 5. Per-user backend resolution

`resolveModelBackend` in `@docket/athena/turn/model-backend` picks a backend from the **process**
environment. That is right for the tiers Docket operates (the Cloudflare model router on Docket's
key, or direct provider access) because those are properties of the deployment. It cannot express
Lattice, which is a property of a _person_.

`apps/api/src/routes/lattice-backend.ts` is the per-owner layer above it. The agent loop asks it
once per turn:

```ts
const turnRuntime = deps.turnRuntime ?? (await resolveOwnerTurnRuntime(session.ownerUserId));
```

No connection, a disabled connection, or no device choice uses the container's process-level
runtime. Once an owner enables a selected runtime, a failure propagates as a Lattice error. Docket
does not switch that turn to the process-level runtime.

`@docket/athena` takes **no** dependency on `@docket/integrations`. The network edge arrives as an
injected `LatticeChatPort`, exposed by `@docket/athena/turn/adapters/lattice` and wired by
`apps/api`, which already depends on both. That keeps OAuth and HTTP out of the domain package that
defines the port.

## 6. Data model

| Table                | Holds                                                                                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lattice_connection` | One row per Better Auth user: status, `enabled`, the chosen runtime, granted scope, and the last failure code.                                                                                                                      |
| `lattice_credential` | The AES-256-GCM sealed OAuth tokens, joined by a compound owner foreign key.                                                                                                                                                        |
| `agent_session`      | The execution surface. Assignment sessions delegated to the relay use `execution_surface = lattice`.                                                                                                                                |
| `agent_delegation`   | One durable assignment job with owner, assignment, session, task, connection, runtime, logical submission id, work id, sealed reply key, relay cursor, next poll time, failure, outcome, proposal, and result acknowledgement time. |

Per user, not per organization: a coworker cannot point the team's Athena at a laptop they do not
own. Two constraints carry real weight:

- `lattice_connection_enabled_needs_device_check` — a connection cannot be switched on without a
  device, so an enabled row can never fail every turn at dispatch time instead of being visibly
  incomplete in Settings.
- `lattice_credential_connection_owner_fk` — a compound FK, so sealing one person's tokens against
  another person's connection row is impossible even through a bug in the route layer.

`lattice_connection_id_owner_uq` is a table **constraint**, not a unique index, because Drizzle
emits constraints inside `CREATE TABLE` but unique indexes _after_ `ALTER TABLE … ADD CONSTRAINT`.
As an index it produced a migration that failed with `42830` whenever the batch also contained other
new tables. This was caught by `apps/api/tests/lattice/lattice-flow.test.ts`, not by review.

Docket stores the reply key and caller-minted work id before the first network request. A retry
reuses both identifiers. Terminal settlement clears the reply key in the same transaction that
records the outcome. The state machine is in
[`lattice-delegation-state.mmd`](./lattice-delegation-state.mmd).

## 7. Surfaces

`GET|PATCH|DELETE /v1/me/athena/lattice`, `POST /v1/me/athena/lattice/authorize`,
`GET /v1/me/athena/lattice/devices`, `POST /v1/me/athena/lattice/device`, and the browser callback
at `/internal/integrations/lattice/callback`.

Durable assignment jobs use the OAuth-protected gateway routes
`GET /v1/personal-relay/lattices`, `POST /v1/personal-relay/work-items`,
`GET /v1/personal-relay/work-items/:workId/events`, and
`PUT /v1/personal-relay/work-items/:workId/cancellation`. After Docket stores a terminal result it
calls `PUT /v1/personal-relay/work-items/:workId/result-acknowledgement`, which lets the relay delete
the sealed result and progress ciphertext. The gateway derives the Lovelace account from the token.
Docket never supplies an authoritative account identity.

**Unavailability is a 200, not a 409.** Every Lattice failure has an actionable cause — wake the
machine, start the daemon, reconnect, pick another device — so it comes back in the payload as a
stable `unavailableReason` and the surface renders an instruction. Modelling them as errors would
force an error toast for "your laptop is asleep", or a widening of the closed `ProblemCode`
taxonomy. Neither is right.

The API returns codes; `apps/web/src/app/(app)/settings/athena/lattice-copy.ts` owns every word a
person reads. No gateway message, issuer `error_description`, or DNS failure text is ever rendered.

**Turnkey, measured:** three user actions from disconnected to running (Connect → Approve on
Lovelace → pick a computer), zero text fields for URLs/keys/tokens, zero terminal commands. The
recording that measures it is `apps/web/e2e/lattice/capture-lattice-flow.ts`, which counts the
actions and asserts the input count is 0.

## 8. Independence from Docket's fallback backend

Lattice is selected by the user, not by the deployment. An owner with a connected, enabled device
is resolved to that device before Athena reads the process-level fallback runtime. Therefore an
absent or misconfigured Docket-operated model provider cannot hide Lattice, reject its consent
flow, or prevent that owner's turn from running locally.

The process-level backend remains the fallback for registered agents and for owners who have not
enabled Lattice. Its production readiness is a separate launch concern; it is not a prerequisite
for choosing personal compute. The production-mode end-to-end test deliberately leaves the
fallback unconfigured: enabled Lattice turns complete, while an unconnected or disabled owner
reaches the fallback's normal configuration error.

## 9. Environment

| Var                       | Required | Meaning                                                                                                |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `LATTICE_CLIENT_ID`       | no       | Lovelace OAuth client. Absent ⇒ the section renders as unavailable and no Connect control appears.     |
| `LATTICE_CLIENT_SECRET`   | no       | Optional compatibility value. Production `docket-athena` is a public PKCE client and does not set one. |
| `LATTICE_ACCOUNTS_ISSUER` | no       | Defaults to `https://auth.uselovelace.com`.                                                            |
| `LATTICE_GATEWAY_URL`     | no       | Defaults to `https://lattice.uselovelace.com`.                                                         |

The OAuth client identifies Docket during consent; it is application infrastructure, not the model
credential. Every model grant, device choice, and enablement state still belongs to the individual
user. The user never enters a gateway URL, API key, or token. A deployment that sets none of these
OAuth values keeps Lattice unavailable.

Submission and polling are product settings. The `service_control` table holds one row per control
(`lattice_submissions` and `lattice_polling`), staff change them from the admin console, and the
five-minute sweep reads them at the start of every pass, so a change takes effect on the next tick.
Turning submission off stops new durable submissions while existing work continues to settle.
Turning polling off holds the delegation rows, work ids, and encrypted keys in place until polling
resumes. A key with no row reads as enabled, so a fresh deployment serves the capability before
anyone opens the console.

## 10. The SDK

Docket imports the official Lovelace package surfaces from the reviewed source:
`@reasonabletech/lattice-client`, `@lovelace-ai/compute`,
`@lovelace-ai/lattice-relay-client`, and `@lovelace-ai/lattice-relay-crypto`. The source no longer
contains a copied gateway protocol. Lovelace has published version `0.0.1` of these four direct
dependencies plus the transitive `@lovelace-ai/acsp` package. Docket's lockfile resolves them from
the registry without a `link:` or `file:` override.

## 11. Files

| Path                                                         | What                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `packages/integrations/src/lattice-sdk.ts`                   | The narrow re-export surface for the official Lovelace packages.         |
| `packages/integrations/src/lattice-oauth.ts`                 | PKCE flow, token exchange, refresh, scope check.                         |
| `packages/integrations/src/lattice-gateway.ts`               | Device discovery, turn dispatch, error→reason mapping.                   |
| `domains/athena/src/turn/internal/lattice-tool-protocol.ts`  | Private text-tool protocol; reached through the adapter.                 |
| `domains/athena/src/turn/adapters/lattice.ts`                | `LatticeAgentTurnRuntime`, `LatticeChatPort`, and transcript flattening. |
| `domains/athena/src/turn/model-backend.ts`                   | Process-level backend selection.                                         |
| `apps/api/src/routes/lattice.ts`                             | The owner-only REST surface.                                             |
| `apps/api/src/routes/lattice-connection.ts`                  | Load/seal/refresh one person's grant.                                    |
| `apps/api/src/routes/lattice-oauth.ts`                       | The browser callback.                                                    |
| `apps/api/src/routes/lattice-backend.ts`                     | Per-owner backend resolution for the agent loop.                         |
| `apps/api/src/agent/lattice-delegations.ts`                  | Docket-owned durable job state, polling, proposal, and cancellation.     |
| `apps/api/src/agent/lattice-delegation-runtime.ts`           | Official relay client and crypto adapter.                                |
| `apps/web/src/app/(app)/settings/athena/lattice-section.tsx` | The settings surface.                                                    |
| `apps/web/src/app/(app)/settings/athena/lattice-copy.ts`     | Application-owned copy per reason.                                       |
| `packages/db/src/schema/agents.ts`                           | Lattice connection, credential, session surface, and delegation records. |
| `packages/db/drizzle/0112_agent-delegation.sql`              | The durable delegation migration.                                        |

## 12. Evidence

- `docs/engineering/evidence/lattice-local-device-run.md` — a real Athena turn answered by a model
  running on a real machine, with the device's own log as corroboration and the offline case
  showing zero dispatches. Regenerate with
  `pnpm --filter @docket/api exec tsx tests/lattice/verify-lattice-local.ts`.
- `apps/api/tests/lattice/lattice-flow.test.ts` — the whole flow, hermetically, in CI.
- `apps/web/.data/design-review/lattice/` — the recorded UI flow at both widths in both themes.
