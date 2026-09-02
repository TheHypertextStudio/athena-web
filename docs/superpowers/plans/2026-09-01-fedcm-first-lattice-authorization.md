# FedCM-First Lattice Authorization Implementation Plan

> **For Codex:** REQUIRED SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Docket's explicit “Connect with Lovelace” action use the browser's native active FedCM dialog when available, while preserving Lovelace OAuth authorization-code plus PKCE as the only durable authorization authority and retaining a first-class redirect flow for browsers without FedCM.

**Architecture:** Docket creates a short-lived authorization-attempt record containing state, PKCE verifier/challenge, scopes, and expiry without changing the active Lattice credential. Its web client sends the public half of that attempt to Lovelace through an active FedCM request. Lovelace validates the registered Docket client and origin, reuses `OAuthService.handleAuthorizationRequest` to issue a one-time code, and returns that code as the FedCM credential token; when fresh consent is required it returns `continue_on`, and the Lovelace consent page completes the same OAuth request before calling `IdentityProvider.resolve(code)`. Docket submits the returned code to its own authenticated API, which atomically consumes the attempt, exchanges the code using PKCE, and installs the new credential. Browsers without FedCM use the existing redirect authorization endpoint against the same attempt and the same completion service.

**Tech Stack:** TypeScript, Hono/OpenAPI, Prisma, Drizzle/PostgreSQL, Next.js/React, TanStack Query, Vitest/Testing Library, Playwright, browser FedCM API, OAuth 2.0 Authorization Code with PKCE.

**Authoritative design:** `docs/superpowers/specs/2026-09-01-fedcm-first-lattice-authorization-design.md`

---

## Cross-repository invariants

- Docket session authentication and Lovelace resource authorization remain separate concepts.
- Lovelace OAuth validates the client, exact redirect URI, scopes, PKCE S256 challenge, user session, and stored consent for both transports.
- The FedCM assertion endpoint never returns access or refresh tokens. It returns one short-lived OAuth authorization code or a `continue_on` URL.
- Authorization attempts are separate rows from active credentials. Starting, dismissing, denying, expiring, or failing a replacement attempt cannot damage an existing working connection.
- Each attempt is bound to one Docket owner, one Lattice connection, one state value, one PKCE verifier/challenge pair, the fixed Docket redirect URI, and the requested scope set.
- The completion endpoint accepts only an authenticated owner, a live unconsumed attempt, and a one-time code. It exchanges the code server-side; neither verifier nor durable token reaches the browser.
- Redirect and FedCM completion call the same Docket completion service and have the same success/error semantics.
- Docket requests only `openid offline_access lattice:compute:inference lattice:compute:catalog:read`; `profile` and `email` are not required.
- An invoked or dismissed FedCM dialog never triggers an automatic redirect. After a failed active request, the UI exposes an explicit “Continue in Lovelace” action.
- Unsupported browsers skip the FedCM call and immediately follow the explicit user click into the redirect flow.
- Logs, URLs, query strings, analytics, and user-facing errors never expose authorization codes, PKCE verifiers, access tokens, refresh tokens, provider exception text, or passkey material.

## Task 1: Add an OAuth authorization transport contract in Lovelace

**Files:**

- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/packages/integrations/cloud-auth/src/services/oauth-service.ts`
- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/packages/integrations/cloud-auth/src/types/oauth.ts` (or the colocated request type found by the implementation)
- Test: `/Users/williecubed/Projects/ReasonableTech/lovelace/packages/integrations/cloud-auth/tests/unit/services/oauth-service.test.ts`
- Add: `/Users/williecubed/Projects/ReasonableTech/lovelace/.changeset/fedcm-oauth-continuation.md` only if the edited cloud-auth contract is part of its public export

### Step 1: Write the failing tests

Add tests that prove:

1. A regular OAuth request still returns `{ code, state, redirectUri }`.
2. A request that requires consent produces an opaque consent request retaining `completion: "fedcm"`.
3. Approving a FedCM continuation returns the same authorization code data without weakening client, redirect, scope, or PKCE validation.
4. Denial retains enough transport information for the UI to close the FedCM continuation instead of navigating to a redirect URI.
5. Unknown or missing completion values default to `redirect` for compatibility.

Run:

```bash
pnpm --filter @lovelace-ai/cloud-auth test -- --run tests/unit/services/oauth-service.test.ts
```

Expected: FAIL because the consent request and approval result do not carry a completion transport.

### Step 2: Implement the minimum transport-neutral OAuth result

- Introduce a closed `OAuthAuthorizationCompletion = "redirect" | "fedcm"` type.
- Carry it in the internally encoded consent request and decoded consent information.
- Keep `handleAuthorizationRequest` as the only code issuer.
- Keep the regular redirect response shape backward-compatible.
- Do not teach the OAuth service about browser APIs or Docket-specific copy.

### Step 3: Re-run the focused test and package gates

```bash
pnpm --filter @lovelace-ai/cloud-auth test -- --run tests/unit/services/oauth-service.test.ts
pnpm --filter @lovelace-ai/cloud-auth typecheck
pnpm --filter @lovelace-ai/cloud-auth lint:check
```

Expected: PASS.

## Task 2: Let Lovelace issue OAuth codes through its FedCM assertion endpoint

**Files:**

- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts-service/src/routes/fedcm/assertion.ts`
- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts-service/src/services/fedcm-assertion-service.ts`
- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts-service/src/features/accounts/feature-flags.ts`
- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts-service/src/services/service-composition.ts`
- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts-service/tests/helpers/setup/fedcm-router-test-app.ts`
- Test: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts-service/tests/unit/routes/fedcm/metadata-assertion.test.ts`
- Test: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts-service/tests/unit/services/fedcm-assertion-service.test.ts`

### Step 1: Write the failing assertion-route tests

Add form-encoded requests whose `params` JSON includes:

```json
{
  "purpose": "oauth_authorization",
  "redirect_uri": "https://docket.hypertext.studio/api/lattice/oauth/callback",
  "scope": "openid offline_access lattice:compute:inference lattice:compute:catalog:read",
  "state": "<opaque attempt state>",
  "code_challenge": "<S256 challenge>",
  "code_challenge_method": "S256"
}
```

Prove:

- a valid registered, active, public, PKCE-required Docket client receives `{ token: <authorization-code> }`;
- a new or widened grant receives `{ continue_on: <same-origin Lovelace consent URL> }`;
- the ordinary identity-token assertion branch remains unchanged when `purpose` is absent;
- disabled feature flag, confidential client, inactive client, missing PKCE, non-S256 PKCE, unregistered redirect, excess scope, wrong origin, wrong account, or absent Lovelace session is rejected;
- the response does not contain an access token, refresh token, user profile, email, verifier, or redirect query containing the code.

Run:

```bash
pnpm --filter lovelace-accounts-service test:unit -- tests/unit/routes/fedcm/metadata-assertion.test.ts
```

Expected: FAIL because the endpoint always issues an identity JWT.

### Step 2: Implement the authorization branch behind a flag

- Add the accounts-service flag `fedcmOauthAuthorization`, defaulting to false outside explicit rollout configuration.
- Parse and validate the custom parameters into a narrow request type.
- Reuse the existing session and origin validation already performed by the assertion route.
- Require the OAuth client to be active, public, PKCE-required, registered for the exact origin and redirect URI, and allowed every requested scope.
- Call the injected `OAuthService.handleAuthorizationRequest` with `completion: "fedcm"` and the authenticated Lovelace user.
- Convert a successful result to `{ token: code }`.
- Convert only the known `consent_required` branch to `{ continue_on }`.
- Map all other failures to stable FedCM/OAuth errors without returning provider exception text.
- Keep the legacy identity-JWT branch byte-for-byte compatible where practical.

### Step 3: Re-run focused service and route tests

```bash
pnpm --filter lovelace-accounts-service test:unit -- tests/unit/routes/fedcm/metadata-assertion.test.ts tests/unit/services/fedcm-assertion-service.test.ts
pnpm --filter lovelace-accounts-service typecheck
pnpm --filter lovelace-accounts-service lint:check
```

Expected: PASS.

## Task 3: Complete consent inside the FedCM continuation window

**Files:**

- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts-service/src/routes/oauth/consent.ts`
- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts/src/app/consent/page.tsx`
- Add: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts/src/app/consent/fedcm-consent-form.tsx`
- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts/src/app/api/auth/consent/approve/route.ts`
- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts/src/app/api/auth/consent/deny/route.ts`
- Test: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts-service/tests/unit/routes/oauth/consent.test.ts`
- Add test: `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts/tests/unit/consent/fedcm-consent-form.test.tsx`

### Step 1: Write failing service and UI tests

Prove:

- a redirect consent approval still returns `redirect_uri`;
- a FedCM consent approval returns the one-time `authorization_code` and no redirect URI containing it;
- a FedCM denial returns a stable denied result and no redirect;
- the client component calls `IdentityProvider.resolve(code)` only after approval succeeds;
- denial calls `IdentityProvider.close()` when available and presents a safe close-window fallback when unavailable;
- missing continuation APIs present a stable explanation and never put the code into browser navigation;
- the consent page identifies Docket by registered client metadata and renders only the four requested scopes in plain language.

Run:

```bash
pnpm --filter lovelace-accounts-service test:unit -- tests/unit/routes/oauth/consent.test.ts
pnpm --filter lovelace-accounts test:unit -- tests/unit/consent/fedcm-consent-form.test.tsx
```

Expected: FAIL because all consent results currently redirect.

### Step 2: Implement the continuation-aware consent response

- Decode and revalidate the opaque request on the service for every approve/deny request.
- Return a transport-specific response only after the existing OAuth approval/denial service succeeds.
- Keep authorization codes out of URLs, logs, analytics, and rendered HTML.
- Use a small client component so `IdentityProvider` access stays browser-only.
- Preserve the existing `ConsentForm` and redirect behavior for every non-FedCM request.

### Step 3: Re-run the focused gates

```bash
pnpm --filter lovelace-accounts-service test:unit -- tests/unit/routes/oauth/consent.test.ts
pnpm --filter lovelace-accounts test:unit -- tests/unit/consent/fedcm-consent-form.test.tsx
pnpm --filter lovelace-accounts-service typecheck
pnpm --filter lovelace-accounts typecheck
pnpm --filter lovelace-accounts-service lint:check
pnpm --filter lovelace-accounts lint:check
```

Expected: PASS.

## Task 4: Extend the reusable Lovelace FedCM request types for active mode and custom parameters

**Files:**

- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/packages/libraries/fedcm/src/types/fedcm-types.ts`
- Modify: `/Users/williecubed/Projects/ReasonableTech/lovelace/packages/libraries/fedcm/src/relying-party/api/fedcm-client.ts`
- Test: `/Users/williecubed/Projects/ReasonableTech/lovelace/packages/libraries/fedcm/tests/relying-party/api/fedcm-client.test.ts`
- Add: `/Users/williecubed/Projects/ReasonableTech/lovelace/.changeset/fedcm-active-mode.md`

### Step 1: Write failing public-library tests

Prove that callers can supply:

- `mode: "active"` at the identity request level;
- a serializable custom `params` record merged with the generated nonce;
- no accidental override of the generated/requested nonce;
- unchanged defaults for existing sign-in callers.

Run:

```bash
pnpm --filter @lovelace-ai/fedcm test -- --run tests/relying-party/api/fedcm-client.test.ts
```

Expected: FAIL because the public request type has no active mode or custom params option.

### Step 2: Implement the generic lower-level capability

- Add the current browser API's `mode?: "active" | "passive"` field.
- Add JSON-compatible provider parameters without embedding OAuth- or Docket-specific types.
- Ensure nonce remains present at both the legacy top level and in `params` for supported Chrome variants.
- Update public docs and add a changeset because this expands a published package API.

### Step 3: Re-run package gates

```bash
pnpm --filter @lovelace-ai/fedcm test
pnpm --filter @lovelace-ai/fedcm typecheck
pnpm --filter @lovelace-ai/fedcm lint:check
```

Expected: PASS with package coverage at the repository threshold.

## Task 5: Define Docket's attempt and browser request contracts

**Files:**

- Modify: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/packages/integrations/src/lattice-oauth.ts`
- Test: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/packages/integrations/tests/lattice/lattice-oauth.test.ts`

### Step 1: Write failing integration-contract tests

Prove:

- the required scope list contains exactly the four approved scopes;
- one authorization start creates one state value and one PKCE S256 verifier/challenge pair;
- the redirect URL and FedCM parameter payload use the same client, redirect URI, scopes, state, and challenge;
- the FedCM descriptor names Lovelace's web-identity config URL and `purpose: "oauth_authorization"`;
- neither public descriptor contains the code verifier or a client secret.

Run:

```bash
pnpm --filter @docket/integrations test -- tests/lattice/lattice-oauth.test.ts
```

Expected: FAIL because scopes include `profile email` and no FedCM descriptor exists.

### Step 2: Implement the pure contract helpers

- Replace the old pending-credential return type with an authorization-attempt secret/public pair.
- Derive both transport descriptors from that single attempt.
- Retain `beginLatticeAuthorization` as the redirect URL builder or make it a compatibility wrapper around the shared builder.
- Do not add browser global types to the integrations package.

### Step 3: Re-run the focused package gates

```bash
pnpm --filter @docket/integrations test -- tests/lattice/lattice-oauth.test.ts
pnpm --filter @docket/integrations typecheck
pnpm --filter @docket/integrations lint
```

Expected: PASS.

## Task 6: Persist Docket authorization attempts separately from active credentials

**Files:**

- Modify: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/packages/db/src/schema/agents.ts`
- Add: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/packages/db/drizzle/0122_fedcm_lattice_authorization.sql`
- Modify: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/packages/db/drizzle/meta/_journal.json`
- Add/modify: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/packages/db/drizzle/meta/0122_snapshot.json`
- Add test: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/packages/db/tests/migrations/lattice-authorization-attempt-migration.test.ts`

### Step 1: Write the failing schema/migration test

Require a `lattice_authorization_attempt` table with:

- ULID/id primary key;
- owner and connection foreign keys;
- unique hashed state or equivalent lookup key;
- sealed PKCE verifier;
- exact redirect URI and requested scopes;
- created, expires, consumed, and terminal-outcome timestamps/status;
- indexes for owner lookup and expiry cleanup;
- no mutation of `lattice_credential` when an attempt is inserted.

Run:

```bash
pnpm --filter @docket/db test -- tests/migrations/lattice-authorization-attempt-migration.test.ts
```

Expected: FAIL because the table and schema export do not exist.

### Step 2: Generate and refine the migration

```bash
pnpm db:generate
```

- Review generated SQL and snapshot before accepting them.
- Store only a hash of state if lookup semantics allow it.
- Reuse the existing credential sealing boundary for the verifier.
- Add constraints preventing double consumption and invalid lifecycle timestamps where consistent with repository conventions.

### Step 3: Re-run database gates

```bash
pnpm --filter @docket/db test -- tests/migrations/lattice-authorization-attempt-migration.test.ts
pnpm --filter @docket/db typecheck
pnpm --filter @docket/db lint
```

Expected: PASS.

## Task 7: Unify Docket's FedCM and redirect completion service

**Files:**

- Modify: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/api/src/routes/lattice-connection.ts`
- Modify: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/api/src/routes/lattice.ts`
- Modify: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/api/src/routes/lattice-oauth.ts`
- Add: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/api/src/services/lattice-authorization.ts`
- Test: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/api/tests/lattice/lattice-flow.test.ts`
- Test: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/api/tests/routes/lattice-oauth-branches.test.ts`
- Test: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/api/tests/routes/lattice-connection-branches.test.ts`
- Test: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/api/tests/routes/lattice-routes-branches.test.ts`

### Step 1: Write failing API tests

Define the start response as a transport-neutral contract containing:

- attempt id/opaque handle;
- `fedcm` provider config URL, client id, and custom parameters;
- `redirect.authorizationUrl`;
- expiry.

Add an authenticated FedCM completion route accepting only attempt handle plus code. Prove:

- a supported-path code completes and installs a credential;
- the legacy redirect callback completes through the same service;
- each attempt can complete only once, including concurrent submissions;
- expired, wrong-owner, wrong-connection, unknown-state, missing-code, bad-scope, and token-exchange failures are stable and safe;
- starting a replacement attempt leaves the old approved credential and connected status intact;
- failed, denied, dismissed, or expired replacement attempts leave the old connection usable;
- first-time attempts may show pending state without creating a fake credential row;
- the verifier is unsealed only inside server completion;
- successful replacement swaps the credential only after token validation succeeds.

Run:

```bash
pnpm --filter @docket/api test -- tests/lattice/lattice-flow.test.ts tests/routes/lattice-oauth-branches.test.ts tests/routes/lattice-connection-branches.test.ts tests/routes/lattice-routes-branches.test.ts
```

Expected: FAIL against the current single pending/approved credential row.

### Step 2: Implement attempt creation and one completion transaction

- Create/reuse the connection but never overwrite its active credential when starting.
- Persist sealed attempt material and return only the public transport descriptors.
- Move code exchange, scope validation, credential storage, connection status, and attempt consumption into a single service with transactional fences.
- Mark an attempt consumed/failed using Docket-owned closed reason codes.
- Have the redirect callback resolve state to the attempt and then call the shared service.
- Have the authenticated JSON route validate owner and call the same service.
- Preserve existing redirect return codes used by settings copy.

### Step 3: Re-run API and OpenAPI checks

```bash
pnpm --filter @docket/api test -- tests/lattice/lattice-flow.test.ts tests/routes/lattice-oauth-branches.test.ts tests/routes/lattice-connection-branches.test.ts tests/routes/lattice-routes-branches.test.ts
pnpm --filter @docket/api typecheck
pnpm --filter @docket/api lint
pnpm --filter @docket/api openapi:export
git diff --exit-code -- docs/api/openapi.json
```

Expected: tests/type/lint pass; generated API contract is deliberately updated and reviewed if the export path differs from the command above.

## Task 8: Invoke active FedCM from Docket and keep redirect fallback explicit

**Files:**

- Add: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/web/src/lib/lattice-fedcm.ts`
- Modify: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/web/src/app/(app)/settings/athena/lattice-section.tsx`
- Modify: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/web/src/app/(app)/settings/athena/lattice-copy.ts`
- Add test: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/web/tests/lib/lattice-fedcm.test.ts`
- Add test: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/web/tests/components/settings/lattice-section.test.tsx`

### Step 1: Write failing browser-helper tests

Prove the helper:

- detects FedCM using `IdentityCredential` and `navigator.credentials.get`;
- calls `navigator.credentials.get({ identity: { providers: [...] }, mode: "active" })` only from the click path;
- uses the exact server-provided provider config, client id, and custom params;
- accepts only an identity credential carrying a non-empty code token;
- classifies unsupported separately from dismissed/denied, transient failure, and malformed credential;
- never logs the returned code or raw DOMException.

Run:

```bash
pnpm --filter @docket/web test -- tests/lib/lattice-fedcm.test.ts
```

Expected: FAIL because the helper does not exist.

### Step 2: Write failing settings component tests

Prove:

- FedCM-capable browser: click starts an attempt, invokes active FedCM, submits the returned code, and renders connected state without page navigation;
- unsupported browser: the same click navigates to the returned Lovelace authorization URL;
- dismissed/denied FedCM: no automatic navigation occurs and an explicit “Continue in Lovelace” action appears;
- explicit continuation navigates only when the user clicks it;
- retry creates a fresh attempt rather than replaying a code or verifier;
- an already connected user retains connected copy and controls if relinking fails;
- loading/error copy says “Lovelace” to the user and does not expose FedCM/OAuth/provider internals.

Run:

```bash
pnpm --filter @docket/web test -- tests/components/settings/lattice-section.test.tsx
```

Expected: FAIL because the component always redirects.

### Step 3: Implement the browser adapter and UI state machine

- Keep browser global augmentation local to the helper.
- Model `starting -> prompting -> completing -> connected`, plus explicit `unsupported`, `dismissed`, and `failed` outcomes.
- Navigate automatically only for the pre-detected unsupported case.
- Store the explicit fallback URL only in component state for the current attempt.
- Invalidate/refetch Lattice connection queries after completion.
- Preserve offline-first Docket behavior outside this network-required connection action.

### Step 4: Re-run web gates

```bash
pnpm --filter @docket/web test -- tests/lib/lattice-fedcm.test.ts tests/components/settings/lattice-section.test.tsx
pnpm --filter @docket/web typecheck
pnpm --filter @docket/web lint
```

Expected: PASS.

## Task 9: Document rollout, compatibility, and operator controls

**Files:**

- Modify: `/Users/williecubed/Projects/TheHypertextStudio/athena-web/docs/WORKLOG.md`
- Add: `/Users/williecubed/Projects/ReasonableTech/lovelace/docs/engineering/fedcm-oauth-authorization.md` (use the repository's actual auth documentation location if a closer existing document is found)
- Modify: Lovelace environment/feature-flag registry docs and deployment examples discovered during implementation
- Modify: Docket environment registry only if a Docket-side kill switch is introduced

### Step 1: Add documentation assertions where the repositories support them

- Feature flag name, default, rollout order, rollback behavior, and metrics must be discoverable.
- Compatibility table must distinguish active FedCM, redirect-only browsers, logged-out Lovelace, consent-required, dismissal, denial, expiration, and relink failure.
- State explicitly that production Docket client registration must be public, require PKCE, include the exact Docket origin and callback, and allow only the required scopes.
- State that enabling Lovelace precedes enabling Docket UI use; rollback disables the FedCM branch while leaving redirect OAuth operational.

### Step 2: Run documentation/config gates

```bash
pnpm validate:config
pnpm validate:docs
```

in Lovelace, and:

```bash
pnpm docs:check
pnpm format:check
```

in Athena.

Expected: PASS.

## Task 10: Cross-repository acceptance and security verification

**Files:**

- Modify/add Lovelace acceptance coverage under `/Users/williecubed/Projects/ReasonableTech/lovelace/apps/lovelace-accounts/tests/acceptance/`
- Modify/add Docket acceptance coverage under `/Users/williecubed/Projects/TheHypertextStudio/athena-web/apps/web/e2e/lattice/`
- Add evidence under the repositories' existing engineering-evidence conventions only after an observed run

### Step 1: Automate the two compatibility paths

Run a local Lovelace Accounts service and Docket stack with a registered local public client. Cover:

1. Active FedCM with an existing grant.
2. Active FedCM with `continue_on` and explicit consent.
3. Dismissed FedCM followed by explicit redirect continuation.
4. Browser with no `IdentityCredential` using redirect directly.
5. Failed relink while an old credential remains usable.
6. One-time code replay and expired-attempt rejection.

Use browser automation only where the local browser exposes FedCM deterministically; otherwise keep protocol integration automated and record the native-dialog step as a manual Chrome acceptance gate.

### Step 2: Run protected focused suites

In Lovelace:

```bash
pnpm --filter @lovelace-ai/cloud-auth test:coverage
pnpm --filter @lovelace-ai/fedcm test:coverage
pnpm --filter lovelace-accounts-service test:coverage
pnpm --filter lovelace-accounts test:coverage
pnpm validate:config
pnpm typecheck --filter=@lovelace-ai/cloud-auth --filter=@lovelace-ai/fedcm --filter=lovelace-accounts-service --filter=lovelace-accounts
pnpm lint --filter=@lovelace-ai/cloud-auth --filter=@lovelace-ai/fedcm --filter=lovelace-accounts-service --filter=lovelace-accounts
```

Use the repository's exact Turbo filter syntax if root scripts reject forwarded filters. Do not repeat the full platform harness unless a focused failure or repository policy requires it.

In Athena:

```bash
pnpm --filter @docket/integrations test:coverage
pnpm --filter @docket/db test:coverage
pnpm --filter @docket/api test:coverage
pnpm --filter @docket/web test:coverage
pnpm typecheck
pnpm lint
pnpm docs:check
pnpm format:check
```

### Step 3: Perform actual-browser acceptance

On a FedCM-capable stable Chrome build over HTTPS or localhost:

- observe the native active FedCM dialog after the explicit Docket click;
- prove the Lovelace account chooser names Docket and Lovelace correctly;
- complete both existing-consent and continuation-consent paths;
- inspect browser/network state to prove the code is returned as the credential token, not placed in a URL;
- prove a non-FedCM browser reaches and completes redirect authorization;
- prove dismissal does not navigate until the explicit fallback button is clicked;
- disconnect/reconnect or relink and prove an old connection survives a failed attempt.

Do not claim native-dialog or production success from unit tests, protocol mocks, or build output. Record the exact external blocker if local IdP registration, browser policy, deployment, or production feature-flag authority prevents this gate.

### Step 4: Self-review and completion audit

- Compare every behavior against the authoritative design.
- Review the full diff in each repository and confirm unrelated dirty files were not modified or staged.
- Confirm no query, log, error, screenshot artifact, or test fixture contains a real secret/token.
- Confirm Lovelace changes have required changesets and public docs.
- Confirm Athena worklog reflects observed validation rather than predicted results.
- Commit logical product slices with linear history and repository-required commit bodies/trailers.
- Do not push, open a pull request, deploy, change production flags, or mutate OAuth client registration without separate explicit authority.
