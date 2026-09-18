# Drafting system, error presentation, dependencies canvas, and task detail: design

> **Status**: Approved 2026-09-18; implementation in progress on `claude/drafting-system-ui-polish-d6eba3`
> **Date**: 2026-09-18
> **Source**: the 2026-09-17 product notes (drafting, errors, canvas, tasks screen)
> **Companions**: `docs/engineering/specs/planning-canvas.md` (the plan-draft pattern),
> `docs/engineering/specs/data-layer.md` §2.7 (the error contract), `docs/design/craft-rubric.md`,
> `docs/design/audits/2026-09-07-today-and-task-detail.md`

## Context

The 2026-09-17 notes list four problems in the Docket web app. The user chose to plan all four as one
sequenced program, shipped in the order below, each as its own commit series on this worktree branch
(`claude/drafting-system-ui-polish-d6eba3`).

1. **Drafting system.** Create composers (`ComposerShell`) hold their draft in React state and reset on
   every open. "Keep editing" on the discard prompt appears to create the entity. There is no draft
   table, no autosave, no way to see pending drafts. Target: Linear's behavior (documented at
   linear.app/docs/creating-issues): a close prompt offering Save draft / Discard, a Drafts page in the
   sidebar, drafts kept 6 months, and the composer reopening the last draft. Autosave with standard
   debouncing; a per-user setting (default off) that makes the composer resume the pending draft.
2. **Errors.** ~150 ad hoc `<p role="alert" className="text-error">` renderings between UI. No toast
   system exists although `docs/engineering/specs/design-system.md` specifies one. The classified
   failure layer (`failurePresentation`) has one consumer.
3. **Canvas.** Canvas chrome sits at `z-[2000]` and paints over the dialog scrim (`z-[110]`). Any
   dependency edit re-runs the whole dagre layout and bin-packing so every node jumps. The Projects
   dependencies view is a toggle inside the roster page under a ~150px header, and the flow viewport is
   shrunk ≥180px for the minimap/toolbar instead of them overlaying it.
4. **Task detail.** `/orgs/[orgId]/tasks/[taskId]` is the only detail page that does not compose
   `EntityDetailLayout`; it needs a Linear-issue-grade redesign aligned with project/initiative detail.

### Decisions already made with the user

- All four areas, sequenced: drafting → errors → canvas → task detail.
- Drafts are visible via a "Drafts (n)" chip in the composer action row (popover to resume/delete) and a
  sidebar "Drafts" entry that appears only when the user has drafts, leading to a Drafts page.
- The dependencies view becomes its own route under a **shared Next.js layout** with the Projects roster,
  with a **shared-element view transition** morphing the roster title into the floating canvas bar.
- Task-detail redesign scope is the task detail page only (not `/tasks` or the org roster).
- Linear's live UI could not be inspected (login required); the plan follows Linear's documented
  draft behavior plus its known issue-page anatomy.

### Verified facts driving the design

- Only durable draft today: `plan_draft` (`packages/db/src/schema/plan-draft.ts`, store
  `apps/api/src/lib/plan-draft/store.ts` with revision + 412 rebase, web `apps/web/src/lib/plan-draft/defs.ts`).
  It is the pattern, not the storage, for composer drafts.
- Root cause of the "Keep editing" bug: `apps/web/src/components/composer/composer-shell.tsx` shows
  the discard prompt in place of the Create button, but the form `onSubmit` (:351), the body editor's
  `onSubmit` (:259) and the Cmd/Ctrl+Shift+Enter capture (:307) are not gated on `confirmingDiscard`,
  and `editDisabled` (:243) excludes it. Enter in the title or body creates the entity while the prompt
  is showing. `onKeepEditing` itself only clears the flag.
- Debounced autosave seam exists: `apps/web/src/lib/use-debounced-autosave.ts` (600 ms, `flush()`).
- User preferences: `hub.preferences` jsonb; contract `domains/planning/src/contracts/hub-preferences.ts`;
  `mergeHubPreferences` in `apps/api/src/routes/hub.ts:132-144` must list any new group.
- Error layer: `apps/web/src/lib/failure-presentation.ts`, `PROBLEM_CATALOG` (39 codes) in
  `apps/web/src/lib/contracts/errors.ts`, `InlineBanner` (1 consumer), `EmptyState` (no error tone),
  `WorkViewLoadFailure` (the only classified failure UI). Policy test
  `packages/test-utils/tests/workspace-policies/web-error-source-policy.test.ts` forbids reading `.message`.
- Canvas: `@xyflow/react` + dagre; chrome z-index from `apps/web/src/components/canvas/canvas-overlay-panel.tsx`;
  layout memo key folds every edge (`graph-layout-engine.ts:95-104`); nodes already update inside
  `startViewTransition` (`use-controlled-flow.ts:65-83`). Shell pattern to copy: plan route
  `apps/web/src/app/(app)/orgs/[orgId]/plans/[planId]/plan-client.tsx` + `CanvasFloatingBar`.
- Task detail: `EntityDetailLayout` (`apps/web/src/components/views/entity-detail-layout.tsx`) is composed
  by project, initiative, program, cycle, team; task detail hand-rolls its masthead.

---

## Part 1 — Drafting system

### 1.1 Bug fix: the discard prompt must own the keyboard (`fix(web)`)

File: `apps/web/src/components/composer/composer-shell.tsx`.

- `editDisabled = creating || contentDisabled || confirmingDiscard` (line 243).
- Gate the form `onSubmit` (351), the body editor `onSubmit` (259), and the Cmd/Ctrl+Shift+Enter capture
  (307) on `!confirmingDiscard`.
- When the prompt opens, focus its primary button; a second Escape while confirming means "Keep editing";
  "Keep editing" restores focus to the title input.
- Tests in `apps/web/tests/composers/`: with the prompt showing, Enter in title, Enter in body, and
  Cmd+Shift+Enter issue no POST; "Keep editing" returns an editable, focused form; then Create issues one
  POST. Escape while confirming returns to editing.

### 1.2 Scope of draft kinds

The five global composers mounted in `apps/web/src/components/app-shell-frame.tsx:1041-1045`:
task, project, initiative, program, team. `CreateCycleDialog` has no host and `TemplateEditorDialog`
edits a persisted record, so both keep the legacy "Discard this draft?" prompt and get no persistence.

### 1.3 Contract + schema + API (`feat(api)`)

- **Contract** `domains/work/src/contracts/composer-draft.ts` (export `./composer-draft-contract` in
  `domains/work/package.json` next to `plan-draft-contract`): `ComposerDraftKind` enum; one Zod object
  per kind discriminated on `kind`, every field optional, field names mirroring each composer's draft
  interface (`TaskDraft` at `create-task.tsx:83-101`, `ProjectDraft` at `create-project.tsx:79-99`,
  initiative `:76-86`, program `:65-73`, team `create-team.tsx:104-111`; project payload includes
  `milestones[]`); `ComposerDraftPayload` discriminated union; `ComposerDraftOut` (id, organizationId,
  kind, revision, payload, server-derived `title | null`, createdAt, updatedAt, expiresAt);
  `ComposerDraftCreate` (refine payload.kind === kind, same idiom as `TemplateCreate`),
  `ComposerDraftPatch { revision, payload }`, `ComposerDraftListQuery { kind?, organizationId? }`,
  `COMPOSER_DRAFT_TTL_DAYS = 183`, `composerDraftTitle(payload)`. Many drafts per kind (Linear allows
  many). Tests `domains/work/tests/composer-draft-contract.test.ts`.
- **Schema** `packages/db/src/schema/composer-draft.ts` (own file like `plan-draft.ts`, exported from
  `schema/index.ts`): `composer_draft_kind` pgEnum; `composer_draft` table with id, ownerUserId →
  user (cascade), organizationId → organization (cascade), kind, revision int default 0, payload jsonb,
  createdAt/updatedAt, expiresAt; indexes on (owner, org, kind, updatedAt) and (expiresAt). Migration
  `packages/db/drizzle/0134_composer_draft.sql` + journal entry, mirroring `0133_plan_draft`.
- **Store** `apps/api/src/lib/composer-draft/store.ts` modeled on `plan-draft/store.ts`: `loadOwnedDraft`,
  `listOwnedDrafts` (updatedAt desc, `expiresAt > now`), `createDraft` (membership via the exported
  `ownerActorInOrg` from `plan-draft/store.ts:66`; `expiresAt = now + TTL`), `patchDraft`
  (transaction, `FOR UPDATE`, 412 on revision mismatch, 422 on kind mismatch, revision+1, renew
  expiresAt), `deleteDraft`, `presentDraft`. Sweep `apps/api/src/routes/composer-draft-sweep.ts`
  shaped like `session-sweep.ts`; cron route `POST /expired-drafts-sweep` in `routes/cron.ts`, job in
  `scripts/scheduler-setup.ts` (daily), line in `apps/api/src/dev-scheduler.ts`.
- **Routes** `apps/api/src/routes/me-drafts.ts`, mounted at `/me/drafts` beside `/me/plans` in
  `apps/api/src/app.ts:250`: GET list (`?kind&organizationId`), POST 201, GET `:id`, PATCH `:id`
  (200 / 412 / 422 / 404), DELETE `:id` 204. `apiDoc` descriptions in the `me-plans.ts` style; add to
  the inventory in `docs/engineering/specs/api-rpc-contract.md`. Tests
  `apps/api/tests/routes/me-drafts.test.ts` following `me-plans.test.ts` (create→list→patch→412→replay→
  delete→404; stranger denied; non-member org 404; kind mismatch 422; filters; sweep; expiresAt renewal).

### 1.4 Resume-drafts preference (`feat(web)`)

- `domains/planning/src/contracts/hub-preferences.ts:73`: add group
  `composer: { resumeDrafts?: boolean }` (default off by absence).
- `apps/api/src/routes/hub.ts:137-143` `mergeHubPreferences`: add the `composer` group; extend
  `apps/api/tests/routes/hub-preferences.test.ts`.
- Settings row: `SettingsGroup` + `SettingRow` + `Switch` (pattern `settings/places/page.tsx:246-261`)
  on the personal Profile page, node in `settings-capabilities.ts`. Read via `queryKeys.hubPreferences()`,
  write via `useApiMutation` PATCH (pattern `settings/athena/page.tsx:29-46`). Label "Resume drafts when
  creating"; description says drafts stay reachable from the chip and page either way.
- Shared reader `useResumeDraftsPreference()` in `apps/web/src/lib/drafts/defs.ts`.

### 1.5 Autosaved composer drafts (`feat(web)`, the core)

- **Data layer** `apps/web/src/lib/query-keys.ts` (`drafts()`, `draft(id)`) and new
  `apps/web/src/lib/drafts/defs.ts`: one list query for all of the user's drafts (`draftsDef()`,
  `useComposerDrafts()`, `useDraftCount()`), `fetchComposerDraft(id)` for 412 rebase, and
  create/patch/delete mutations via `useApiMutation` that update the list cache by id.
- **Codecs** beside each composer (`tasks/task-draft-codec.ts`, etc.): `serialize(draft) → payload`,
  `hydrate(payload, rosters) → Partial<Draft>` dropping references absent from the loaded option rosters;
  project milestones get fresh keys. Pure; tests `apps/web/tests/composers/draft-codecs.test.ts`.
- **Hook** `apps/web/src/components/composer/use-composer-draft-persistence.ts`
  (`useComposerDraftPersistence({ kind, orgId, enabled, draft, isDirty, serialize, hydrate, updateDraft,
resumeDraftId })` → `{ controls, loadGeneration, commit() }`). Uses `useDebouncedAutosave` (600 ms)
  with a `NO_ROW` sentinel baseline and `ready = enabled && orgId && isDirty && !disposed`, so a row is
  created only once typed text exists. Saves are chained through a promise ref (no double POST); first
  save POSTs, later saves PATCH with the last revision; 412 → refetch and replay once. Save failure sets
  `saving: 'error'` (chip shows "Not saved"; next edit retries) and never blocks editing or submit.
  `loadDraft(id)` hydrates and bumps `loadGeneration`. `onDiscard` cancels, awaits inflight, DELETEs,
  disposes. `onKeep` flushes and disposes. `commit()` (after a successful create) deletes the row; in
  "Create more" the hook re-arms for the next dirty draft. Unmount flushes if dirty. Retargeting the
  workspace deletes the old row (organizationId is immutable).
- **ComposerShell** gets one optional prop `drafts?: ComposerDraftControls` (`items`, `currentId`,
  `saving`, `onLoad`, `onDelete`, `onKeep`, `onDiscard`). Extract two components to keep the shell
  under its complexity ceiling: `composer-drafts-chip.tsx` (leading ghost "Drafts (n)" button in the
  action row, shown when items > 0, opening a `Popover` with a `PickerList`
  (`packages/ui/src/components/pickers/PickerList.tsx`) of title-or-"Untitled <noun>", `relativeTime`,
  trailing delete) and `composer-close-prompt.tsx` (with `drafts`: "Save this draft?" →
  [Discard] [Keep editing] [Save draft primary, focused]; without: the legacy row). A polite
  `role="status"` "Saving…/Saved/Not saved" text, visible only in the error state.
- **Wire the five composers**: prop `resumeDraftId`, call the hook, pass `drafts` and fold
  `loadGeneration` into `bodyResetKey`; call `persistence.commit()` after the create resolves (task:
  `create-task.tsx:456`) and before `completeContinuation` in the Create-more branch. Migrate
  `create-team.tsx` to `useComposerDraft` so it has `updateDraft`. Loading a draft never re-applies
  `defaultTemplateId`.
- **Provider** `create-object-provider.tsx`: `CreateObjectRequestBase.draftId?`; on `useAppPathname()`
  change while a request is open, write an interrupted pointer `{ kind, draftId }` to sessionStorage
  (`docket.composer.interrupted`, same tier as open-document tabs) and `closeCreate()`, which is
  Linear's "navigate away keeps a temporary draft". Each `Global*ComposerDialog` computes
  `resumeDraftId = request.draftId ?? interruptedPointer(kind) ?? (resumeDrafts && newestDraft(kind, org)) ?? null`
  and includes "drafts query settled" in `destinationReady` only when a resume is possible, so the
  composer never mounts pristine and then jumps.
- Tests (`apps/web/tests/composers/`, fake timers): one POST after debounce then PATCH; no POST from
  property picks alone; prompt primary is Save draft; Save keeps the row; Discard DELETEs; create
  DELETEs; Create-more re-arms; 412 replay; chip loads a draft and bumps the editor key; `resumeDraftId`
  hydrates; provider closes on pathname change and writes the pointer; hook race/dispose rules.

### 1.6 Drafts page and sidebar entry (`feat(web)`)

- `packages/ui` nav model: add `'drafts'` to `HomeNavKey` (`shell/workspaces.ts:39`), a `home:drafts`
  definition after inbox in `navigation-catalog.tsx`, a descriptor (`href: '/drafts'`) in
  `navigationDescriptors.ts`, `hiddenHomeKeys` on `resolveNavigationCatalog` (`:300-316`), and generalize
  the Inbox badge special case (`ExpandedSidebar.tsx:181`, `NavigationRail.tsx:53`) into a
  `badges` map. `Sidebar` takes `draftCount` and hides the entry when 0. Unit tests in `packages/ui`.
- Shell: `homeKeyFromPath` adds `/drafts` (`app-shell-utils.tsx:19-29`); `app-shell-frame.tsx` reads
  `useComposerDrafts()` and passes `draftCount`.
- Page `apps/web/src/app/(app)/drafts/{page.tsx,drafts-client.tsx}`: server prefetch like
  `inbox/page.tsx`; `ListView`/`ListGroup`/`ListRow` grouped by kind (vocabulary-skinned headers), rows
  show title-or-Untitled, workspace name, relative time, delete; activating a row calls
  `openCreate({ kind, initialWorkspaceId, draftId })`. Empty state via `EmptyState`.
- e2e `apps/web/e2e/work/composer-drafts.spec.ts`: title → Esc → Save draft; reopen → chip → restored;
  sidebar Drafts badge 1; `/drafts` row opens the composer; setting on → composer pre-filled; Discard
  removes row and sidebar entry.

### 1.7 Docs

`docs/engineering/specs/drafts.md` (ownership table, lifecycle pristine → dirty → autosaved → kept |
discarded | committed | expired, Linear mapping, the setting, revision protocol, exclusions, sweep);
route inventory in `api-rpc-contract.md`; a pointer in `inline-editing-titles-and-quick-add.md`; WORKLOG.

---

## Part 2 — Error presentation

### 2.1 Taxonomy (the contract `docs/engineering/specs/error-presentation.md` publishes)

| Situation                                                          | Primitive                                                                          | Where                                              | Copy source                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| Field validation attributable to one control                       | `Field error=` / new `FieldError`                                                  | Under the control (the one sanctioned inline case) | app-owned string                        |
| Mutation / action failure, optimistic revert, imperative auth call | Toast (default from `useApiMutation`, or `presentFailure()`)                       | Bottom-right toaster, mounted once                 | `failurePresentation`                   |
| Load failure with nothing to show                                  | `LoadFailure` over `EmptyState tone="critical"`                                    | Replaces the content region                        | `failurePresentation` + `failureAction` |
| Partial / degraded load with rows visible                          | `InlineBanner tone="critical"` (+ action)                                          | Above the rows                                     | app-owned string                        |
| Overlay / picker list failed                                       | `InlineBanner density="compact"`                                                   | Inside the overlay                                 | app-owned string                        |
| Route crash                                                        | existing `error.tsx` fallbacks                                                     | content region                                     | fixed copy                              |
| Queued offline write                                               | neutral toast "Saved on this device" from `useApiMutation`'s existing early return | toaster                                            | fixed copy                              |

Rule: no `text-error`/`bg-error`/`border-error` class and no intrinsic `role="alert"` element in product
code; those live only in `@docket/ui` primitives/feedback and `apps/web/src/components/feedback/`.

### 2.2 Primitives in `@docket/ui` (`feat(design)`)

- `packages/ui/src/components/feedback/toast.ts`: `ToastTone`, `ToastAction` (onSelect | href),
  `ToastNotice { title, detail?, tone?, action?, dedupeKey?, durationMs? }` (structurally cannot carry an
  Error), `notify()`, `notifyFailure()`, `dismissNotice()`; implemented on `sonner`'s `toast.custom` so
  Docket owns the card markup. Add `sonner` to `packages/ui/package.json` at an exact pin; verify the
  installed major's `toast.custom`/`Toaster` API via ctx7 before writing.
- `ToastCard.tsx`: `Surface tone="floating" shape="small"`; critical → `bg-error-container
text-on-error-container` + alert glyph, `role="alert"`; neutral → inverse-surface snackbar,
  `role="status"`; action renders a link button.
- `Toaster.tsx`: wraps sonner's Toaster, bottom-right, `visibleToasts` 3, safe-area offset,
  `unstyled`; must stay clickable while a Radix modal is open (verify `pointer-events`).
- `EmptyState`: add `critical` tone (`atoms/EmptyState.tsx:53,110-114`).
- `InlineBanner`: add `density: 'comfortable' | 'compact'` (`feedback/InlineBanner.tsx:28-43`).
- `FieldError` extracted from `primitives/field.tsx:451-456`; `Field` uses it internally.
- Tests in `packages/ui/tests/` for toaster, card, banner density, critical tone, FieldError.

### 2.3 App plumbing (`feat(web)`)

- `apps/web/src/components/feedback/{failure-toast.ts,load-failure.tsx,index.ts}`:
  `presentFailure(error, fallbackTitle, { retry? })` maps `failurePresentation` → toast (retry action
  when `canRetry`, else `failureAction` href, `dedupeKey` = code); `LoadFailure({ title, error, onRetry?,
retrying?, size?, frame? })` is `work-view-load-failure.tsx:50-90` promoted (the `hasCachedRows` guard
  moves to its two callsites).
- Mount `<Toaster />` in `apps/web/src/components/providers.tsx` (root, so auth/onboarding can toast).
- `apps/web/src/lib/query.ts:257-310` `useApiMutation`: options `failure?: 'toast' | 'silent'` (default
  toast) and `failureTitle?`; after the caller's `onError` (rollback first) call `presentFailure` with a
  retry that re-issues `mutate(variables)`. Tests in `apps/web/tests/lib/query.test.tsx`: toasts once,
  silent opt-out, queued offline write does not fail-toast, rollback precedes toast; unit test that
  `presentFailure(new Error('provider secret'))` never renders the exception text.
- Test helper `apps/web/tests/helpers/render-with-toaster.tsx` so tests keep asserting
  `findByRole('alert')`.

### 2.4 Migration, one commit per group (`fix(web)`)

- **Load failures → `LoadFailure`**: replace `WorkViewLoadFailure` and delete it; delete
  `settings/load-failure.tsx` and migrate its 9 importers; sites listed in the exploration (e.g.
  `tasks/all-tasks-client.tsx:161`, `inbox-client.tsx:97`, `cycles-client.tsx:267`,
  `project-detail-client.tsx:548,557`, `library-client.tsx:339,396`, `rail/day-tasks-panel.tsx:170` as
  `size="panel"`).
- **Banners → `InlineBanner`**: the four copy-pasted page banners (`all-tasks-client:143`,
  `inbox-client:86`, `portfolio-client:144`, `search-client:461`), the overlay variant in
  `command-palette:334` and the four picker overlays (delete local `ErrorBanner`s), and
  `(auth)/_components/auth-feedback.tsx:36` wrapping `InlineBanner` compact.
- **Mutation errors → toast**, three slices: (a) detail pages under `orgs/[orgId]/**` (all ledgered in
  `complexity-debt.json`; change is purely subtractive: delete the `useState`, the `<p>`, the catch);
  (b) `components/settings/*` (~30 sites; delete `write-error.tsx` and `firstWriteError`);
  (c) dialogs/composers/panels (`composer-shell.tsx:459-463` drops the `error` slot, composers keep the
  dialog open with `creating=false` on failure; close-cycle, milestones, dependencies, associations,
  suggestions-lane, today-prompt, canvas-properties-editor, task-details, activity feed, calendar drawer,
  onboarding, workspaces/new, oauth authorize via `presentFailure`). Prefer `mutate()`; where `await` is
  needed keep `catch { return; }`.
- **Field errors → `Field error=` / `FieldError`**: the Group-1 list (places, work-schedule,
  work-location dialogs, autocomplete, label editor, recurrence dialogs, calendar drawer forms,
  workspace-general, automations, image picker, the field half of mcp-connectors). Any site that is a
  save failure moves to the toast pattern instead.

### 2.5 Enforcement and closure (`feat(design)`)

- ESLint rule `tooling/eslint-config/rules/no-raw-error-text.js` (helpers from
  `rules/jsx-class-utils.js`): report any `(text|bg|border|ring|outline|fill|stroke)-error…` class
  token and any intrinsic element with `role="alert"`; config `errorPresentationConfig` in
  `tooling/eslint-config/index.js` ignoring `packages/ui/src/primitives/**`,
  `packages/ui/src/components/feedback/**`, `EmptyState.tsx`, `apps/web/src/components/feedback/**`;
  register in `plugin.js`, spread from root `eslint.config.js`; test with ESLint's `Linter` as in
  `apps/web/tests/components/entity-table-ownership.test.ts`. Migrate the one `apps/admin` site.
- `pnpm complexity:check` may only shrink; regenerate lowered entries.
- Docs: `error-presentation.md`; `design-system.md` §2.4 (:424) and §3.2 (:450) rewritten to what
  exists; `data-layer.md` §2.7 gains a display bullet; WORKLOG.
- e2e `apps/web/e2e/work/mutation-failure-toast.spec.ts`: route a PATCH to `500 problem+json`, edit a
  title, assert the alert toast with catalog copy, un-route, click Try again, assert success.

---

## Part 3 — Dependencies canvas

### 3.0 A finding that changes the "shared layout" mechanism

The user asked for "shared element transitions with shared layouts". A nested Next `layout.tsx` cannot
be that shared layout here: authenticated navigation is local-first. `AppLocationProvider.navigate`
commits `history.pushState` via `navigateHistory` (`apps/web/src/lib/app-location.tsx:176-190`) without
Next's router, `RouteSlot` renders `OfflineRouteOutlet` whenever `serverPath !== pathname`
(`apps/web/src/components/pwa/route-slot.tsx:63-68`), and the outlet mounts the page component from the
generated route table with `key={pathname}` (`offline-route-outlet.tsx:118`). Only `(app)/layout.tsx`
sits above it. So the shared layout is a shared **client frame** both route pages render, and the
shared-element morph is wired into the app's own navigation seam (a plain React commit we own, wrapped
in `startViewTransition`). The visible result is what was asked for: the roster title morphs into the
floating canvas bar. No Next experimental flag is needed.

### 3.1 z-index token scale (`feat(design)`)

- Add CSS custom properties in `packages/ui/src/styles/globals.css` beside `--dur-*` (:237-239), consumed
  as Tailwind v4 `z-(--z-…)`:

  | Token               | Value | Layer                                                       |
  | ------------------- | ----- | ----------------------------------------------------------- |
  | `--z-canvas-chrome` | 20    | floating bars/columns, xyflow `Panel` chrome, expand button |
  | `--z-canvas-cover`  | 30    | inspector pane covering a narrow canvas                     |
  | `--z-sheet`         | 100   | sheet scrim + panel                                         |
  | `--z-shell-overlay` | 109   | AppShell overlay host                                       |
  | `--z-dialog`        | 110   | dialog scrim + panel                                        |
  | `--z-popover`       | 120   | popover / tooltip / hover card / menu / editor bubble       |
  | `--z-toast`         | 130   | fixed notices, the new Toaster                              |

- Migrate every literal: `sheet.tsx:84,169`, `AppShell.tsx:667`, `dialog.tsx:111,271`,
  `popover.tsx:142`, `tooltip.tsx:81`, `hover-card.tsx:104`, `menu-styles.ts:170`,
  `calendar-create-failure-notice.tsx:11`, `editor/table-controls.tsx:179`,
  `canvas-overlay-panel.tsx:16` (keep the `!`), `canvas-floating-bar.tsx:129`,
  `canvas-floating-column.tsx:121`, `canvas.tsx:543`, `graph-inspector-host.tsx:367`,
  `plans/[planId]/plan-client.tsx:82`; fix the comments that cite numbers. 20 is enough because
  `.react-flow__viewport` has a transform and so contains xyflow's node z-indexes; verify with a selected
  node screenshot.
- `AppShell.tsx:649`: add `isolate` to `<main>` so no in-page layer can escape above portaled overlays.
- Policy: add a `raw-z-index` rule (`z-\[`) to
  `packages/test-utils/tests/design-policies/design-token-scan.ts` and seed `design-token-debt.json`
  with the scheduling/timeline intra-surface ordinals so they can only shrink.
- Docs: a "Layering" subsection in `docs/design/design-system.md`. Tests: primitives render
  `z-(--z-…)`; `<main>` has `isolate`.

### 3.2 Canvas fills its container (`feat(web)`)

- `canvas-viewport-insets.ts:12-17`: `CanvasOverlayInsets.bottom?`, `insetBottom()`, fold into
  `fitPaddingFor` (:69-76) and `availableCanvasHeight` (:88-94); `graph-first-frame-viewport.ts` already
  consumes bottom padding.
- `canvas.tsx`: viewport div (:445-450) becomes `absolute inset-0`; delete the `BOTTOM_CHROME_*`
  constants (:77-80) and the chained ternary (:225-229); keep the `ResizeObserver` (:249-261) but feed
  the measured bottom-chrome height into `effectiveInsets.bottom` (+ `CANVAS_OVERLAY_GUTTER`) for fit
  padding and the first frame. `CanvasBottomChrome` stays an absolute overlay. Net complexity drop; lower
  the ledger entry.
- Tests: `canvas-viewport-insets.test.ts`, `canvas-layout-lifecycle.test.tsx` (no inline `bottom`;
  first frame respects the bottom inset).

### 3.3 Reflow in place (`feat(web)`)

Three layers:

1. **Optimistic edge.** New pure `canvas/project-overview-optimistic.ts`
   (`applyProjectDependencyChange(items, change)`, `invertProjectDependencyChange`) patching
   `blockedByIds`/`blocksIds`. `executeDependency` (`project-graph-panel.tsx:159-184`) snapshots the
   overview query, `setQueryData` with the patch, then `history.execute`; restore on failure. Undo/redo:
   `CanvasSelectionRetentionProvider`'s applier (`canvas-selection-retention.tsx:127-135`) gets an
   optional `onReceipt` that ProjectGraphPanel supplies to patch by direction. Invalidation still confirms.
2. **Incremental layout.** New `canvas/graph-layout-incremental.ts`
   (`layoutMeasuredGraphIncrementally(nodes, edges, options, previous)`), exporting `weakComponents`,
   `layoutComponent`, `COMPONENT_GAP`, `primaryComponentOf` from `graph-layout-engine.ts` (exports only,
   so its ledger entry is untouched). `GraphLayoutResult` gains `packing { perRow, order }` and
   components gain `anchorId`, `edgeSignature`, `localPositions`. Algorithm: classify components as
   unchanged (same member key + edge signature → reuse local positions) or changed (re-run dagre for
   that component only); order by the previous anchor index (merged components inherit the earliest,
   split-off pieces follow their parent, new ones last); pack with a fixed `perRow` (no re-scoring), so
   only right/below neighbours move by the size delta. Full repack only when there is no previous
   result, on the Re-layout epoch bump, or on a coarse aspect-bucket change.
   `useProjectGraphLayout` (`project-graph-layout.ts:66-80`) holds `previousRef` and picks the path.
   Tests: adding a cross-component edge leaves every other component deep-equal; non-splitting removal
   keeps the origin; a split keeps the anchor piece; `perRow` preserved; epoch bump repacks.
3. **Animate positions, don't snapshot the page.** New `canvas/use-animated-node-positions.ts`
   (rAF interpolation, 240 ms `--dur-slow`, MD3 emphasized-decelerate as a JS bezier, reduced motion
   jumps, retarget mid-flight, exclude dragging nodes). `use-controlled-flow.ts:66-82`: same node-id
   set → animator; structural change → `startViewTransition(update, { scope: 'named' })`.
   `apps/web/src/lib/view-transition.ts` gains `{ scope: 'root' | 'named' }` (sets
   `data-view-transition-scope` on `<html>` and short-circuits under reduced motion, mirroring
   `packages/ui/src/components/shell/navigation-transition.ts:19-25`); `globals.css` gets
   `:root[data-view-transition-scope='named'] { view-transition-name: none }`, a group timing rule, and
   a reduced-motion rule for `::view-transition-*` (today's `*` rule at :815-825 misses them).
   Tests with fake rAF and for the scope flag.

### 3.4 Dependencies as its own route under the floating canvas bar (`feat(web)`)

Route tree (no nested `layout.tsx`, see 3.0):

```
apps/web/src/app/(app)/orgs/[orgId]/projects/
  page.tsx, projects-client.tsx            (existing roster)
  dependencies/page.tsx                    NEW → ProjectDependenciesClient
  dependencies/dependencies-client.tsx     NEW ('use client', useTypedRoute, <ProjectGraphRoute orgId/>)
apps/web/src/components/work-views/project-lens-frame.tsx   NEW shared frame: transition names + title copy
apps/web/src/components/canvas/project-graph-route.tsx      NEW page body (useOwnPageScroll, requestCompact <1920,
                                                            overview query, loading/failure/empty, Surface tone="page")
apps/web/src/components/canvas/canvas-floating-chrome.ts    NEW generic hook extracted from task-graph-chrome.tsx:47-63
```

Then regenerate the route table (`pnpm --filter @docket/web exec tsx scripts/generate-offline-routes.ts`;
`tests/lib/offline-routes.test.ts` pins it) and add the surface to `docs/design/surface-inventory.md`.
Static segments win in `route-match.ts:73-77`, so `/projects/dependencies` beats `[projectId]`.

- **Bar** (`CanvasFloatingBar`): title = vocabulary title from `PAGE_COPY.project`; navigation = back
  link to the roster (`BackNavigation` pattern from `plan-client.tsx:51-70`); controls = segmented
  `Tabs` lens switch (List | Dependencies) whose List item is a `DocketLink`; trailing = "N projects ·
  M dependencies"; selection = `BulkSelectionActions` replacing `<BulkActionsBar/>`
  (`project-graph-panel.tsx:404`); actions = tonal "New project" (`variant="secondary"`, floating-surface
  button rule) calling the panel's `createProject`. `ProjectGraphPanel` gains `chrome?` and
  `lensSwitch?` props; extract `useProjectGraphCommands` (:155-196) and `useProjectPeekModel` (:228-257)
  into `project-graph-panel-support.ts` first so its ledger entry drops.
- **Inspector**: `GraphInspectorHost presentation="floating"` with `onOcclusionChange` → right inset.
- **Roster side**: remove `dependencyMode` and every branch on it from `work-view-page.tsx`
  (:365-367, 398, 417, 445, 465, 531-545, 572-584, 720-723, 737, 750, 768-778, 788, 803, 826, 883-905),
  the `CreatedProjectSelection` plumbing (:470-500) and `projectDependencyCreateHandler` (:343-352);
  `use-work-view-surface-recovery.ts` loses the overview query. `WorkViewTabs` (`work-view-tabs.tsx`)
  takes `dependenciesHref` and renders the entry as `Button asChild` around
  `<DocketLink transition="shared-element">` (policy test
  `tests/lib/authenticated-navigation-policy.test.ts:134` requires `DocketLink`). Delete
  `project-dependency-lens.tsx` and its failure test (coverage moves to `project-graph-route.test.tsx`).
  Update pinned tests: `projects-experience-contract.test.ts:15,46`,
  `work-view-creation-continuity.test.tsx:91,392-404`, toolbar/page tests. Confirm the sidebar's
  Projects item stays active on the sub-route (`app-shell-frame.tsx` ~:345).

### 3.5 Shared-element transition (`feat(web)`)

1. **Warm module cache**: `authenticated-route.ts:120` gains `loadedRouteComponents` filled by
   `prefetchAuthenticatedRoute` (:249-266) and the outlet's own load; `OfflineRouteOutlet` derives
   `ready` synchronously from it so a warmed route swaps in one commit (test: "renders a warmed route in
   the same commit"; keep the never-previous-component invariant at `offline-route-outlet.test.tsx:51-62`).
2. **Navigation option** `transition?: 'shared-element'` on `ResponsiveNavigationOptions`
   (`navigation.tsx:47`), `AuthenticatedNavigationOptions` (`app-location.tsx:189-194`) and `DocketLink`;
   `navigateHistory` wraps `pushState + syncLocation()` in `startViewTransition(…, { scope: 'named' })`
   when set (flushSync inside forces the subscribers to commit in the browser's callback).
3. **Data warm**: `docket-link.tsx:191-201` prefetch switch gains the dependencies route →
   `projectOverviewDef(orgId)`; both pages prefetch the other route's module on mount.
4. **Names**: `project-lens-frame.tsx` exports `PROJECT_LENS_TRANSITION = { title, create, lens }`;
   roster title span, New Project button and tab row carry them; `AppBar` gains `titleTransitionName?`
   applied to its `<h1>` (`AppBar.tsx:125,141`), forwarded by `CanvasFloatingBar`.
5. **CSS** under the named scope: group duration `--dur-slow`, easing emphasized-decelerate.
6. **Fallbacks**: no `startViewTransition`, reduced motion, cold chunk, popstate → instant swap.
   Tests: `app-location.test.tsx` (mocked `startViewTransition` called once with the option),
   DocketLink prop, `canvas-floating-bar.test.tsx` title name.

---

## Part 4 — Task detail redesign

### 4.1 Target anatomy (`/orgs/[orgId]/tasks/[taskId]`)

Wide (≥ `@4xl`), top to bottom:

1. **Eyebrow**: breadcrumb of `DocketLink`s: project name (or "No project") › parent task title when
   `parentTaskId` is set. No task key exists in the contract, so no mono identifier.
2. **Masthead** via `EntityDetailLayout`: `EntityIconPicker size={48}`, `EditableTitle` without its own
   size class (the layout owns `text-headline-medium font-medium`), `object` for the right-click surface,
   `actions` = `ControlGroup` with `TaskTimerButton` (the one primary action, per the 2026-09-07 audit) and
   a slimmed overflow menu (Delete, Copy link, Expand description with Athena). No subtitle.
3. **Metadata row** (`EntityMetadataRow ariaLabel="Task properties"`) with `EntityMetadataItem`
   priorities: 0 Status, 0 Priority, 1 Assignee, 2 Project, 3 Due, 4 Estimate (when scale ≠ none),
   5 Labels, 6 Cycle, 7+ Milestone/Program/Start/Delegate/Created/Imported-from as `overflowOnly`. All
   pickers use `triggerVariant="ghost"` + `ENTITY_METADATA_CHIP_CLASS`; add trigger props to
   `StatusPicker`/`PriorityPicker` (`EstimatePicker` already has them).
4. **Tabs** (`Tabs variant="underline"` + `useDetailTab(['overview','resources','graph'])` as in
   `project-detail-client.tsx:751-763`).
5. **Overview** in issue order: description editor directly under the masthead (`TaskDetails` →
   `TemplateAwareEntityDocument`, section heading and Expand button removed; Expand lives in the overflow
   menu, its undo strip stays inline), repeating-work backlink, `Subtasks`, `Dependencies`, then
   `TaskActivityFeed` with the comment composer last.
6. **Resources tab**: `ResourcesTab`, query enabled only on that tab.
7. **Graph tab**: `TaskGraphPanel scope={{ orgId, rootTaskId, depth: 2 }} density="full"` mounted only
   when active; replaces the "Load attachments and dependency map" button.
8. **Aside (wide only)**: secondary properties as rows docked beside the body; the metadata row then
   carries priorities 0–3 only, so no property mounts twice.

Narrow: same document; chips demote into the metadata overflow by priority; no aside; tabs overflow
into the named menu. Print: `DetailPrintSummary` with status, priority, assignee, project, due, estimate.

### 4.2 Reuse / rewrite / delete

- **Reuse**: `EntityDetailLayout`, `EntityMetadataRow/Item`, `EntityDetailSkeleton`, `useDetailTab`,
  `DetailPrintSummary`, `EntityIconPicker`, `EditableTitle`, `Subtasks`, `Dependencies`,
  `TaskActivityFeed`, `ResourcesTab`, `TaskTimerButton`, `TaskGraphPanel`, `ConfirmDestructiveDialog`,
  the task hooks.
- **Rewrite**: `task-detail-client.tsx` becomes composition only (< 400 lines so its ledger entry is
  deleted): extract `task-detail/task-masthead-properties.tsx`, `task-overview-panel.tsx`,
  `task-detail-states.tsx` (loading/terminal/error via `EntityDetailSkeleton` and `EmptyState`, replacing
  the bare `<p>`s at :286-319). `TaskDetails` loses its `details` slot and heading. `TaskPropertiesRail`
  becomes `TaskSecondaryProperties` with `presentation: 'rows' | 'chips'`, refactored to lower its
  ledger entry.
- **Delete**: `task-header-controls.tsx` (`TaskHeaderControls` and its test; its container-query
  collapse is superseded by the metadata row's priority collapse), the `linkedContentOpen` state and
  the Load button (:71, 128, 437, 511-536).

### 4.3 Phasing

- **B1** `feat(web)`: put the task page on `EntityDetailLayout` (masthead, metadata row, actions, tabs,
  skeleton/states, picker trigger props). `detail-route-policy.test.ts` stays green.
- **B2** `feat(web)`: order the page like an issue (overview reorder, graph tab, overflow slimming,
  `TaskDetails` simplification, delete `TaskHeaderControls`).
- **B3** `feat(web)`: add an opt-in `aside?: ReactNode` slot and `useEntityDetailAside(): { docked }`
  (ResizeObserver on the scroll container, threshold 896 px) to `entity-detail-layout.tsx`, rendered as a
  sticky second column in `.detail-body` only when docked. Enabling refactor: extract the header JSX
  (:115-211) into a `DetailHeader` component so the layout's ledger entry is deleted rather than raised.
  Projects can adopt the slot later.

### 4.4 Behaviours preserved

Inline title edit; double-click rename of subtasks/dependencies; `TaskTimerButton` unconditional;
`useTaskPageIdentity`; terminal handling (`removeNavigationSnapshot` + `removeQueries`);
`aggregateEnabled` gating; label create-and-attach; milestone options scoped to the task's project.
New: right-click object menu via `object`.

### 4.5 Tests

New `tests/task-detail/task-masthead-properties.test.tsx`, `task-overview-panel.test.tsx` (order; graph
mounts only on its tab); update `task-details.test.tsx`, `task-properties-rail.test.tsx` (both
presentations), `tests/components/entity-detail-layout.test.tsx` (aside docked/undocked). E2E
`apps/web/e2e/work/task-detail-shots.spec.ts` (1440×900 + 390×844, both themes, seeded task with
subtasks, a blocker, labels, estimate), extend `detail-loading-masthead.spec.ts` to a task, keep
`task-hierarchy.spec.ts` green, 320 px `expectNoDocumentOverflow`.

---

## Sequencing and commits

Ship order: Part 1 → Part 2 → Part 3 → Part 4. One commit per numbered phase, Conventional Commits
with scopes from `COMMIT_SCOPES.txt`: composer drafts and the Drafts page → `web` (API slice → `api`,
preference → `hub`); error primitives → `design`, migrations → the record scope the surface belongs to
(`tasks`, `projects`, `initiatives`, …) or `web` when cross-cutting; z-index tokens → `design`; the
dependencies route and canvas reflow → `projects`; task detail → `tasks`. Subjects state the outcome,
never the mechanism. Substantive bodies, `Co-authored-by:` trailer, `Docs-impact:` trailer.

First implementation step: write this design as `docs/superpowers/specs/2026-09-18-drafting-errors-canvas-task-detail-design.md`
(the brainstorming spec the workflow expects) and the four WORKLOG Active Task entries, in one
`docs`-scoped commit, before any code. Rebase onto `origin/main` and push once per part after the local gates pass.
Order of dependencies: Part 2's `--z-toast` token is defined in Part 3.1; land the Toaster on a
`z-[130]` literal in Part 2 and migrate it in 3.1, or pull 3.1 forward to run before Part 2 (preferred:
run 3.1 first, it is small and unblocks both).

WORKLOG: one Active Task entry per part created before its work starts, moved to Completed with Files
changed / Validation / Learnings.

## Verification (end to end)

- Every part: `pnpm typecheck`, `pnpm lint` (complexity ledger only shrinks; new ESLint rule green),
  `pnpm format:check`, `pnpm test` (coverage gates; policy tests), `pnpm build`.
- Part 1: `me-drafts.test.ts`, `hub-preferences.test.ts`, composer RTL suites, `composer-drafts.spec.ts`
  e2e; manual walk on the dev stack (`scripts/dev-stack.sh start` → `dev-session.ts` →
  `capture-shots.ts`) capturing the prompt, chip popover and Drafts page at both widths; `pnpm db:reset`.
- Part 2: `grep -rn "text-error" apps/web/src apps/admin/src` and `grep -rn 'role="alert"' apps/web/src`
  return only `components/feedback/`; `mutation-failure-toast.spec.ts`; a toast is clickable with the
  composer dialog open; `/design-review` on Today + a composer failure, both themes.
- Part 3: `project-dependencies-route.spec.ts` (URL, viewport height equals container, minimap/toolbar
  overlap the viewport rect, `elementFromPoint` at the minimap centre is inside the dialog/scrim while a
  confirmation is open, drag-connect leaves an untouched component's transform unchanged while the edge
  appears before the delayed POST resolves, back link restores the roster); shots spec at 1440/1016/390
  both themes with the 36-project fixture; `/design-review` scorecards for `/projects/dependencies` and
  a re-score of `/projects`; manual check of the 240 ms title morph and reduced-motion instant swap.
- Part 4: task-detail shots, `/design-review /orgs/:orgId/tasks/:taskId` →
  `docs/design/audits/2026-09-XX-task-detail-redesign.md`, every dimension ≥ 3.
- Before each push: `git rev-list --merges --count origin/main..HEAD` prints 0.
