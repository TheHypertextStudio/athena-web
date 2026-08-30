# Native entity detail header audit

This record is for the release owner. Re-run the local browser evidence before treating the native
entity identity and detail-header change as visually approved.

The source and focused component checks cover adaptive tabs, shared identity mutations, print
composition, and the three distinct Overview contracts. Playwright discovers the two disposable
local evidence specs, including 1440px through 320px and light/dark screenshots at 1440px and
390px.

The audit has no score because the worktree-local Next server did not serve its first route. Both
Turbopack and webpack listeners accepted connections on port 4999 on 2026-08-29. Each request
remained inside Next compilation and returned no bytes after 30 seconds. No screenshot paths exist.

Run `E2E_EVIDENCE=1 pnpm --filter @docket/web test:e2e -- e2e/work/entity-detail-header-evidence.spec.ts e2e/work/project-detail-header-evidence.spec.ts` against a working disposable local stack. Then score both 1440×900 and 390×844 captures in light and dark modes with the Docket Craft Rubric.
