# Global Object Creation Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace page-owned create dialogs with one shell-mounted composer that can create current work objects in any writable workspace while preserving contextual defaults.

**Architecture:** A global creation provider owns the active request, target workspace, success routing, and cache invalidation. Kind-specific composer bodies retain their draft and REST payload logic but render through one shared context row and shell. Every existing launcher calls the provider with a discriminated request instead of mounting a dialog.

**Tech Stack:** Next.js App Router, React, TypeScript, TanStack Query, Hono RPC client, Radix/shadcn primitives, Vitest, Testing Library.

## Global Constraints

- Supported kinds are exactly `task | project | initiative | program | team`; do not expose manual cycle or workspace creation through this provider.
- Object type is fixed by the launcher.
- Target workspace defaults to the shell context and does not rebind the background shell before success navigation.
- Cross-workspace success opens the created object; Team success opens the destination Teams page.
- Keep application-owned error copy and the typed query layer; no component-level `useEffect` plus `fetch`.
- Preserve unrelated dirty-tree work, maintain linear history, and update `docs/WORKLOG.md`.

---

### Task 1: Global creation context and destination model

**Files:**

- Create: `apps/web/src/components/create-object/create-object-provider.tsx`
- Create: `apps/web/src/components/create-object/creation-context.tsx`
- Create: `apps/web/src/components/create-object/workspace-picker.tsx`
- Create: `apps/web/tests/create-object/create-object-provider.test.tsx`
- Modify: `apps/web/src/components/app-shell-frame.tsx`

**Interfaces:**

- Produce a discriminated `CreateObjectRequest` union for the five supported kinds.
- Produce `useCreateObject()` with `openCreate(request)` and `closeCreate()`.
- Resolve the selected workspace's detail, teams, members, roles, permissions, vocabulary, and default team through typed TanStack queries.

- [ ] Write failing provider tests for opening a kind, defaulting to shell context, switching among multiple workspaces, rendering a static single-workspace label, and closing.
- [ ] Run the focused tests and confirm they fail because the provider does not exist.
- [ ] Implement the provider, target context, workspace picker, shell mount, and permission/loading model.
- [ ] Run the focused tests to green and refactor without widening the supported-kind set.

### Task 2: Shared composer top row and task repeat creation

**Files:**

- Modify: `apps/web/src/components/composer/composer-shell.tsx`
- Modify: `apps/web/src/components/tasks/create-task.tsx`
- Modify: `apps/web/src/components/tasks/task-form-pickers.tsx`
- Modify: `apps/web/src/components/composer/template-menu.tsx`
- Modify: `apps/web/tests/composers/create-task.test.tsx`

**Interfaces:**

- The shell accepts a leading context row and an optional leading action slot.
- Task renders Workspace -> conditional Team -> Template above the title.
- `Create more` stays open, clears title/description, preserves every destination/property field, announces success, and refocuses title; Cmd/Ctrl+Shift+Enter performs the same continuation once.

- [ ] Add failing task-composer tests for header order, team omission, target workspace POST, workspace-reference clearing, scoped templates, and both repeat-create paths.
- [ ] Run the focused tests and confirm expected failures.
- [ ] Adapt the shell and task body, remove Team from the lower property strip, and implement repeat creation.
- [ ] Run task/composer tests to green.

### Task 3: Project, initiative, program, and team bodies

**Files:**

- Modify: `apps/web/src/components/projects/create-project.tsx`
- Modify: `apps/web/src/components/initiatives/create-initiative.tsx`
- Modify: `apps/web/src/components/programs/create-program.tsx`
- Modify: `apps/web/src/components/teams/create-team.tsx`
- Modify: corresponding composer tests under `apps/web/tests/composers/`

**Interfaces:**

- Project: Workspace -> Program -> Template; Team remains below.
- Initiative: Workspace -> Owner -> Template.
- Program: Workspace -> Owner -> Template.
- Team: Workspace only.

- [ ] Add failing per-kind tests for header controls, selected-workspace POST paths, reference clearing, and unchanged portable content.
- [ ] Run focused tests and confirm expected failures.
- [ ] Adapt the four kind bodies and remove promoted-field duplicates from their lower strips.
- [ ] Run all composer tests to green.

### Task 4: Launcher migration and centralized completion

**Files:**

- Modify: `apps/web/src/components/command-palette/use-command-actions.ts`
- Modify: object list/detail launchers under `apps/web/src/app/(app)/orgs/`
- Modify: `apps/web/src/components/programs/program-projects-panel.tsx`
- Remove: `apps/web/src/components/composer/use-compose-param.ts` when no usages remain.
- Modify/Create: command-palette and create-provider integration tests.

**Interfaces:**

- Launch requests carry initial workspace, kind-specific defaults, same-workspace completion mode, and optional callback.
- Provider invalidates destination query keys after every create and overrides same-workspace completion only when the target differs.

- [ ] Add failing tests for command-palette direct opens, template auto-apply, contextual defaults, same-workspace stay/open behavior, and cross-workspace routing.
- [ ] Run focused tests and confirm expected failures.
- [ ] Migrate every current launcher, remove local dialog state/mounts, and centralize success invalidation/navigation.
- [ ] Prove no live `composeHref`, `useComposeRequest`, or page-owned supported-kind dialog usage remains.
- [ ] Run web tests to green.

### Task 5: Documentation, review, and completion gates

**Files:**

- Modify: `docs/engineering/specs/templates.md`
- Modify: `docs/WORKLOG.md`

- [ ] Document the global ownership model, destination row, workspace switching, template visibility, and repeat-create behavior.
- [ ] Self-review the complete diff for plan coverage, accessibility, stale async data, and unrelated edits.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- [ ] Mark the worklog entry complete with files, evidence, and learnings.
- [ ] Commit the verified feature atomically with a Conventional Commit body of at least 100 characters.
