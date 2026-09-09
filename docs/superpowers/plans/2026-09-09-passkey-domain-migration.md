# Passkey Domain Migration Implementation Plan

> **For Codex:** REQUIRED SKILL: Use superpowers:executing-plans to implement this plan task by
> task.

**Goal:** Let an Apple-platform Docket client prove an existing
`docket.hypertext.studio` passkey, register its replacement for `clearthedocket.com`, and retain the
normal Docket session without weakening account attachment.

**Architecture:** A gated Better Auth plugin owns the temporary legacy-RP assertion. It consumes a
signed one-use challenge, verifies the existing `passkey` row against the old RP and HTTPS origin,
advances the signature counter atomically, and issues the normal Better Auth session. The native app
keeps that session in memory while it runs the existing session-bound registration ceremony for the
current RP. It writes the session to Keychain only after registration succeeds. Public configuration,
both AASA responses, and both native associated-domain entitlements gate discovery of this bridge.

**Authoritative design:** `docs/engineering/specs/native-credentials.md`, section 5.

## Task 1: Add the gated server configuration contract

Write failing environment and public-contract tests for optional
`BETTER_AUTH_PASSKEY_LEGACY_RP_ID` and nullable `legacyPasskeyRpId`. Prove that configuration rejects
an empty value, hides an unset value, hides a value equal to `BETTER_AUTH_PASSKEY_RP_ID`, and exposes a
different configured RP. Add the optional server variable to `packages/env/src/slices.ts`, both
registry and API compositions, test fixtures, and deployment documentation. Add the nullable field to
`domains/identity-access/src/contracts/public-config.ts` and return it from
`apps/api/src/routes/config.ts` through a pure resolver.

Run the focused `@docket/env`, `@docket/identity-access`, and `@docket/api` tests through Turbo with
concurrency two. Run typecheck for those packages before moving on.

## Task 2: Implement the legacy assertion plugin with test-first security coverage

Create `packages/auth/tests/passkey-migration.test.ts` first. Cover successful discoverable option
generation, the configured old RP, required user verification, the derived HTTPS origin, signed
challenge-cookie binding, expiry, replay, wrong challenge kind, unknown credential, deleted owner,
verification failure, stale or concurrent counter advance, persistence failure, session-cookie minting,
rate limits, and removal of every route when the legacy RP is unset or equals the current RP. Assert
that unexpected exceptions map to one application-owned error and that no provider payload appears in
the response.

Implement `packages/auth/src/passkey-migration.ts` around injectable SimpleWebAuthn and database
ports. Reuse the `passkey` table. Consume the challenge before verification. Require
`userVerified === true`. Compare and update both the stored counter and `last_used_at` before creating
the Better Auth session. Return the authenticated user in the response shape the native client already
decodes. Export the plugin from `packages/auth/src/index.ts`, add its dependency injection fields to
`AuthDeps`, and mount it in `packages/auth/src/auth-builder.ts` only when the two RP IDs differ.

Run the focused auth suite, auth typecheck, auth lint, secret scan, and complexity ratchet with
concurrency bounded at two.

## Task 3: Prove current-RP registration works with the migration session

Add an auth integration test that runs the legacy assertion to obtain a normal session cookie. Use
that cookie to call the existing `/passkey/generate-register-options` route without a sign-up intent.
Submit a verified current-RP registration with both the session cookie and Better Auth challenge
cookie. Assert that the new passkey belongs to the same user, that the old row remains, and that a
fresh current-RP assertion issues a session. Cover cancellation-equivalent abandonment by proving an
unused short-lived session creates no new credential.

If Better Auth cannot accept both cookies through its stock registration routes, fix cookie assembly
at the plugin boundary without adding a second registration implementation. Do not duplicate Better
Auth passkey registration or create a database migration.

Run the auth integration suite against PGlite with at most two workers.

## Task 4: Add the native migration transport and model state

In the Apple repository, write failing Swift tests before production code. Extend
`PublicConfiguration` with `legacyPasskeyRpId` and prove discovery only when it differs from the current
RP and matches one of the app's claimed HTTPS domains. Add `AuthenticationAPIProtocol` operations for
legacy option generation, assertion verification, authenticated current-RP option generation, and
authenticated registration. Test the exact route paths, old and current `Origin` headers, challenge
cookie extraction, normal session extraction, and serialization of the combined session and challenge
cookies.

Implement those operations in `DocketAPIClient`. Keep cookie assembly in one helper that rejects
duplicate cookie names and never persists the temporary session. Extend `DocketAppModel` with
`moveExistingPasskey(using:)`. It must assert against the old RP, retain the returned session in memory,
register against the current RP, persist only after registration succeeds, return to signed out on
user cancellation, and show an application-owned recoverable error on every other failure. Add unit
tests that prove the vault stays empty after failure or cancellation and receives exactly one session
after success.

Run the macOS Swift unit tests with `-jobs 2`. Run the iOS simulator unit tests with the same bound.

## Task 5: Add the native migration interface and Apple domain entitlement

Write a UI test that exposes a **Move an existing Docket passkey** button only when live configuration
publishes the bridge. Add the control below account creation and above the alternate-provider group.
Use the same native `AuthorizationController` as normal passkey sign-in. Add an accessibility label and
keep the control reachable at accessibility text sizes without horizontal scrolling. Do not change the
primary current-passkey action.

Add `webcredentials:docket.hypertext.studio` beside `webcredentials:clearthedocket.com` in
`Athena/Athena.entitlements`. Update `docs/native-build-environments.md` to state that the legacy domain
is temporary and only migration uses it. Update the UI-test configuration fixture so normal signed-out
coverage includes the migration control without enabling it in production before the server advertises
it.

Run the macOS UI suite, iPhone simulator UI suite, and iPad simulator UI suite with `-jobs 2`. Capture
light and dark signed-out evidence at macOS, iPhone, and iPad widths. Inspect every capture for clipped
text, disabled provider controls, incorrect domain copy, and the Liquid Glass icon.

## Task 6: Serve both AASA records without weakening the canonical redirect

Write a web configuration test that distinguishes the AASA path from every other legacy-host path.
Keep `apps/web/public/.well-known/apple-app-site-association` as the one source document and preserve
`T95VDD3A4W.studio.hypertext.docket`. Configure Vercel so
`https://docket.hypertext.studio/.well-known/apple-app-site-association` returns that JSON directly
with HTTP 200 and no redirect while every other legacy path returns the canonical redirect to
`https://clearthedocket.com`.

Verify both live hosts with `curl --max-redirs 0`, content type, response body, and redirect location.
Do not treat a local Next.js rule as proof because the current redirect can occur at Vercel's domain
layer before Next.js runs.

## Task 7: Deploy the bridge and run the signed-device canary

Deploy the server variable and auth build before distributing the native build. Confirm live
`GET /v1/config` publishes both `passkeyRpId=clearthedocket.com` and
`legacyPasskeyRpId=docket.hypertext.studio`. Build the production iOS and macOS targets with automatic
signing under Hypertext Studio team `T95VDD3A4W`. Inspect the signed application identifier, both
associated domains, Sign in with Apple entitlement, environment marker, API base URL, WebAuthn origin,
Google client IDs, and Liquid Glass icon assets.

Install the production build on WilliePad. Use the existing old-domain passkey to prove the legacy
assertion, complete replacement registration, sign out, sign in with the new-domain passkey, restore
the session after relaunch, and sign out again. Record direct device evidence without logging
credentials, cookies, or WebAuthn payloads. Repeat assertion and restoration on a signed Mac.

## Task 8: Finish release validation and record the result

Run root `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` through Turbo with concurrency
two. Run the full native macOS and iOS simulator unit and UI suites with `-jobs 2`. Run secret scans,
documentation checks, `git diff --check`, and the repository's release checks. Keep provider-gated
Apple and Google controls hidden unless their live configuration is complete. Do not count the
passkey migration canary as proof of either provider.

Update `docs/WORKLOG.md` with exact local, deployed, and signed-device evidence. Record any Apple or
Google portal gate separately. Review each repository's owned diff, commit narrow `auth` slices with
the required co-author trailer, verify both histories contain no merge commit, and push each coherent
delivery once.
