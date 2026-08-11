# Coverless Detail Header Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every core entity header collapse reliably while giving coverless pages a deliberate
expanded composition, a continuously resizing title, and an icon that moves from its own row into
the compact title row.

**Architecture:** `EntityDetailLayout` owns one scroll container and two shared ranges selected only
by cover presence. A passive, animation-frame-coalesced sampler converts absolute scroll offset into
a stable zero-to-one value and drives paused CSS keyframes without React rerenders. A size-contained
body runway and disabled scroll anchoring guarantee that short panels can reach the endpoint.

**Tech Stack:** React 19, TypeScript, shared CSS keyframes, Tailwind utilities, Vitest, Playwright
Chromium.

---

## Runtime correction to the proposed approach

The proposed plan used `animation-timeline: scroll(nearest)`. A serial Chromium fixture disproved
that approach: the body runway supplied ample overflow, but Chrome recomputed the scroll timeline's
percentage while the same animation reduced header height. The computed endpoint moved during
sampling and could still stop before one.

The implemented sampler preserves the intended CSS-owned interpolation while making progress a
function of absolute pixels. Runtime evidence then reached exact endpoints for covered, coverless,
and reduced-motion states. This correction is part of the plan rather than an unrecorded deviation.

### Task 1: Lock the collapse behavior

**Files:**

- Create: `apps/web/tests/components/entity-detail-collapse-contract.test.ts`
- Create: `apps/web/tests/components/entity-detail-collapse-progress.test.ts`

- [x] **Step 1: Add a source contract for shared geometry**

The contract requires:

```typescript
expect(layout).toContain("data-detail-cover={cover ? 'present' : 'absent'}");
expect(layout).toContain('useDetailHeaderCollapse({ hasCover: Boolean(cover) })');
expect(layout).toContain('detail-body page-bleed page-grid');
expect(css).toContain('container-type: size');
expect(css).toContain('overflow-anchor: none');
expect(css).toMatch(/min-block-size:\s*calc\(100cqb/);
```

- [x] **Step 2: Add executable progress cases**

```typescript
expect(resolveDetailCollapseProgress(0, 64, false)).toBe(0);
expect(resolveDetailCollapseProgress(32, 64, false)).toBe(0.5);
expect(resolveDetailCollapseProgress(64, 64, false)).toBe(1);
expect(resolveDetailCollapseProgress(1, 64, true)).toBe(1);
```

- [x] **Step 3: Verify RED in one Vitest thread**

Run:

```bash
pnpm --filter @docket/web exec vitest run \
  tests/components/entity-detail-collapse-contract.test.ts \
  tests/components/entity-detail-collapse-progress.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
```

Observed: both suites failed because the behavior module and stable geometry did not exist.

### Task 2: Implement invariant progress and geometry

**Files:**

- Create: `apps/web/src/components/views/entity-detail-collapse.ts`
- Modify: `apps/web/src/components/views/entity-detail-layout.tsx`
- Modify: `packages/ui/src/styles/globals.css`

- [x] **Step 1: Resolve bounded progress independently of layout**

```typescript
export function resolveDetailCollapseProgress(
  scrollTop: number,
  rangePixels: number,
  reducedMotion: boolean,
): number {
  if (!Number.isFinite(scrollTop) || !Number.isFinite(rangePixels) || rangePixels <= 0) return 0;
  if (reducedMotion) return scrollTop > 0 ? 1 : 0;
  return Math.min(Math.max(scrollTop / rangePixels, 0), 1);
}
```

- [x] **Step 2: Sample scroll without rerendering React**

`useDetailHeaderCollapse` attaches one passive listener, coalesces it through
`requestAnimationFrame`, and writes:

```typescript
scroller.style.setProperty('--detail-collapse-progress', String(progress));
scroller.style.setProperty('--detail-collapse-delay', `${-progress}s`);
```

Coverless uses four rem, covered uses six rem, and reduced motion selects only zero or one.

- [x] **Step 3: Give short panels stable block geometry**

```css
[data-detail-cover] {
  container-type: size;
  overflow-anchor: none;
}

.detail-body {
  min-block-size: calc(100cqb - 4rem + var(--detail-collapse-range));
}
```

The nested `page-grid` keeps route content on the original measure and extends only the end of a
short active panel.

- [x] **Step 4: Morph one identity tree through paused keyframes**

The glyph is absolutely positioned at the identity origin. Expanded title block padding puts it on
its own row; the compact endpoint removes that padding and adds a 2.25rem inline inset. The title
keyframe interpolates `headline-medium` to `title-medium`, while glyph scale, secondary grid row,
opacity, and optional backdrop use the same negative delay.

```css
.detail-title {
  overflow: hidden;
  padding-block-start: var(--detail-expanded-glyph-row);
}

.detail-title,
.detail-glyph,
.detail-secondary,
.detail-backdrop-space {
  animation-delay: var(--detail-collapse-delay);
  animation-duration: 1s;
  animation-fill-mode: both;
  animation-play-state: paused;
  animation-timing-function: linear;
}
```

- [x] **Step 5: Verify GREEN in one Vitest thread**

Observed: the collapse contract and progress suite passed 7/7 tests.

### Task 3: Verify browser geometry and affected contracts

**Files:**

- Modify: `docs/design/references/entity-detail-hierarchy.md`
- Modify: `docs/WORKLOG.md`

- [x] **Step 1: Run a serverless serial Chromium fixture**

The temporary fixture loaded the committed detail CSS directly and used one Chromium session. It
started no app server, watcher, browser MCP process, or worker pool. Measured results:

- Coverless title: 28px at 0, 22px at 32px, 16px at 64px.
- Covered title: 22px at 48px, 16px at 96px.
- Expanded icon content preceded the title by 52px; compact title content gained a 36px inline inset.
- Compact secondary height and opacity both reached zero.
- Reduced motion reached the compact 16px endpoint after one pixel.
- Endpoint maximum scroll remained 164px coverless and 196px covered.

The temporary fixture was deleted after Chromium closed.

- [x] **Step 2: Run affected automated checks serially**

```bash
pnpm --filter @docket/web exec vitest run \
  tests/components/entity-detail-collapse-contract.test.ts \
  tests/components/entity-detail-collapse-progress.test.ts \
  tests/components/projects/projects-experience-contract.test.ts \
  tests/components/initiative-visual-contract.test.ts \
  --pool=threads --maxWorkers=1 --no-file-parallelism
pnpm --filter @docket/web typecheck
pnpm --filter @docket/ui typecheck
pnpm --filter @docket/web lint
pnpm --filter @docket/ui lint
```

Observed: 4 files / 26 tests passed, both typechecks passed, and both package lints passed.

- [x] **Step 3: Reconcile the hierarchy reference and work log**

The documentation records the shared tree, variant ranges, absolute progress sampler, stable body
runway, reduced-motion endpoint behavior, serial runtime evidence, and the reason native scroll
timelines are not used for layout-changing collapse.

- [x] **Step 4: Complete final repository-state checks and commit documentation**

Run `git diff --check`, verify no process has this worktree as its current directory, and verify
`git rev-list --merges --count origin/main..HEAD` returns zero before the closeout commit.
