# GitHub OAuth production alias canonicalization

> **Status**: In progress
> **Date**: 2026-08-11

## Objective

Make GitHub sign-in reliably start and return on Docket's canonical production origin. Requests
made to the legacy `athena.hypertext.studio` alias must never reach Better Auth's `/api/auth/*`
rewrite on that unsupported host.

## Evidence

- The canonical Docket host emits `https://docket.hypertext.studio/api/auth/callback/github`.
- The Athena alias is absent from `BETTER_AUTH_ALLOWED_HOSTS`; its sign-in request falls back to
  `BETTER_AUTH_URL`, emitting the API-host callback instead.
- The web application's `/api/auth/*` rewrite is intentionally same-origin, so the fix belongs
  before that rewrite rather than in a GitHub App callback allowlist.

## Steps

1. Add a regression test describing a permanent, host-scoped redirect from the Athena alias to
   Docket, preserving every path.
2. Add the redirect to `apps/web/next.config.ts`, where Next evaluates redirects before rewrites.
3. Validate the focused test, type check, lint, and production build.
4. Deploy the resulting Vercel build and verify the alias redirects before a single production
   GitHub OAuth handoff is attempted.

## Risks and decisions

Adding the API host callback to GitHub would conceal the invalid public entry point and widen the
OAuth return surface. Supporting Athena as a first-class second origin would instead require a
complete trusted-origin rollout for every provider. The product's declared production hosts name
Docket only, so canonicalization is the intentionally narrow correction.
