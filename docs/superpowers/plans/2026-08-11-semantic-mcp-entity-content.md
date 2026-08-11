# Semantic MCP Entity Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Docket MCP entity view content-first, visually aligned with the product, and intentionally responsive from 320px upward.

**Architecture:** Keep the host-safe MCP runtime and entity document factory, but replace its universal fact-row renderer with semantic header, narrative, facts, relationship-section, and batch-item primitives. Hydrators add bounded human-readable previews from existing data; the server remains the only owner of deep links.

**Tech Stack:** TypeScript, Drizzle, MCP SDK, string-backed MCP App documents, Vitest, Playwright.

---

### Task 1: Add real relationship and identity previews

**Files:**

- Modify: `apps/api/src/mcp/resource-work-hydrators.ts:60-340`
- Modify: `apps/api/src/mcp/resource-meta-hydrators.ts:20-190`
- Modify: `apps/api/tests/mcp/mcp-surface.test.ts:974-1130`

- [ ] **Step 1: Write failing resource assertions**

```ts
expect(projectDto['tasks']).toEqual([expect.objectContaining({ title: 'Ship', state: 'todo' })]);
expect(updateDto['author']).toEqual(expect.objectContaining({ displayName: 'Ada' }));
expect(sessionDto['agent']).toEqual(expect.objectContaining({ displayName: 'Athena' }));
```

- [ ] **Step 2: Verify the test fails because current DTOs expose only ids/counts**

Run: `pnpm --filter @docket/api exec vitest run tests/mcp/mcp-surface.test.ts`

- [ ] **Step 3: Hydrate bounded task, relationship, and actor previews**

```ts
const tasks = await db
  .select({ id: task.id, title: task.title, state: task.state, dueDate: task.dueDate })
  .from(task)
  .where(and(eq(task.projectId, id), isNull(task.archivedAt)))
  .orderBy(asc(task.dueDate), asc(task.createdAt))
  .limit(4);

return { ...existingProject, tasks, ... };
```

Join `actor` for displayable update/comment/session/agent identities. Preserve current DTO fields, authorization, and resource-template behavior.

- [ ] **Step 4: Verify resource tests and API typecheck pass**

Run: `pnpm --filter @docket/api exec vitest run tests/mcp/mcp-surface.test.ts && pnpm --filter @docket/api typecheck`

- [ ] **Step 5: Commit the DTO work**

```bash
git add apps/api/src/mcp/resource-work-hydrators.ts apps/api/src/mcp/resource-meta-hydrators.ts apps/api/tests/mcp/mcp-surface.test.ts
git commit -F -
```

### Task 2: Build entity-owned content compositions

**Files:**

- Modify: `apps/api/src/mcp/apps/entity.ts:24-320`
- Modify: `apps/api/src/mcp/apps/runtime.ts:630-790`
- Modify: `apps/web/e2e/mcp/widget-shots.spec.ts:340-690`

- [ ] **Step 1: Add failing content-rich fixtures**

```ts
items: [
  {
    name: 'Bus Buddies',
    description: 'Pairs riders with reliable transit guidance.',
    tasks: [{ title: 'Recruit volunteer navigators', state: 'doing' }],
    latestUpdate: { body: 'Recruitment is ahead of schedule.' },
  },
];
```

Assert the description appears before supporting facts, `Active work` has real children, and a sparse fixture has no relationship heading.

- [ ] **Step 2: Verify the fixture fails against the generic fact renderer**

Run: `pnpm --filter @docket/web exec playwright test mcp/widget-shots.spec.ts --grep 'entity-project'`

- [ ] **Step 3: Implement semantic renderers over shared blocks**

```js
function renderProject(item) {
  renderHeader(item.name, item.description || item.summary);
  renderContext([status(item), health(item), target(item)]);
  renderSection('Active work', item.tasks, renderTaskPreview);
  renderSection('Milestones', item.milestones, renderMilestonePreview);
  renderNarrative('Latest update', item.latestUpdate && item.latestUpdate.body);
}
```

Dispatch to dedicated renderers for all twelve entity types. Update/comment render authored prose; session renders activity; program/initiative render real constituents; task retains the only edit controls. Never render an opaque id or an empty relationship heading.

- [ ] **Step 4: Replace entity-row styling with responsive semantic primitives**

```css
.entity-section {
  display: grid;
  gap: 8px;
  margin-block-start: 16px;
}
.entity-facts {
  display: grid;
  grid-template-columns: minmax(6rem, 0.35fr) 1fr;
  gap: 6px 16px;
}
.batch-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px 16px;
}
@container (max-width: 560px) {
  .batch-item {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
@container (max-width: 380px) {
  .batch-item {
    grid-template-columns: 1fr;
  }
  .batch-item .quiet {
    width: 100%;
    min-height: 2.5rem;
  }
}
```

Retain generic `.row` styling for non-entity widgets only.

- [ ] **Step 5: Run entity browser evidence**

Run: `E2E_EVIDENCE=1 pnpm --filter @docket/web exec playwright test mcp/widget-shots.spec.ts --grep 'entity-'`

- [ ] **Step 6: Commit compositions and screenshots**

```bash
git add apps/api/src/mcp/apps/entity.ts apps/api/src/mcp/apps/runtime.ts apps/web/e2e/mcp/widget-shots.spec.ts docs/design/audits/screenshots/mcp-apps
git commit -F -
```

### Task 3: Prove useful batches and task-only controls

**Files:**

- Modify: `apps/web/e2e/mcp/widget-shots.spec.ts:840-930`
- Modify: `apps/api/tests/mcp/mcp-apps.test.ts:180-270`

- [ ] **Step 1: Add failing semantic batch assertions**

```ts
await expect(body).toContainText('Pairs riders with reliable transit guidance.');
await expect(body.locator('.entity-section', { hasText: 'Associated work' })).toHaveCount(0);
await expect(body.locator('#state')).toBeHidden();
await expect(body.getByRole('button', { name: 'Open Bus Buddies in Docket' })).toBeVisible();
```

- [ ] **Step 2: Implement batch context priority**

```js
function batchContext(item) {
  return item.description || item.summary || latestUpdateText(item) || statusAndHealth(item);
}
```

One requested item produces one batch item with its own server link. Task state/due controls remain absent from every non-task entity.

- [ ] **Step 3: Run API and browser regressions**

Run: `pnpm --filter @docket/api exec vitest run tests/mcp/mcp-apps.test.ts tests/mcp/mcp-capabilities.test.ts tests/mcp/mcp-surface.test.ts && E2E_EVIDENCE=1 pnpm --filter @docket/web exec playwright test mcp/widget-shots.spec.ts --grep 'entity-'`

- [ ] **Step 4: Commit regression coverage**

```bash
git add apps/api/tests/mcp/mcp-apps.test.ts apps/web/e2e/mcp/widget-shots.spec.ts docs/design/audits/screenshots/mcp-apps
git commit -F -
```

### Task 4: Re-audit and close out

**Files:**

- Modify: `docs/design/audits/2026-08-05-mcp-apps.md`
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Inspect project detail/batch, program, update, session, and task evidence at 720px and 320px in both themes**

- [ ] **Step 2: Record scorecard evidence and the live-host release gate honestly**

- [ ] **Step 3: Run final checks**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm format:check && git diff --check`

Run separately: `pnpm test`; record any unchanged baseline failure.

- [ ] **Step 4: Commit the audit and work-log update**

```bash
git add docs/design/audits/2026-08-05-mcp-apps.md docs/WORKLOG.md docs/design/audits/screenshots/mcp-apps
git commit -F -
```

## Self-review

Tasks 1–3 cover the specification's entity hierarchy, real relationships, responsive recomposition, and task-only controls. Task 4 captures both visual proof and the release audit. The plan adds no migration, preserves server-owned links, and forbids count-only relationship sections.
