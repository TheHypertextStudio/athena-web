# Project Composer Section Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Create Project composer full-height Description and Milestones sections so supplemental drafts can never shrink the visible description editor below two-thirds of the body.

**Architecture:** `ComposerShell` will own a typed supplemental-section contract and render the shared segmented `Tabs` control after the title and summary. Both the built-in description panel and caller-supplied panels stay mounted while CSS hides the inactive panel, which preserves the rich-text editor instance and each panel's scroll position. The Project composer will supply its current milestone field as one supplemental section without changing the create request.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, `@docket/ui` Tabs and ControlGroup primitives, TipTap, Vitest with Testing Library, Playwright.

---

### Task 1: Add the shared section contract to `ComposerShell`

**Files:**

- Modify: `apps/web/src/components/composer/composer-shell.tsx`
- Test: `apps/web/tests/editor/composer-editor-parity.test.tsx`

- [x] **Step 1: Write failing shared-shell behavior tests**

Add a stateful harness with one supplemental section and assert the detail-page-aligned DOM order,
segmented tab semantics, count, default Description selection, mounted-but-hidden panels, draft
retention, editor node identity, unique tab/panel ids, and the absence of tab chrome when no sections
are supplied.

```tsx
const descriptionTab = screen.getByRole('tab', { name: 'Description' });
const milestonesTab = screen.getByRole('tab', { name: 'Milestones 1' });
expect(descriptionTab).toHaveAttribute('aria-selected', 'true');
expect(screen.getByRole('tabpanel', { name: 'Description' })).toBeVisible();
expect(screen.getByRole('tabpanel', { name: 'Milestones 1', hidden: true })).not.toBeVisible();

const editor = screen.getByRole('textbox', { name: 'Add a description' });
await user.click(milestonesTab);
await user.type(screen.getByRole('textbox', { name: 'Milestone name' }), 'Launch');
await user.click(descriptionTab);
expect(screen.getByRole('textbox', { name: 'Add a description' })).toBe(editor);
```

Assert the hierarchy through `compareDocumentPosition`: title precedes the tablist, the tablist precedes the active panel, the active panel precedes the metadata group, and metadata precedes the submit action.

- [x] **Step 2: Run the focused test and confirm the missing contract fails**

Run:

```bash
pnpm --filter @docket/web test -- tests/editor/composer-editor-parity.test.tsx --maxWorkers=2
```

Expected: FAIL because `ComposerShell` has no `supplementalSections` prop and renders no composer-section tabs.

- [x] **Step 3: Implement the typed contract and mounted panels**

Export the caller contract beside `ComposerShellProps`:

```tsx
export interface ComposerSupplementalSection {
  readonly id: string;
  readonly label: string;
  readonly count?: number | undefined;
  readonly body: ReactNode;
}
```

Replace `trailingFields` with:

```tsx
supplementalSections?: readonly ComposerSupplementalSection[] | undefined;
```

Keep `activeSectionId` inside `ComposerShell`, reset it to `description` in `onOpenAutoFocus`, and derive tab items from the built-in Description section plus the supplied sections. Render the segmented `Tabs` control inside a compact `ControlGroup` after the title/summary block only when at least one supplemental section exists.

Namespace each tab value with `formId` before passing it to `Tabs`. Use the same namespaced value in
the matching panel id so an open composer cannot duplicate a detail page's `tab-description` or
`tabpanel-description` ids.

Render every panel in `ComposerBodyRegion` so React never unmounts the TipTap editor:

```tsx
<section
  role="tabpanel"
  id={`tabpanel-${section.id}`}
  aria-labelledby={`tab-${section.id}`}
  hidden={activeSectionId !== section.id}
  className="min-h-0 flex-1"
>
  {section.body}
</section>
```

Give the Description panel the existing mention provider, editor, contents rail, and freeform-field
behavior. Render `DialogBody` with visible overflow plus an explicit clipped frame, then give each
panel its own `min-h-0 overflow-y-auto overscroll-contain` scroll owner. Keep the shell's disabled
fieldset around every supplemental body. Do not put supplemental content inside the description flex
column.

When a tab is selected, schedule focus for the first enabled `input`, `textarea`, `button`, or `[contenteditable="true"]` in its panel. Skip the focus transfer while the dialog is opening so Radix can retain title autofocus.

- [x] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
pnpm --filter @docket/web test -- tests/editor/composer-editor-parity.test.tsx --maxWorkers=2
```

Expected: PASS with existing editor parity tests and the new section cases green.

- [x] **Step 5: Commit the shared contract**

Stage only the shell and focused test. Commit with a message file using `fix(editor): Keep supplemental drafts out of the writing surface`, a substantive body, `Docs-impact: Updated`, and `Co-authored-by: Codex <codex@openai.com>`.

### Task 2: Move Project milestones into the supplemental section

**Files:**

- Modify: `apps/web/src/components/projects/create-project.tsx`
- Modify: `apps/web/src/components/projects/project-milestones-field.tsx`
- Test: `apps/web/tests/composers/create-project.test.tsx`
- Test: `apps/web/tests/components/projects/project-milestones-field.test.tsx`

- [x] **Step 1: Write failing Project integration tests**

Update the milestone helper to select the `Milestones` tab before adding a row. Add cases that assert
the chip count changes from `Milestones 0` to `Milestones 2`, milestone values survive a round trip
through Description, Description remains the default when the dialog reopens, and submitting from
either active section sends the same atomic `milestones` array.

```tsx
fireEvent.click(screen.getByRole('tab', { name: 'Milestones 0' }));
addMilestone('Beta');
addMilestone('Launch');
expect(screen.getByRole('tab', { name: 'Milestones 2' })).toHaveAttribute('aria-selected', 'true');
fireEvent.click(screen.getByRole('tab', { name: 'Description' }));
fireEvent.click(screen.getByRole('tab', { name: 'Milestones 2' }));
expect(screen.getAllByLabelText('Milestone name')).toHaveLength(2);
```

Add a focused field test that the milestone section's root fills its panel and owns no extra resting container or horizontal rule.

- [x] **Step 2: Run the Project tests and confirm the old stacked layout fails**

Run:

```bash
pnpm --filter @docket/web test -- tests/composers/create-project.test.tsx tests/components/projects/project-milestones-field.test.tsx --maxWorkers=2
```

Expected: FAIL because milestones are still always visible through `trailingFields` and no count-bearing tab exists.

- [x] **Step 3: Wire the existing draft field into `supplementalSections`**

Replace the Project composer's `trailingFields` prop with:

```tsx
supplementalSections={[
  {
    id: 'milestones',
    label: 'Milestones',
    count: draft.milestones.length,
    body: (
      <ProjectMilestonesField
        value={draft.milestones}
        onChange={(milestones) => setField('milestones', milestones)}
      />
    ),
  },
]}
```

Make `ProjectMilestonesField` fill the panel as a single scrolling work area. Keep the existing heading only if it adds information that the selected tab does not already provide; otherwise remove the duplicate `Milestones` heading. Preserve the current quick-add row, row order, date picker, note, remove action, limit error, and disabled-fieldset behavior supplied by the shell.

- [x] **Step 4: Run the Project tests and confirm behavior passes**

Run:

```bash
pnpm --filter @docket/web test -- tests/composers/create-project.test.tsx tests/components/projects/project-milestones-field.test.tsx --maxWorkers=2
```

Expected: PASS. Existing atomic-create, failure retention, blank-row filtering, date, note, order, and limit behavior must remain green.

- [x] **Step 5: Commit the Project integration**

Stage only the Project composer, milestone field, and their tests. Commit with a message file using `fix(projects): Give milestone drafts their own composer section`, a substantive body, `Docs-impact: Updated`, and the Codex co-author trailer.

### Task 3: Prove responsive geometry and finish the task record

**Files:**

- Modify: `apps/web/e2e/athena/create-composers-design.spec.ts`
- Modify: `docs/design/audits/2026-09-08-create-composers.md`
- Modify: `docs/WORKLOG.md`

- [x] **Step 1: Add browser assertions for the Project section switcher**

Extend the existing authenticated composer matrix instead of creating another harness. For Project at 1440×900, 390×844, and 320×844, assert `Description` is initially selected, the tablist follows the summary and precedes the panel, the footer remains pinned, and no page overflow appears.

Measure the active description surface against the shared body rectangle:

```ts
const body = dialog.locator('[data-composer-body]');
const editor = dialog.locator('[data-editor-surface]');
const [bodyBox, editorBox] = await Promise.all([body.boundingBox(), editor.boundingBox()]);
expect(bodyBox).not.toBeNull();
expect(editorBox).not.toBeNull();
expect(editorBox!.height / bodyBox!.height).toBeGreaterThanOrEqual(2 / 3);
```

Switch to Milestones, add one draft, assert `Milestones 1`, switch back, and assert the editor node and typed description remain. Capture light and dark screenshots for both sections at desktop and phone widths.

- [x] **Step 2: Run the browser test against the documented dev stack**

Run `~/.claude/resource-limits/agentctl status` before the stack if that command exists. Then follow `docs/engineering/ui-verification.md` exactly:

```bash
bash scripts/dev-stack.sh start
eval "$(bash scripts/dev-stack.sh env)"
cd apps/web
APP_URL="$APP_URL" PASSKEY_RP_ID="$PASSKEY_RP_ID" \
  pnpm exec tsx e2e/tools/dev-session.ts --label=project-composer-sections \
  --out=playwright/.auth/project-composer-sections.json
APP_URL="$APP_URL" pnpm exec playwright test \
  e2e/athena/create-composers-design.spec.ts --workers=1
```

Expected: PASS with screenshots showing the full-height Description section and separate Milestones section in both themes. Run `pnpm db:reset` after the authenticated session because the dev and API test databases are shared.

- [x] **Step 3: Run bounded repository validation**

Run through Turbo with bounded concurrency:

```bash
pnpm turbo run typecheck lint test build --filter=@docket/web --filter=@docket/ui --concurrency=2
pnpm format:check
git diff --check
```

Expected: every task passes. If a command exits 137, reduce the affected test worker count or package filter before retrying.

- [x] **Step 4: Update the audit and complete the work log**

Update the create-composer audit to replace the old claim that all supplemental content shares the editor column. Record the segmented header tabs, full-height panels, measured two-thirds floor, desktop/mobile light/dark screenshot evidence, and validation commands.

Move `[PROJECT-COMPOSER-SECTIONS-001]` to the completed area of `docs/WORKLOG.md`. Include the behavior change, files changed, exact validation results, browser evidence, and the reason mounted hidden panels were chosen over remounting TipTap.

- [x] **Step 5: Commit the verified delivery**

Stage the E2E spec, audit, and work log. Commit with a message file using `fix(projects): Keep the project brief at full working height`, a substantive body that records the layout invariant and rejected stacked layout, `Docs-impact: Updated`, and the Codex co-author trailer.

- [x] **Step 6: Run the completion audit**

Re-read `docs/superpowers/specs/2026-09-19-project-composer-section-switcher-design.md` line by line. Match every requirement to current source, passing tests, or screenshot evidence. Confirm `git status --short` is clean and `git rev-list --merges --count HEAD~3..HEAD` prints `0` before marking the goal complete.
