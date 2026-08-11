# GitHub App installation lifecycle implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make GitHub Connections open GitHub's native installation chooser, record the chosen account and repositories, and return directly as a connected Docket integration.

**Architecture:** GitHub is an App-install provider, not a generic user-identity connector. The web client creates or reuses the organization integration, requests its signed installation URL, and navigates there. GitHub's Setup URL returns `installation_id` plus the signed state to the existing callback; the callback verifies the installation and redirects back to the Connections page. `pending` is redirect bookkeeping for every provider, so it is never rendered as a half-connected card or a second setup action.

**Tech Stack:** Next.js, React Query, Hono, Drizzle, Vitest, GitHub App settings.

---

### Task 1: Pin the intended client and proxy behavior

**Files:**

- Modify: `apps/web/tests/components/settings/integrations-config.test.ts`
- Create: `apps/web/tests/components/settings/github-app-install-flow.test.ts`
- Modify: `apps/web/tests/config/canonical-host-redirect.test.ts`

1. Write failing tests that declare GitHub a redirect-install provider, replace the pending action wording, hide unfinished records across providers, and route the setup callback through the product host.
2. Run the focused tests and confirm they fail because GitHub is currently excluded from the redirect-provider set and the internal callback has no rewrite.

### Task 2: Wire the GitHub App installation lifecycle

**Files:**

- Modify: `apps/web/src/components/settings/integrations-config.ts`
- Modify: `apps/web/src/components/settings/use-integrations-data.ts`
- Modify: `apps/web/src/components/settings/integration-row-actions.tsx`
- Modify: `apps/web/src/components/settings/integration-provider-card.tsx`
- Modify: `apps/web/src/components/settings/use-connections-controller.ts`
- Modify: `apps/web/next.config.ts`

1. Implement the minimal redirect-launch helper, then use it for GitHub create, retry, and change-installation actions.
2. Keep generic OAuth identity linking out of this path, so a disconnect does not preselect the previous identity.
3. Use precise install-language actions, let connected GitHub rows change their installation, refresh the connection list after the callback return, and keep pending rows out of every initial connection surface.
4. Run focused tests until they pass.

### Task 3: Correct GitHub App setup guidance and registration

**Files:**

- Modify: `scripts/integration-providers.ts`
- Modify: `docs/engineering/specs/env-and-bootstrap.md`

1. Replace the obsolete callback-only/OAuth-during-install directions with the product setup URL and Redirect on update.
2. In the live App, disable OAuth-during-install, set the product setup URL, and retain the canonical Better Auth callback for GitHub sign-in.
3. Verify a live install URL reaches GitHub's account/repository chooser and the callback returns to Docket.

### Task 4: Close out

1. Run focused API/web tests, web typecheck, lint, and build.
2. Commit only this lifecycle slice directly to `main`, push, await deployment, and repeat the live connection journey.
