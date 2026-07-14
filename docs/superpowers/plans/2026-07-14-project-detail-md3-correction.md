# Project Detail and MD3 Typography Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize application typography on canonical MD3 tokens and make Project detail expose real Project information in its first viewport.

**Architecture:** Define the complete MD3 type scale in the shared theme, remove the prior application-specific token names, and migrate production call sites mechanically. Keep Project hierarchy changes in the Project route and shared document component, and centralize object-detail detection in the app shell so the recovery nudge never enters those layouts.

**Tech Stack:** Next.js App Router, React, Tailwind CSS v4 theme tokens, Material Symbols Rounded, Vitest, Testing Library.

## Global Constraints

- Only canonical MD3 typography names may remain in application source.
- Icon containers and interactive targets stay at least 40dp.
- UI errors remain application-owned.
- Existing unrelated working-tree changes remain untouched.
- Every behavior change begins with a failing focused test.

---

### Task 1: Canonical MD3 typography

**Files:**

- Modify: `packages/ui/src/styles/globals.css`
- Modify: `packages/ui/src/lib/utils.ts`
- Modify: application TypeScript and TSX call sites that use removed token names
- Test: `apps/web/tests/components/initiative-visual-contract.test.ts`
- Test: `apps/web/tests/components/projects/projects-experience-contract.test.ts`

**Interfaces:**

- Produces: Tailwind classes `text-display-large` through `text-label-small`.
- Removes: `text-document-title`, `text-page-title`, `text-h1`, `text-h2`, `text-h3`, `text-body`, and `text-mono`.

- [ ] **Step 1: Write failing source contracts for the complete MD3 scale and removed names.**
- [ ] **Step 2: Run the focused visual-contract tests and confirm they fail on the old tokens.**
- [ ] **Step 3: Define the MD3 variables and update `tailwind-merge` font-size groups.**
- [ ] **Step 4: Migrate every production call site and use `font-mono` beside an MD3 size where needed.**
- [ ] **Step 5: Re-run the focused contracts and confirm they pass.**

### Task 2: Project hierarchy and actionable properties

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx`
- Modify: `apps/web/src/components/initiatives/initiative-icon-picker.tsx`
- Test: `apps/web/tests/components/projects/projects-experience-contract.test.ts`
- Test: `apps/web/tests/components/initiative-icon-picker.test.tsx`

**Interfaces:**

- Produces: a controlled `Properties` popover opened by its main trigger, health button, or target button.

- [ ] **Step 1: Add failing contracts for vertical icon placement, smaller glyphs, absent fallback overline and empty-people copy, and interactive Properties controls.**
- [ ] **Step 2: Run the Project contracts and confirm the expected hierarchy failures.**
- [ ] **Step 3: Implement the vertical identity block and controlled Properties popover.**
- [ ] **Step 4: Convert health and target to 40dp MD3 state-layer buttons and remove empty participant output.**
- [ ] **Step 5: Re-run Project and icon-picker tests and confirm they pass.**

### Task 3: Document contents and prose hierarchy

**Files:**

- Modify: `apps/web/src/components/initiatives/initiative-document.tsx`
- Modify: shared Markdown/freeform presentation styles
- Test: `apps/web/tests/components/initiatives/initiative-document.test.tsx`

**Interfaces:**

- Consumes: extracted headings from `extractMarkdownHeadings`.
- Produces: a one-column layout without contents and a two-column layout with contents.

- [ ] **Step 1: Add a failing component test proving heading-free documents occupy the full column.**
- [ ] **Step 2: Add failing assertions for MD3 document heading and body classes.**
- [ ] **Step 3: Make the desktop grid conditional on `headings.length >= 2`.**
- [ ] **Step 4: Apply `headline-medium`, `headline-small`, `title-large`, and normal `body-large` document styles.**
- [ ] **Step 5: Re-run the document tests and confirm TOC, focus, and empty-heading states pass.**

### Task 4: Keep security nudges out of object detail

**Files:**

- Modify: `apps/web/src/components/app-shell-frame.tsx`
- Modify: `apps/web/src/components/app-shell-utils.tsx`
- Test: `apps/web/tests/components/app-shell-frame.test.tsx`
- Test: `apps/web/tests/components/app-shell-utils.test.ts`

**Interfaces:**

- Produces: `isObjectDetailPath(pathname: string): boolean` for Project, Initiative, Task, Program, and Cycle detail routes.

- [ ] **Step 1: Add failing route-classification cases for every object-detail pattern and their overview counterparts.**
- [ ] **Step 2: Run shell tests and confirm the nudge still appears on detail routes.**
- [ ] **Step 3: Suppress the banner slot when `isObjectDetailPath(pathname)` is true.**
- [ ] **Step 4: Re-run shell tests and confirm detail routes exclude the nudge while Home and overview routes retain it.**

### Task 5: Verification and closeout

**Files:**

- Modify: `docs/WORKLOG.md`
- Update: responsive screenshots and design audit when rendered output changes materially

- [ ] **Step 1: Run focused Project, Initiative, shell, and UI tests.**
- [ ] **Step 2: Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.**
- [ ] **Step 3: Inspect Project detail at desktop/mobile in light/dark and verify the first viewport contains Project content.**
- [ ] **Step 4: Search production source for every removed typography token and require zero matches.**
- [ ] **Step 5: Complete the WORKLOG retrospective and create an atomic `fix(projects)` commit with a substantive body.**
