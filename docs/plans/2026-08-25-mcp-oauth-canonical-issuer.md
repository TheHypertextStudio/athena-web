# MCP OAuth canonical issuer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Codex Desktop complete Docket’s production MCP authorization flow by returning the canonical API issuer in the OAuth callback.

**Architecture:** Docket must continue to send browser authorization through the Web app’s same-origin `/api/auth` rewrite so the host-only session cookie is available. Better Auth’s JWT plugin will instead receive an explicit issuer based on `BETTER_AUTH_URL`, which is the canonical API origin. The OAuth provider then uses that stable issuer in discovery, authorization responses, and access tokens even when the request arrived through the Web proxy.

**Tech Stack:** TypeScript, Better Auth 1.6.14, OAuth 2.1, Vitest.

---

### Task 1: Pin the OAuth issuer

**Files:**

- Modify: `packages/auth/tests/builder/auth.test.ts`
- Modify: `packages/auth/src/auth-builder.ts`

**Step 1: Write the failing test**

Add a builder test that finds the JWT plugin and asserts its issuer is `BETTER_AUTH_URL + '/api/auth'` while dynamic `baseURL` remains enabled for approved Web hosts.

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter @docket/auth test -- auth.test.ts -t "pins the OAuth issuer" --maxWorkers=1`

Expected: FAIL because the JWT plugin has no explicit issuer.

**Step 3: Write the minimal implementation**

Pass the canonical API auth URL to Better Auth’s JWT plugin. Do not change the dynamic base URL, the authorization endpoint rewrite, or the host allowlist.

**Step 4: Run the test to verify it passes**

Run: `pnpm --filter @docket/auth test -- auth.test.ts -t "pins the OAuth issuer" --maxWorkers=1`

Expected: PASS.

### Task 2: Verify the OAuth contract

**Files:**

- Test: `packages/auth/tests/builder/auth.test.ts`
- Test: `apps/api/tests/mcp/mcp-scope.test.ts`

**Step 1: Run the focused package and MCP metadata tests**

Run: `pnpm --filter @docket/auth test -- auth.test.ts --maxWorkers=1` and `pnpm --filter @docket/api test -- mcp-scope.test.ts --maxWorkers=1`.

Expected: Both pass. The first proves the callback issuer cannot follow `docket.hypertext.studio`; the second proves discovery keeps the Web authorization endpoint and API token endpoint.

**Step 2: Verify the deployed discovery endpoints after release**

Run: `curl --fail --silent https://docket-api.hypertext.studio/.well-known/oauth-protected-resource/mcp` and inspect the path-aware authorization-server metadata.

Expected: The resource and issuer are under `docket-api.hypertext.studio`, while the authorization endpoint remains under `docket.hypertext.studio`.
