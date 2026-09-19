# Accessible Canvas Connections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Make Project and Task dependency connections easy to see, point at, click, and operate
from the keyboard without making the canvas visually heavy.

**Architecture:** Keep React Flow's built-in connection state and `connectOnClick` behavior. One
shared `CanvasConnectionHandle` owns the 32px interactive box, its 12px marker, the hover/focus/
connecting treatments, and Enter/Space activation. Project and Task nodes provide the object name
and pass their real `isConnectable` state so read-only canvases do not expose dead controls.

**Tech Stack:** React, TypeScript, React Flow 12, Tailwind CSS 4, Vitest, Testing Library.

---

### Task 1: Lock the accessible handle contract in tests

**Files:**

- Modify: `apps/web/tests/components/canvas/project-node-accessibility.test.tsx`
- Modify: `apps/web/tests/components/canvas/task-branch-node.test.tsx`
- Modify: `apps/web/tests/components/canvas/canvas-layout-lifecycle.test.tsx`

**Step 1: Write the failing tests**

Assert that editable Project and Task nodes expose two named connection buttons. Assert that each
button is 32px while its child marker is 12px. Press Enter and Space and assert that both keys issue
a click. Assert that read-only handles leave the tab order. Assert that `Canvas` explicitly keeps
React Flow's click-to-connect mode enabled.

**Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @docket/web exec vitest run \
  tests/components/canvas/project-node-accessibility.test.tsx \
  tests/components/canvas/task-branch-node.test.tsx \
  tests/components/canvas/canvas-layout-lifecycle.test.tsx --maxWorkers=1
```

Expected: FAIL because the current handle has an 8px marker, a 24px pseudo-element target, no
button semantics, no keyboard activation, and no explicit `connectOnClick` contract.

### Task 2: Implement one shared connection control

**Files:**

- Modify: `apps/web/src/components/canvas/canvas-connection-handle.tsx`
- Modify: `apps/web/src/components/canvas/project-node.tsx`
- Modify: `apps/web/src/components/canvas/task-node.tsx`
- Modify: `apps/web/src/components/canvas/canvas.tsx`
- Modify: `packages/test-utils/tests/design-policies/design-token-scan.ts`

**Step 1: Replace the pseudo-element target**

Make the React Flow handle itself 32px and transparent. Render a pointer-transparent 12px child
marker at its center. Grow and color the marker on hover, keyboard focus, and active connection
states while keeping the resting graph quiet.

The marker's surface-colored outline is the control boundary that keeps it distinct over every
node tone. Record that earned control outline in the design-token policy allow-set.

**Step 2: Add semantics and keyboard operation**

Give editable handles a name, `button` role, and tab stop. Make Enter and Space call the handle's
existing click path. Remove read-only handles from the accessibility tree and disable their start/
end behavior.

**Step 3: Make click-to-connect explicit**

Pass `connectOnClick` to `ReactFlow`. This keeps the non-dragging pointer path from depending on a
library default.

**Step 4: Run the focused tests to verify they pass**

Run the Task 1 command. Expected: 3 files pass.

### Task 3: Validate, document, land, and deploy

**Files:**

- Modify: `docs/WORKLOG.md`

**Step 1: Run bounded local checks**

Run focused Vitest with one worker, ESLint on touched files, Prettier, and `git diff --check`. Run
the repository's typecheck, lint, test, and build through Turbo with `--concurrency=2` when the
machine ceiling permits it.

**Step 2: Verify the real canvas**

Use `scripts/dev-stack.sh`, `dev-session.ts`, and `capture-shots.ts`. Confirm the marker remains
quiet at rest, the 32px box works by pointer, hover/focus states are visible in both themes, and
Enter/Space plus two clicks create a dependency.

**Step 3: Record evidence and commit**

Move the WORKLOG entry to completed only after the checks pass. Commit the behavior, tests, plan,
and evidence as one `fix(web)` slice with the required docs-impact and co-author trailers.

**Step 4: Land and deploy**

Fetch `origin/main`, rebase the delivery commit, fast-forward it into the primary checkout's
`main`, verify zero merge commits, run the release checks, push once, and verify the production web
and API endpoints plus the deployed Canvas behavior.
