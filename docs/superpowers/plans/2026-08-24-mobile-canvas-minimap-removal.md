# Mobile Canvas Minimap Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the persistent minimap from mobile Work Canvas views while preserving direct navigation commands and the desktop minimap.

**Architecture:** The shared `Canvas` component will use Tailwind's `sm` breakpoint to control minimap visibility. CSS will own the breakpoint so server and client markup stay identical. Project Dependencies and Task graph will inherit the same rule without host-specific branches.

**Tech Stack:** React, TypeScript, Tailwind CSS, React Flow, Vitest, the Docket design-review browser workflow.

---

### Task 1: Hide the shared minimap on mobile

**Files:**

- Modify: `apps/web/src/components/canvas/canvas.tsx:416-445`

- [ ] **Step 1: Confirm the current mobile failure**

Open Project Dependencies and Task graph at 320×720 and 390×844. Confirm that each route renders
`.react-flow__minimap` with a nonzero rectangle below 640px.

Expected: The minimap consumes 128×80 pixels on both mobile routes.

- [ ] **Step 2: Add the responsive visibility rule**

Change the minimap class to this exact value:

```tsx
className =
  'pointer-events-auto !static !m-0 hidden !h-20 !w-32 shrink-0 !rounded-lg sm:block sm:!h-[150px] sm:!w-[200px]';
```

Keep the existing `minimap` and `density` rendering condition. This preserves a host's ability to
disable the minimap at every width.

- [ ] **Step 3: Format and lint the changed component**

Run:

```bash
pnpm exec prettier --check apps/web/src/components/canvas/canvas.tsx
pnpm --filter @docket/web exec eslint src/components/canvas/canvas.tsx
```

Expected: Both commands exit 0 with no warnings.

- [ ] **Step 4: Run the existing Canvas behavior suite**

Run:

```bash
pnpm --filter @docket/web exec vitest run \
  tests/components/canvas/canvas-layout-lifecycle.test.tsx \
  tests/components/canvas/project-graph-layout.test.ts \
  --pool=threads --maxWorkers=2 --no-file-parallelism
```

Expected: Nine tests pass. Do not add a test that inspects the Tailwind class. JSDOM cannot prove
responsive visibility, and that test would cover repository syntax instead of product behavior.

### Task 2: Verify mobile removal and desktop retention

**Files:**

- Create: `docs/design/audits/screenshots/2026-08-24-canvas-graphs/project-dependencies-320-dark-no-minimap-after.jpg`
- Create: `docs/design/audits/screenshots/2026-08-24-canvas-graphs/project-dependencies-390-dark-no-minimap-after.jpg`
- Create: `docs/design/audits/screenshots/2026-08-24-canvas-graphs/project-dependencies-390-light-no-minimap-after.jpg`
- Create: `docs/design/audits/screenshots/2026-08-24-canvas-graphs/project-dependencies-1024-light-minimap-retained-after.jpg`
- Create: `docs/design/audits/screenshots/2026-08-24-canvas-graphs/task-graph-320-dark-no-minimap-after.jpg`
- Create: `docs/design/audits/screenshots/2026-08-24-canvas-graphs/task-graph-390-dark-no-minimap-after.jpg`
- Create: `docs/design/audits/screenshots/2026-08-24-canvas-graphs/task-graph-390-light-no-minimap-after.jpg`
- Create: `docs/design/audits/screenshots/2026-08-24-canvas-graphs/task-graph-1024-light-minimap-retained-after.jpg`

- [ ] **Step 1: Start only the API and Web development services**

Run each command in its own bounded background terminal:

```bash
pnpm exec dotenv -e .env.local -- pnpm --filter @docket/api dev
pnpm exec dotenv -e .env.local -- pnpm --filter @docket/web dev
```

Expected: The branch-specific API and Web URLs report ready. Do not start admin or marketing.

- [ ] **Step 2: Verify both mobile routes**

Use the hidden in-app browser. Capture both routes at 320×720 dark and at 390×844 in light and
dark. For each capture, evaluate these facts:

```js
const minimap = document.querySelector('.react-flow__minimap');
const controls = document.querySelector('.react-flow__controls');
const toolbar = document.querySelector('[aria-label="Canvas view controls"]');

return {
  minimapDisplay: minimap ? getComputedStyle(minimap).display : null,
  width: innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  controls: controls?.getBoundingClientRect().toJSON(),
  toolbar: toolbar?.getBoundingClientRect().toJSON(),
};
```

Expected: `minimapDisplay` is `none`, `scrollWidth` equals `width`, and the zoom controls do not
overlap the viewport toolbar.

- [ ] **Step 3: Verify both desktop routes**

Capture both routes at 1024×768 light. Run the same DOM probe.

Expected: `minimapDisplay` is `block`, the minimap has a nonzero rectangle, and the dock does not
overlap.

- [ ] **Step 4: Restore browser state and stop local services**

Reset the temporary viewport and color-scheme emulation. Stop only the API and Web terminals that
this task started.

### Task 3: Close the audit and worklog

**Files:**

- Modify: `docs/design/audits/2026-08-24-canvas-graphs.md`
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Replace the obsolete mobile-minimap evidence**

Update the audit to state that mobile contains only zoom and viewport actions. Add the eight new
screenshot names. Record the mobile `display: none` result and the desktop `display: block` result.
Keep the SHIP verdict only if every live gate passes.

- [ ] **Step 2: Complete the worklog task**

Move `CANVAS-MOBILE-MINIMAP-001` to `COMPLETED`. Record the breakpoint, retained actions, live
measurements, console result, commands, and retrospective. Remove the design-review blocker.

- [ ] **Step 3: Run final focused validation**

Run:

```bash
~/.claude/resource-limits/agentctl status
pnpm --filter @docket/web typecheck
pnpm exec prettier --check \
  apps/web/src/components/canvas/canvas.tsx \
  docs/WORKLOG.md \
  docs/design/audits/2026-08-24-canvas-graphs.md \
  docs/superpowers/plans/2026-08-24-mobile-canvas-minimap-removal.md
git diff --check
```

Expected: The resource guard remains below its ceilings. Every validation command exits 0.

- [ ] **Step 4: Commit the product change**

Stage only the shared Canvas, audit, worklog, plan, and eight screenshots. Commit with:

```bash
git commit -F - <<'EOF'
fix(web): Remove the mobile Canvas minimap

Large graphs reduce to illegible marks inside the 128 by 80 mobile minimap.
The permanent overview also consumes space needed by direct Canvas actions.

Hide the minimap below 640px while retaining zoom, Fit all, Fit selection,
and Re-layout. Keep the existing pannable minimap on wider screens, where it
has enough space to support graph orientation.

Co-authored-by: Codex <codex@openai.com>
EOF
```

Expected: The commit hook formats the staged files, selects `@docket/web` lint, validates the
message, and creates one commit.
