# MCP Connector Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the Athena MCP connector flow to a readable URL-first setup path.

**Architecture:** Keep the existing API contract. Add a small client-side URL-to-identity helper, then use disclosure controls for optional configuration in the existing settings component.

**Tech Stack:** React, TypeScript, Vitest, Tailwind, Playwright.

---

### Task 1: Derive connector defaults

**Files:**

- Create: `apps/web/src/components/settings/mcp-connector-draft.ts`
- Test: `apps/web/tests/components/settings/mcp-connector-draft.test.ts`

- [x] Write a failing test proving `https://api.sunsama.com/mcp` derives `Sunsama` and `sunsama`.
- [x] Run `pnpm --filter @docket/web test -- mcp-connector-draft.test.ts` and confirm the missing helper fails.
- [x] Add the URL-derived helper without replacing an operator-authored name or alias.
- [x] Re-run the focused web test and confirm it passes.

### Task 2: Simplify the connector surface

**Files:**

- Modify: `apps/web/src/components/settings/mcp-connectors-section.tsx`

- [x] Remove the default protocol tutorial and reduce return-state copy to a short status.
- [x] Stack connector details vertically and hide server metadata behind a native disclosure.
- [x] Make the add flow URL-first, auto-fill identity fields, and hide alternate authentication methods behind a disclosure.

### Task 3: Verify the shipped screen

**Files:**

- Verify: `apps/web/src/components/settings/mcp-connectors-section.tsx`

- [x] Run focused web tests, typecheck, and lint.
- [x] Capture the rendered authenticated connections screen with Playwright.
- [x] Update `docs/WORKLOG.md`, commit, and verify a linear history.
