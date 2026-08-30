# Bring your own model: Athena on a Lovelace Lattice device

> **Status**: implemented; production availability requires the shared Lovelace OAuth client
> **Owner**: Athena model backend
> **Last updated**: 2026-08-30

Someone can point Athena's model work at a computer they own. They authorize Docket from their
Lovelace account, pick one of the machines they have paired with Lattice, and from then on Athena's
replies are generated there instead of on Docket's model service.

The reason to want this is not novelty. It is that "where did my data go" becomes answerable: the
prompt, the workspace context, and the reply never leave a machine the person controls.

---

## 1. What Lattice is, in the terms this document needs

Lovelace Lattice is a compute network. A **personal runtime** is one computer someone has paired
with it — a laptop or desktop running the `lattice-daemon`, which fronts a local model server
(Ollama or LM Studio). The daemon polls **outbound**; there is no inbound port, no tunnel, and no
callback from the cloud into the home network.

Work reaches that machine through Lovelace's **hosted gateway**. An application sends an ordinary
OpenAI-compatible chat request to the gateway with the model selector
`lattice:personal:<latticeId>`; the gateway seals it as relay work, the daemon picks it up on its
next poll, executes locally, and the result returns through the same gateway response.

**Docket never talks to the device.** It talks to the gateway. That is not an implementation
detail — it is what makes the feature work for a laptop behind NAT on hotel wifi.

## 2. The credential model, and why it cannot be a key

The thing being authorized is a _person's own hardware_. A developer API key proves which developer
is calling; it cannot express whose laptop to wake. Lattice enforces this at the SDK boundary:
personal-runtime dispatch with an API-key credential throws
`PersonalRuntimeRequiresUserTokenError` **before any request is sent**.

So the credential is a per-user OAuth grant, obtained through Sign in with Lovelace:

- **Issuer**: `https://accounts.uselovelace.com` (`/oauth/authorize`, `/oauth/token`).
- **Flow**: authorization code + PKCE (S256). Docket holds a client secret and could use a plain
  code exchange; it uses PKCE anyway, because the code travels through the user's browser and PKCE
  is what makes an intercepted code useless.
- **Stored**: access token, refresh token, granted scope — sealed with AES-256-GCM
  (`lattice_credential.ciphertext`). No Lovelace password ever reaches Docket.

### The scopes, and the ones deliberately not requested

| Scope                          | Why Athena needs it                                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lattice:compute:inference`    | Submit the model turn, and read the person's device records. Reading runtime records is covered by this scope upstream, so device discovery costs no extra authority. |
| `lattice:compute:catalog:read` | Populate the device/model surface from the gateway's own catalog rather than a list Docket hard-codes and lets rot.                                                   |

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

Tested by counting requests, not just by asserting an error: `lattice-gateway.test.ts` and
`lattice-flow.test.ts` both assert that an offline turn produces **zero** dispatches anywhere.

## 4. Tool calling over a text-only wire

Lattice's OpenAI-compatible surface carries `{ role, content: string }`. Its request type has no
`tools` field, its message type has no `tool_calls` array and no `tool` role, and its response
carries a single text message (upstream `OpenAiChatMessage` / `OpenAiChatCompletionResponse`).
Athena's loop is built on tool calls. Something has to bridge that, and the only place a bridge can
live is inside the text.

The private text-protocol module behind `@docket/athena/turn/adapters/lattice` defines one:

- Tools are described in the system prompt, each with its **verbatim** JSON Schema. A paraphrase
  produces inputs that fail validation, and recovering costs a whole turn on the person's hardware.
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

No connection, not enabled, or no device chosen ⇒ the container's process-level runtime, unchanged.
Two people on the same API instance can be on different backends in the same second.

`@docket/athena` takes **no** dependency on `@docket/integrations`. The network edge arrives as an
injected `LatticeChatPort`, exposed by `@docket/athena/turn/adapters/lattice` and wired by
`apps/api`, which already depends on both. That keeps OAuth and HTTP out of the domain package that
defines the port.

## 6. Data model

| Table                | Holds                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lattice_connection` | One row per Better Auth user: status, `enabled`, the chosen `device_id`/`device_name`/`device_status`, granted scope, and the last failure **code**. |
| `lattice_credential` | The AES-256-GCM sealed OAuth tokens, joined by a compound FK on `(connection_id, owner_user_id)`.                                                    |

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

## 7. Surfaces

`GET|PATCH|DELETE /v1/me/athena/lattice`, `POST /v1/me/athena/lattice/authorize`,
`GET /v1/me/athena/lattice/devices`, `POST /v1/me/athena/lattice/device`, and the browser callback
at `/internal/integrations/lattice/callback`.

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

| Var                       | Required | Meaning                                                                                                            |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `LATTICE_CLIENT_ID`       | no       | Docket's shared Lovelace OAuth client. Absent ⇒ the section renders as unavailable and no Connect control appears. |
| `LATTICE_CLIENT_SECRET`   | no       | Paired secret for Docket's confidential OAuth client.                                                              |
| `LATTICE_ACCOUNTS_ISSUER` | no       | Defaults to `https://accounts.uselovelace.com`.                                                                    |
| `LATTICE_GATEWAY_URL`     | no       | Defaults to `https://lattice.uselovelace.com`.                                                                     |

The OAuth client identifies Docket during consent; it is application infrastructure, not the model
credential. Every model grant, device choice, and enablement state still belongs to the individual
user. The user never enters a gateway URL, API key, or token. A deployment that sets none of these
variables behaves exactly as it did before this feature existed.

## 10. The SDK

The upstream SDK is `@reasonabletech/lattice-client`
(`ReasonableTech/lovelace:packages/platform/lattice-client`). It is **not published to any registry
Docket can install from**, and neither are the two private sibling packages it depends on
(`@lovelace-ai/compute`, `@lovelace-ai/auth-core`) — all three 404, and `pnpm.overrides` does not
rewrite transitive dependencies of a `file:` tarball, so locally packed tarballs do not resolve
either. Declaring an unresolvable dependency would break `pnpm install` for the whole monorepo.

So the SDK's client is vendored verbatim in `packages/integrations/src/lattice-sdk.ts`, with only
its two type-only upstream imports re-declared locally and attributed. Behaviour, route paths,
header names and error classes are unchanged. **It is the only module in Docket that speaks HTTP to
a Lattice gateway**, so when Lovelace publishes, the migration is one file:

```ts
export * from '@reasonabletech/lattice-client';
```

## 11. Files

| Path                                                         | What                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `packages/integrations/src/lattice-sdk.ts`                   | The vendored gateway client. The only Lattice HTTP.                      |
| `packages/integrations/src/lattice-oauth.ts`                 | PKCE flow, token exchange, refresh, scope check.                         |
| `packages/integrations/src/lattice-gateway.ts`               | Device discovery, turn dispatch, error→reason mapping.                   |
| `domains/athena/src/turn/internal/lattice-tool-protocol.ts`  | Private text-tool protocol; reached through the adapter.                 |
| `domains/athena/src/turn/adapters/lattice.ts`                | `LatticeAgentTurnRuntime`, `LatticeChatPort`, and transcript flattening. |
| `domains/athena/src/turn/model-backend.ts`                   | Process-level backend selection.                                         |
| `apps/api/src/routes/lattice.ts`                             | The owner-only REST surface.                                             |
| `apps/api/src/routes/lattice-connection.ts`                  | Load/seal/refresh one person's grant.                                    |
| `apps/api/src/routes/lattice-oauth.ts`                       | The browser callback.                                                    |
| `apps/api/src/routes/lattice-backend.ts`                     | Per-owner backend resolution for the agent loop.                         |
| `apps/web/src/app/(app)/settings/athena/lattice-section.tsx` | The settings surface.                                                    |
| `apps/web/src/app/(app)/settings/athena/lattice-copy.ts`     | Application-owned copy per reason.                                       |
| `packages/db/src/schema/agents.ts`                           | `lattice_connection`, `lattice_credential`.                              |
| `packages/db/drizzle/0063_lattice_byo_model.sql`             | The additive migration.                                                  |

## 12. Evidence

- `docs/engineering/evidence/lattice-local-device-run.md` — a real Athena turn answered by a model
  running on a real machine, with the device's own log as corroboration and the offline case
  showing zero dispatches. Regenerate with
  `pnpm --filter @docket/api exec tsx tests/lattice/verify-lattice-local.ts`.
- `apps/api/tests/lattice/lattice-flow.test.ts` — the whole flow, hermetically, in CI.
- `apps/web/.data/design-review/lattice/` — the recorded UI flow at both widths in both themes.
