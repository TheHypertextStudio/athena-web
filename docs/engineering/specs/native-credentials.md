# Native credentials: what the Android client needs from Docket's auth server

> **Status**: Current as of 2026-09-01
> **Owner**: auth
> **Decision record**: `docs/engineering/DECISIONS.md` — "Android restore credentials are
> system-managed records, never ordinary passkeys"

Docket stays passwordless on every client. A phone signs in with a passkey or a social provider, and
it keeps the person signed in across reinstalls and device migrations without asking again. This
document describes the three server-side contracts that make that possible for Docket Android, how
each one keeps older clients working, and where the guards live.

## 1. The three contracts

| Contract                    | Surface                                     | Who calls it                                |
| --------------------------- | ------------------------------------------- | ------------------------------------------- |
| Public Google configuration | `GET /v1/config` → `googleServerClientId`   | Android's Credential Manager bootstrap      |
| Typed passkey management    | `/v1/me/passkeys` (list, rename, delete)    | Web Security page; Android account screen   |
| Restore credentials         | `/api/auth/restore-credential/*` (5 routes) | Android only, automatically, never a person |

Each one is additive. Existing web sessions, existing passkeys, and any Android build that predates
the contract keep working unchanged.

## 2. Public Google configuration

`PublicConfigOut.googleServerClientId` carries the Google OAuth **web** client ID so the Android
client can request a Google ID token addressed to Docket's server. It is `null` unless Google is
actually offerable to the caller: outside production it follows the configured `GOOGLE_CLIENT_ID`,
and in production it is published only when `GOOGLE_OAUTH_PUBLIC` is on, the same gate that
decides whether Google appears on the sign-in page. The field is nullable rather than optional, so
every consumer parses the same shape whether or not Google is enabled.

## 3. Typed passkey management

Better Auth's generic passkey plugin exposes list and delete routes whose payloads include material
a management screen has no business seeing. `apps/api/src/routes/me-passkeys.ts` replaces them with
three ownership-scoped routes typed by
`domains/identity-access/src/contracts/passkey-management.ts`:

- `GET /v1/me/passkeys` returns `PasskeyListOut`: id, name, device type, backed-up flag,
  transports, AAGUID, creation time, and **last used** time. Nothing in the summary can be
  replayed.
- `PATCH /v1/me/passkeys/:id` takes `PasskeyRenameIn` (a trimmed name of at most 100 characters).
- `DELETE /v1/me/passkeys/:id` returns `PasskeyDeleteOut`, which includes the provider credential
  id so the client can drop its local copy. The existing last-passkey lockout guard still applies:
  a person with no other sign-in method cannot delete their only passkey.

`passkey.last_used_at` is written by the sign-in hook whenever an assertion succeeds, which is what
lets the Security page tell a stale enrollment from an active one. The web Security section already
reads these routes; Better Auth's generic paths stay mounted until the Android account screen has
moved over, and the final Android milestone turns them off.

## 4. Restore credentials

Android's Credential Manager can hold a cloud-backed **restore credential**: a discoverable
WebAuthn credential the OS creates on the person's behalf and restores onto a new device from their
Google backup. Docket treats it as lifecycle machinery, so it lives in its own table and its own
Better Auth plugin (`packages/auth/src/restore-credential.ts`) rather than in the passkey list.

### Routes

| Route                                                   | Auth                    | Purpose                                                       |
| ------------------------------------------------------- | ----------------------- | ------------------------------------------------------------- |
| `GET /restore-credential/generate-register-options`     | session ≤ 5 minutes old | Issue registration options bound to the signed-in person      |
| `POST /restore-credential/verify-registration`          | session ≤ 5 minutes old | Verify the attestation and store the credential               |
| `GET /restore-credential/generate-authenticate-options` | none (rate-limited)     | Issue a discoverable authentication challenge                 |
| `POST /restore-credential/verify-authentication`        | none (rate-limited)     | Verify the assertion, advance the counter, and mint a session |
| `POST /restore-credential/delete`                       | any session             | Revoke one restore record the caller owns                     |

### The ceremony, and what each guard refuses

1. Registration requires a session created within the last five minutes, the same freshness window
   the credential-change flows already use. An older session gets `401` with the stable code
   `reauth_required`; no session at all gets `401`.
2. Every challenge is a single-use `verification` row with a five-minute expiry, named by an opaque
   identifier that travels only in a dedicated signed cookie. Verification consumes the row and
   expires the cookie before checking anything else, so a replayed challenge fails whatever else is
   true.
3. A challenge records which ceremony it was minted for and, for registration, which person. A
   registration verified with an authentication challenge, or with a challenge issued to a different
   account, is refused.
4. The relying-party ID is `BETTER_AUTH_PASSKEY_RP_ID` and the accepted origins are exactly
   `BETTER_AUTH_PASSKEY_NATIVE_ORIGINS` (comma-separated Android APK key-hash origins). An empty
   allowlist refuses both registration and authentication rather than falling back to the web
   origin.
5. Resident keys and user verification are required on both sides of the ceremony.
6. Authentication looks the credential up by its WebAuthn id, verifies against the stored public key
   and counter, then writes the new counter and `last_used_at` before issuing the ordinary Better
   Auth session cookie. A credential whose account has vanished is refused rather than resurrected.
7. Deletion is scoped to the caller: a record the caller does not own answers `404`, exactly like a
   missing one.
8. The two unauthenticated routes are rate-limited to ten calls per minute each.

The plugin takes its WebAuthn verifier and its database as injectable dependencies. Production uses
`@simplewebauthn/server` and the shared Drizzle client; the tests in
`packages/auth/tests/restore-credential.test.ts` substitute deterministic verifiers and a fake store
to prove every refusal above, and the auth package holds a 100% coverage floor.

### Data model

`restore_credential` (migration `0123_native_credentials`) stores the public key, WebAuthn
credential id (unique), signature counter, device type, backed-up flag, transports, AAGUID, and
three timezone-aware timestamps: created, updated (auto-bumped), and last used. Rows cascade with
the owning user. The same migration adds `passkey.last_used_at`.

## 5. Compatibility and rollout

- Web and older Android clients see no behavior change. New fields are nullable, new routes are
  additive, and nothing existing was removed.
- Deployment is separately authorized; the migration is additive and safe to apply ahead of the
  Android client that uses it.
- `BETTER_AUTH_PASSKEY_NATIVE_ORIGINS` is a deployment fact (which APK signatures may talk to this
  server), which is why it is an environment variable rather than an admin setting.

## 6. Files

| File                                                          | Role                                           |
| ------------------------------------------------------------- | ---------------------------------------------- |
| `domains/identity-access/src/contracts/public-config.ts`      | `googleServerClientId` on the public config    |
| `domains/identity-access/src/contracts/passkey-management.ts` | Typed passkey list, rename, and delete shapes  |
| `apps/api/src/routes/config.ts`                               | Resolves the server client id behind the gate  |
| `apps/api/src/routes/me-passkeys.ts`                          | `/v1/me/passkeys`                              |
| `packages/auth/src/restore-credential.ts`                     | The restore-credential Better Auth plugin      |
| `packages/auth/src/auth-builder.ts`                           | Mounts the plugin and records passkey last use |
| `packages/db/src/schema/auth.ts`                              | `restore_credential`, `passkey.last_used_at`   |
| `packages/db/drizzle/0123_native_credentials.sql`             | The additive migration                         |
| `apps/web/src/components/settings/passkeys-section.tsx`       | Web Security surface on the typed routes       |
