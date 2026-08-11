# Agenda Quick-Create Dialog Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a draggable, non-overlapping Agenda quick-create dialog with progressive date/time disclosure, searchable start/end timezone selection, highlight-only validation, and visible whole-step zoom.

**Architecture:** Persist an optional end timezone through the existing layered-calendar contract, keep timezone search and wall-time resolution in pure modules, and mount the Agenda dialog into a shell-owned overlay host whose rectangle is exactly the primary content column. The dialog controller composes those seams while the Agenda continues owning only selection and draft projection.

**Tech Stack:** TypeScript, React 19, Next.js App Router, Radix Dialog through `@docket/ui`, Temporal polyfill, Drizzle/PostgreSQL, Hono/Zod, TanStack Query, Vitest/Testing Library, Playwright.

## Global Constraints

- Quick create remains a focus-managed dialog; it is not converted into a docked inspector.
- The desktop dialog may cover primary page content but must never intersect the Agenda rectangle.
- Only the top handle initiates pointer dragging; keyboard movement is available from the handle.
- The overview contains one schedule summary and no standalone timezone field.
- Expanded timed editing uses separate date and time controls.
- Timezone search matches abbreviation, common name, canonical IANA identifier, and city locally.
- `timezone` remains the start/single zone; nullable `endTimezone` means “use `timezone`.”
- Missing fields are highlighted and Save is disabled; no visible validation or failure prose appears inside the dialog.
- Agenda zoom visibly steps only through `1×`, `2×`, and `3×`.
- Preserve unrelated dirty work and use the repository's clean-index atomic commit chain.

---

## File Map

- `packages/types/src/calendar.ts` — public single/end timezone DTO and write-patch contract.
- `packages/db/src/schema/calendar.ts` + generated migration — nullable persisted end timezone.
- `apps/api/src/calendar/calendar-{sync-engine,serializers,write}.ts` — provider snapshot and native write persistence.
- `apps/api/src/routes/calendar-google-adapter.ts` — Google start/end timezone mapping.
- `apps/web/src/components/calendar/timezone-search.ts` — pure local timezone index and ranking.
- `apps/web/src/components/calendar/calendar-time-draft.ts` — separate wall date/time and independent-zone resolution.
- `apps/web/src/components/calendar/create-block-schedule-editor.tsx` — collapsed summary and expanded date/time controls.
- `apps/web/src/components/calendar/calendar-timezone-dialog.tsx` — focused timezone search and separate-zone choice.
- `packages/ui/src/components/shell/ShellOverlayContext.tsx` — shell-owned overlay container contract.
- `packages/ui/src/components/shell/AppShell.tsx` + `packages/ui/src/primitives/dialog.tsx` — host and portal/overlay customization.
- `apps/web/src/components/calendar/use-clamped-dialog-position.ts` — default placement and pointer/keyboard clamping.
- `apps/web/src/components/calendar/create-block-form.tsx` — orchestration, validation, save, and responsive composition.
- `apps/web/src/components/calendar/calendar-create-failure-notice.tsx` — app-level failure notification outside the dialog.
- `apps/web/src/components/agenda/agenda-scale-controls.tsx` + Agenda header/context — visible whole-step zoom.

---

### Task 1: Persist start and optional end timezones

**Files:**

- Modify: `packages/types/src/calendar.ts`
- Modify: `packages/db/src/schema/calendar.ts`
- Create: generated `packages/db/drizzle/0079_*.sql` and matching `packages/db/drizzle/meta/*`
- Modify: `apps/api/src/calendar/calendar-sync-engine.ts`
- Modify: `apps/api/src/calendar/calendar-serializers.ts`
- Modify: `apps/api/src/calendar/calendar-write.ts`
- Modify: `apps/api/src/routes/calendar-google-adapter.ts`
- Test: `packages/types/tests/dto/calendar.test.ts`
- Test: `apps/api/tests/calendar-serializers.test.ts`
- Test: `apps/api/tests/routes/calendar-write-back.test.ts`
- Test: `apps/api/tests/routes/calendar-google-adapter-edges.test.ts`

**Interfaces:**

- Produces: `CalendarItemOut.endTimezone: string | null`.
- Produces: `endTimezone?: string` in `CalendarItemCreate`, plus clearable
  `endTimezone?: string | null` in `CalendarItemUpdate` and `CalendarItemWritePatch`.
- Produces: persisted `calendarItem.endTimezone` mapped to Google `end.timeZone`.

- [ ] **Step 1: Write failing DTO, serializer, native-write, and Google-adapter tests**

```ts
expect(
  CalendarItemCreate.parse({
    intent: 'event',
    title: 'Flight',
    startsAt,
    endsAt,
    timezone: 'America/Los_Angeles',
    endTimezone: 'America/New_York',
  }).endTimezone,
).toBe('America/New_York');

expect(serialized.endTimezone).toBe('America/New_York');
expect(googlePatch.start).toMatchObject({ timeZone: 'America/Los_Angeles' });
expect(googlePatch.end).toMatchObject({ timeZone: 'America/New_York' });
```

- [ ] **Step 2: Run the focused contract tests and verify missing-field failures**

Run: `pnpm --filter @docket/types test -- tests/dto/calendar.test.ts && pnpm --filter @docket/api test -- tests/calendar-serializers.test.ts tests/routes/calendar-write-back.test.ts tests/routes/calendar-google-adapter-edges.test.ts`

Expected: FAIL because `endTimezone` is absent from the DTO, row, and provider patch.

- [ ] **Step 3: Add the nullable schema field and generate the migration**

```ts
timezone: text('timezone'),
endTimezone: text('end_timezone'),
```

Run: `pnpm db:generate`

Expected migration SQL: `ALTER TABLE "calendar_item" ADD COLUMN "end_timezone" text;`

- [ ] **Step 4: Thread the field through DTOs, serializers, snapshots, writes, and Google mapping**

```ts
endTimezone: z.string().nullable(), // output
endTimezone: z.string().optional(), // create
endTimezone: z.string().nullable().optional(), // update/write patch

const endTimeZone = patch.endTimezone ?? patch.timezone;
end: patch.endsAt ? { dateTime: patch.endsAt, ...(endTimeZone ? { timeZone: endTimeZone } : {}) } : undefined;
```

Google reads set `timezone` from `start.timeZone` and `endTimezone` only when `end.timeZone`
differs. All-day records keep both fields null. Native create/update stores both fields. When an
end-zone-only update is written to a provider, the write layer includes the existing start zone so
the adapter can emit a complete effective start/end timezone pair; `null` clears the override.

- [ ] **Step 5: Run the focused tests and typechecks**

Run: `pnpm --filter @docket/types test -- tests/dto/calendar.test.ts && pnpm --filter @docket/api test -- tests/calendar-serializers.test.ts tests/routes/calendar-write-back.test.ts tests/routes/calendar-google-adapter-edges.test.ts && pnpm --filter @docket/db typecheck && pnpm --filter @docket/api typecheck`

Expected: PASS.

---

### Task 2: Build deterministic local timezone search

**Files:**

- Create: `apps/web/src/components/calendar/timezone-search.ts`
- Test: `apps/web/tests/calendar/timezone-search.test.ts`

**Interfaces:**

- Produces: `TimezoneSearchEntry { id; city; commonName; abbreviations; offsetLabel; searchText }`.
- Produces: `buildTimezoneSearchIndex(referenceInstant, locale?, zoneIds?): TimezoneSearchEntry[]`.
- Produces: `searchTimezones(entries, query, limit?): TimezoneSearchEntry[]`.

- [ ] **Step 1: Write failing search and daylight-label tests**

```ts
const entries = buildTimezoneSearchIndex('2026-08-10T17:00:00Z', 'en-US', [
  'America/Los_Angeles',
  'America/Vancouver',
  'Pacific/Pitcairn',
]);
expect(searchTimezones(entries, 'PST').map((x) => x.id)).toContain('America/Los_Angeles');
expect(searchTimezones(entries, 'Pacific Time')[0]?.id).toBe('America/Los_Angeles');
expect(searchTimezones(entries, 'America/Los_Angeles')[0]?.id).toBe('America/Los_Angeles');
expect(searchTimezones(entries, 'Los Angeles')[0]?.id).toBe('America/Los_Angeles');
expect(entries.find((x) => x.id === 'America/Los_Angeles')?.offsetLabel).toBe('UTC−7');
```

- [ ] **Step 2: Run the focused test and verify the module is missing**

Run: `pnpm --filter @docket/web test -- tests/calendar/timezone-search.test.ts`

Expected: FAIL because `timezone-search.ts` does not exist.

- [ ] **Step 3: Implement index construction and ranked matching without a dependency**

Use `Intl.supportedValuesOf('timeZone')` with a tested fallback list. Derive the city from the
canonical id, `longGeneric` for common name, January/July short names for searchable standard and
daylight abbreviations, and the draft instant for the displayed abbreviation/offset. Ranking order
is exact IANA, exact city/name/code, prefix, then substring; ties use city then id.

- [ ] **Step 4: Run search tests and web typecheck**

Run: `pnpm --filter @docket/web test -- tests/calendar/timezone-search.test.ts && pnpm --filter @docket/web typecheck`

Expected: PASS.

---

### Task 3: Model separate wall dates, times, and zones in the local draft

**Files:**

- Modify: `apps/web/src/components/calendar/calendar-time-draft.ts`
- Modify: `apps/web/src/components/calendar/datetime-input.ts`
- Test: `apps/web/tests/calendar/calendar-time-draft.test.ts`
- Test: `apps/web/tests/calendar/datetime-input.test.ts`

**Interfaces:**

- Produces: `CalendarWallDraftField { date; time; edited; occurrence }`.
- Produces: `CalendarTimeDraft { seed; start; end; startTimezone; endTimezone; timezoneEdited }`.
- Produces: `updateCalendarDraftEnd(draft, { date; time }): CalendarTimeDraft` and the matching
  start-field helper for controlled inputs.
- Produces: `applyCalendarDraftTimezones(draft, startTimezone, endTimezone): CalendarTimeDraft`.
- Produces: `resolveCalendarTimeDraft(draft): ResolvedCalendarTimeDraft` including both zones.

- [ ] **Step 1: Write failing draft conversion, rebase, separate-zone, DST gap/fold, and range tests**

```ts
const draft = calendarTimeDraftFromSeed(seed, 'America/Los_Angeles');
expect(draft.start).toMatchObject({ date: '2026-08-10', time: '10:00' });
const withEndWall = updateCalendarDraftEnd(draft, { date: '2026-08-10', time: '14:00' });
const zoned = applyCalendarDraftTimezones(withEndWall, 'America/Los_Angeles', 'America/New_York');
expect(resolveCalendarTimeDraft(zoned)).toEqual({
  startsAt: '2026-08-10T17:00:00Z',
  endsAt: '2026-08-10T18:00:00Z',
  timezone: 'America/Los_Angeles',
  endTimezone: 'America/New_York',
});
```

Also assert skipped times and unselected repeated occurrences resolve to
`{ invalidField: 'start' | 'end' }` without visible copy.

- [ ] **Step 2: Run focused tests and verify shape failures**

Run: `pnpm --filter @docket/web test -- tests/calendar/calendar-time-draft.test.ts tests/calendar/datetime-input.test.ts`

Expected: FAIL because the draft still stores combined `datetime-local` strings and one display
timezone.

- [ ] **Step 3: Implement the new wall-field draft and resolution helpers**

```ts
export interface CalendarWallDraftField {
  readonly date: string;
  readonly time: string;
  readonly edited: boolean;
  readonly occurrence: LocalInputOccurrence | null;
}
```

Untouched exact seeds rebase when the display timezone changes; edited wall values and explicit
zone overrides remain stable. Applying a zone preserves wall date/time and clears stale fold
occurrence choices. Resolution uses the start zone for the start field and end zone for the end.

- [ ] **Step 4: Run focused tests and web typecheck**

Run: `pnpm --filter @docket/web test -- tests/calendar/calendar-time-draft.test.ts tests/calendar/datetime-input.test.ts && pnpm --filter @docket/web typecheck`

Expected: PASS after downstream compile errors are resolved in the schedule editor task branch.

---

### Task 4: Add the shell overlay host and clamped dialog positioning

**Files:**

- Create: `packages/ui/src/components/shell/ShellOverlayContext.tsx`
- Modify: `packages/ui/src/components/shell/AppShell.tsx`
- Modify: `packages/ui/src/components/shell/index.ts`
- Modify: `packages/ui/src/primitives/dialog.tsx`
- Create: `apps/web/src/components/calendar/use-clamped-dialog-position.ts`
- Test: `packages/ui/tests/components/shell/shell-full.test.tsx`
- Create: `apps/web/tests/calendar/use-clamped-dialog-position.test.tsx`

**Interfaces:**

- Produces: `useShellOverlayHost(): HTMLElement | null` from `@docket/ui/components`.
- Adds `portalContainer` and `overlayClassName` props to `DialogContent`.
- Produces: `useClampedDialogPosition({ open, host, preferredTop }): { style; handlePointerDown; handleKeyDown }`.

- [ ] **Step 1: Write failing shell-host and pure clamp tests**

```ts
expect(screen.getByTestId('shell-overlay-host')).toBeInTheDocument();
expect(clampDialogPosition({ x: 900, y: -20 }, hostRect, dialogSize)).toEqual({ x: 540, y: 0 });
```

Also assert only the handle begins dragging, pointer movement clamps all four edges, Shift+Arrow
moves by the larger step, and resize reclamps an open dialog.

- [ ] **Step 2: Run focused UI/web tests and verify missing-host failures**

Run: `pnpm --filter @docket/ui test -- tests/components/shell/shell-full.test.tsx && pnpm --filter @docket/web test -- tests/calendar/use-clamped-dialog-position.test.tsx`

Expected: FAIL because no overlay host or positioning hook exists.

- [ ] **Step 3: Implement the generic shell host and dialog portal options**

The content column becomes `relative`; an absolute overlay host is rendered after `<main>` and
provided through context. `DialogContent` passes `portalContainer` to Radix's portal and lets the
caller make the overlay transparent and host-relative while retaining modal focus semantics.

- [ ] **Step 4: Implement default placement, pointer capture, keyboard movement, and resize clamping**

The hook measures host and dialog, stores host-relative coordinates, and returns an absolute
transform-free style. It resets to the right-aligned preferred position for each new open draft and
uses `ResizeObserver` plus window resize to remain in bounds.

- [ ] **Step 5: Run focused tests, lint, and typecheck**

Run: `pnpm --filter @docket/ui test -- tests/components/shell/shell-full.test.tsx && pnpm --filter @docket/web test -- tests/calendar/use-clamped-dialog-position.test.tsx && pnpm --filter @docket/ui lint && pnpm --filter @docket/web typecheck`

Expected: PASS.

---

### Task 5: Build the progressive schedule editor and timezone child dialog

**Files:**

- Create: `apps/web/src/components/calendar/create-block-schedule-editor.tsx`
- Create: `apps/web/src/components/calendar/calendar-timezone-dialog.tsx`
- Modify: `apps/web/src/components/calendar/calendar-time-field.tsx`
- Test: `apps/web/tests/calendar/create-block-schedule-editor.test.tsx`
- Test: `apps/web/tests/calendar/calendar-timezone-dialog.test.tsx`

**Interfaces:**

- Produces controlled `CreateBlockScheduleEditor` with collapsed/expanded state and draft callbacks.
- Produces controlled `CalendarTimezoneDialog` returning `{ startTimezone; endTimezone }` only on OK.

- [ ] **Step 1: Write failing overview and expanded-schedule tests**

Assert the collapsed state contains one button named with full date/time/timezone/recurrence and no
timezone field. Activating it reveals separate `Start date`, `Start time`, `End time`, `All day`,
`Time zone`, and recurrence controls. Assert all-day hides timezone and multi-day reveals `End date`.

- [ ] **Step 2: Write failing timezone child-dialog tests**

Assert query matching through `PST`, `Pacific Time`, `America/Los_Angeles`, and `Los Angeles`;
separate end-zone enablement; Cancel immutability; OK result; current-zone reset; focus restoration;
and Escape closing the child before the parent.

- [ ] **Step 3: Run focused tests and verify missing components**

Run: `pnpm --filter @docket/web test -- tests/calendar/create-block-schedule-editor.test.tsx tests/calendar/calendar-timezone-dialog.test.tsx`

Expected: FAIL because both controlled components are absent.

- [ ] **Step 4: Implement the collapsed summary and expanded separate controls**

Use the shared DatePicker and `CalendarTimeField inputType="time"`. The summary formatter receives
both zone ids and renders a route only when they differ. Keep recurrence to the currently supported
`Does not repeat` value; `More options` remains the path to unsupported recurrence authoring.

- [ ] **Step 5: Implement the child dialog and accessible search listbox**

Use the local search index, `Checkbox`, `Dialog`, and semantic combobox/listbox roles. Keep a local
pending selection; call `onApply` only from OK. Show canonical id, common name, date-specific
abbreviation, and UTC offset per result.

- [ ] **Step 6: Run focused tests, the date-picker inventory, lint, and typecheck**

Run: `pnpm --filter @docket/web test -- tests/calendar/create-block-schedule-editor.test.tsx tests/calendar/calendar-timezone-dialog.test.tsx tests/pickers/date-picker-inventory.test.ts && pnpm --filter @docket/web lint && pnpm --filter @docket/web typecheck`

Expected: PASS.

---

### Task 6: Recompose quick create as the non-overlapping dialog

**Files:**

- Modify: `apps/web/src/components/calendar/create-block-form.tsx`
- Create: `apps/web/src/components/calendar/calendar-create-failure-notice.tsx`
- Modify: `apps/web/src/components/agenda/agenda-canvas.tsx`
- Test: `apps/web/tests/calendar/create-block-form.test.tsx`
- Test: `apps/web/tests/agenda/agenda-canvas-interactions.test.tsx`
- Test: `apps/web/tests/components/app-shell-frame.test.tsx`

**Interfaces:**

- Consumes: shell host, clamped positioning, schedule editor, timezone dialog, and resolved draft.
- Preserves: existing `CreateBlockFormProps` selection/draft callbacks for Calendar and Agenda.

- [ ] **Step 1: Replace old placement expectations with failing dialog-boundary tests**

Assert Agenda desktop renders `role="dialog"`, not a Popover; portals into the shell host; exposes
the move handle; uses no opaque overview timezone field; and preserves no-write-before-Save.
Assert mobile renders an opaque full-height dialog state so the grid is not visible beneath it.

- [ ] **Step 2: Add failing validation and failure-notification tests**

Assert empty title has `aria-invalid`, Save is disabled, and no validation/failure paragraph exists
inside the dialog. Force mutation failure and assert the draft remains and a single app-level
`role="status"` notice renders outside the dialog.

- [ ] **Step 3: Run focused tests and verify failures against the current Popover/form**

Run: `pnpm --filter @docket/web test -- tests/calendar/create-block-form.test.tsx tests/agenda/agenda-canvas-interactions.test.tsx tests/components/app-shell-frame.test.tsx`

Expected: FAIL because desktop Agenda still uses a region-anchored Popover and renders error prose.

- [ ] **Step 4: Split orchestration from presentation and wire the shell-level dialog**

Keep mutation, destination, dirty/navigation guard, and selection lifecycle in
`create-block-form.tsx`. Compose the controlled schedule editor. For Agenda desktop use the shell
host and clamped position; for Calendar toolbar keep a centered dialog; for narrow Agenda use the
opaque full-height dialog presentation. The top handle is present only where dragging is supported.

- [ ] **Step 5: Implement highlight-only validity and external failure notice**

Compute one `canSave` boolean from title, destination, wall resolution, and all-day bounds. Mark
only invalid controls. Do not render visible error copy in `DialogContent`. Render the fixed
application-owned notice as a sibling portal and retain all draft state on failure.

- [ ] **Step 6: Submit both timezone fields and preserve exact draft projection**

```ts
create.mutate({
  intent,
  title,
  startsAt: resolved.startsAt,
  endsAt: resolved.endsAt,
  timezone: resolved.timezone,
  ...(resolved.endTimezone !== resolved.timezone ? { endTimezone: resolved.endTimezone } : {}),
});
```

- [ ] **Step 7: Run focused integration tests, lint, and typecheck**

Run: `pnpm --filter @docket/web test -- tests/calendar/create-block-form.test.tsx tests/calendar/calendar-create-mutation.test.tsx tests/agenda/agenda-canvas-interactions.test.tsx tests/components/app-shell-frame.test.tsx && pnpm --filter @docket/web lint && pnpm --filter @docket/web typecheck`

Expected: PASS.

---

### Task 7: Restore visible whole-step Agenda zoom

**Files:**

- Create: `apps/web/src/components/agenda/agenda-scale-controls.tsx`
- Modify: `apps/web/src/components/agenda/agenda-context.tsx`
- Modify: `apps/web/src/components/agenda/agenda-header.tsx`
- Modify: `apps/web/src/components/agenda/agenda-display-menu.tsx`
- Test: `apps/web/tests/agenda/agenda-scale-controls.test.tsx`
- Test: `apps/web/tests/agenda/agenda-context-navigation.test.tsx`

**Interfaces:**

- Produces: `scaleUp`, `scaleDown`, `canScaleUp`, `canScaleDown`, and whole-step label in Agenda context.

- [ ] **Step 1: Write failing visible-control and context tests**

Assert `−`, `2×`, and `+` are visible, ends disable at `1×`/`3×`, clicks persist 48/96/144, and
the readout opens the existing display menu. Assert an open draft remains projected after scale.

- [ ] **Step 2: Run focused tests and verify the controls are absent**

Run: `pnpm --filter @docket/web test -- tests/agenda/agenda-scale-controls.test.tsx tests/agenda/agenda-context-navigation.test.tsx`

Expected: FAIL because scale is only available inside the display menu.

- [ ] **Step 3: Implement the direct stepper over the existing legal scale model**

Use `agendaScaleStepDown`/`agendaScaleStepUp`; keep list/timeline in the display menu and make the
readout its trigger. The header remains one row at the narrow rail width.

- [ ] **Step 4: Run Agenda tests, lint, and typecheck**

Run: `pnpm --filter @docket/web test -- tests/agenda/agenda-scale.test.ts tests/agenda/agenda-scale-controls.test.tsx tests/agenda/agenda-context-navigation.test.tsx && pnpm --filter @docket/web lint && pnpm --filter @docket/web typecheck`

Expected: PASS.

---

### Task 8: Documentation, full validation, and live craft audit

**Files:**

- Modify: `docs/engineering/specs/calendar-ui.md`
- Modify: `docs/design/audits/inventories/date-pickers.md` if new picker instances are introduced
- Create: `docs/design/audits/2026-08-10-agenda-quick-create-dialog-refinement.md`
- Modify: `docs/WORKLOG.md`

**Interfaces:**

- Consumes the finished product slice; produces durable acceptance evidence.

- [ ] **Step 1: Update the calendar UI contract and WORKLOG implementation record**

Document shell-level dialog placement, progressive disclosure, timezone semantics, highlight-only
validation, failure notification placement, responsive behavior, and zoom controls. Keep the task
active until runtime and repository gates pass.

- [ ] **Step 2: Run focused cross-package tests**

Run the Task 1–7 test files together. Expected: PASS with no skipped tests.

- [ ] **Step 3: Run repository gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm format:check`

Expected: every command exits 0.

- [ ] **Step 4: Validate the running product at required widths/themes**

Use an authenticated throwaway local account and API-backed events. Capture desktop and mobile,
light and dark, for overview, expanded schedule, timezone search, separate-zone, missing-title,
failed-save notice, and saved states. Measure dialog/Agenda rectangle intersection as zero while
opening, dragging to every edge, resizing, and toggling rail/zoom. Confirm no create request before
enabled Save and exactly one afterward.

- [ ] **Step 5: Run the Docket Craft Rubric and write the audit**

Score all eight dimensions, verify accessibility/responsive/theme/no-placeholder/screenshot gates,
and record exact screenshot/report paths plus runtime measurements.

- [ ] **Step 6: Mark WORKLOG complete and self-review the final diff**

Run: `git diff --check`, scan for TODO/skipped tests, confirm only intended paths, and verify
`git rev-list --merges --count origin/main..HEAD` is `0`.

- [ ] **Step 7: Commit the complete product slice atomically**

Use the repository-required chain:

```bash
git restore --staged . && command git add apps packages docs pnpm-lock.yaml && git commit -F .codex-commit-message
```

Commit subject: `feat(hub): Refine Agenda quick create`
