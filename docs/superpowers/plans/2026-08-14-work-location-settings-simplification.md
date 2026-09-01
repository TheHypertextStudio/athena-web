# Work Location Settings Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the exposed work-location control panel with a compact place list, dialog-based schedule editing, and concise device/sync settings.

**Architecture:** Extend the canonical place DTO and Drizzle row with an optional private address, then isolate place/map and schedule editors from the route component. The route retains typed query/mutation ownership while compact presentation components progressively disclose editing controls.

**Tech Stack:** TypeScript, Zod, Hono, Drizzle/Postgres, React 19, Next.js App Router, TanStack Query, Radix/shadcn primitives, Material icons, MapLibre GL JS, Vitest, Playwright.

## Global Constraints

- A saved place has no intrinsic `home`, `office`, or `custom` kind.
- Home remains an independent optional singular profile designation.
- A name alone is a valid place.
- Address is optional, private, limited to 240 characters, and never projected to providers.
- Map coordinates use a product-owned 250 metre matching radius; no radius control is user-facing.
- Raw observation coordinates never cross the network.
- The page has one primary action: `Add place`.
- Icon-only row utilities have accessible names, tooltips, visible focus, and mobile touch targets of at least 40px.

---

### Task 1: Persist optional place addresses

**Files:**

- Modify: `the deleted legacy type warehouse tests/dto/work-location.test.ts`
- Modify: `domains/planning/src/contracts/work-location.ts`
- Modify: `packages/db/tests/schema/work-location-schema.test.ts`
- Modify: `packages/db/src/schema/work-location.ts`
- Create: `packages/db/drizzle/0086_work_place_address.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/db/drizzle/meta/0086_snapshot.json`
- Modify: `apps/api/tests/services/work-location/repository.test.ts`
- Modify: `apps/api/src/services/work-location/repository.ts`

**Interfaces:**

- Produces: `WorkPlaceCreate.address?: string | null`, `WorkPlaceUpdate.address?: string | null`, and `WorkPlaceOut.address: string | null`.
- Preserves: `WorkPlaceSummary` without address or coordinates.

- [ ] **Step 1: Write failing contract and repository tests**

```typescript
const parsed = WorkPlaceCreate.parse({ name: 'Main library', address: '123 Main St' });
expect(parsed.address).toBe('123 Main St');
expect(WorkPlaceCreate.safeParse({ name: 'Library', address: 'x'.repeat(241) }).success).toBe(
  false,
);
```

- [ ] **Step 2: Run the focused tests and verify the missing address contract fails**

Run: `pnpm domain:check`

- [ ] **Step 3: Add the nullable address contract, schema column, repository mappings, and generated migration**

```typescript
address: z.string().trim().min(1).max(240).nullable().optional();
```

- [ ] **Step 4: Run the contract, schema, and repository tests**

Run: `pnpm domain:check&& pnpm --filter @docket/db test -- tests/schema/work-location-schema.test.ts && pnpm --filter @docket/api test -- tests/services/work-location/repository.test.ts`

- [ ] **Step 5: Commit the completed persistence slice**

Commit type/scope: `feat(work-location)` with a substantive body explaining the private optional address and provider boundary.

### Task 2: Build the simple place editor and map picker

**Files:**

- Create: `apps/web/src/components/work-location/place-editor-dialog.tsx`
- Create: `apps/web/src/components/work-location/place-map-picker.tsx`
- Create: `apps/web/tests/work-location/place-editor-dialog.test.tsx`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces: `PlaceEditorValue { name: string; address: string | null; geofence: WorkPlaceGeofence | null }`.
- Produces: `PlaceEditorDialog` with controlled `open`, optional `place`, and async-safe `onSave`.
- Consumes: existing `WorkPlaceOut` and the fixed radius `250` metres.

- [ ] **Step 1: Write failing dialog tests for name-only save, optional address, and map disclosure**

```tsx
fireEvent.click(screen.getByRole('button', { name: 'Choose on map' }));
expect(screen.getByLabelText('Place map')).toBeVisible();
expect(screen.queryByLabelText(/radius/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and verify the missing component fails**

Run: `pnpm --filter @docket/web test -- tests/work-location/place-editor-dialog.test.tsx`

- [ ] **Step 3: Add MapLibre through pnpm and implement the lazy map picker**

Run: `pnpm --filter @docket/web add maplibre-gl`

The picker initializes only while disclosed, uses `https://tiles.openfreemap.org/styles/positron`,
sets or moves a marker on map click, and reports `{ latitude, longitude }` without displaying raw
coordinate fields.

- [ ] **Step 4: Implement the dialog and fixed-radius payload**

```typescript
geofence: point ? { ...point, radiusMeters: 250 } : existingGeofence;
```

- [ ] **Step 5: Run the dialog tests and web typecheck**

Run: `pnpm --filter @docket/web test -- tests/work-location/place-editor-dialog.test.tsx && pnpm --filter @docket/web typecheck`

- [ ] **Step 6: Commit the completed place-editor slice**

Commit type/scope: `feat(work-location)` with a substantive body explaining progressive disclosure and the fixed matching policy.

### Task 3: Replace inline settings controls with compact rows and dialogs

**Files:**

- Create: `apps/web/src/components/work-location/schedule-editor-dialog.tsx`
- Modify: `apps/web/src/app/(app)/settings/work-locations/page.tsx`
- Modify: `apps/web/tests/work-location/work-locations-settings.test.tsx`

**Interfaces:**

- `ScheduleEditorDialog` consumes places, timezone, and optional assertion; it emits a complete `WorkLocationAssertionCreate` value.
- The page owns canonical mutations and passes compact callbacks into place, schedule, occurrence, detection, planning, and sync rows.

- [ ] **Step 1: Replace the existing settings test with failing behavior assertions**

```tsx
expect(screen.getByRole('button', { name: 'Add place' })).toBeVisible();
expect(screen.queryByRole('heading', { name: 'Regular places' })).not.toBeInTheDocument();
expect(screen.queryByLabelText(/geofence radius/i)).not.toBeInTheDocument();
expect(screen.queryByRole('button', { name: 'Save name' })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused settings test and verify it fails against the inline control panel**

Run: `pnpm --filter @docket/web test -- tests/work-location/work-locations-settings.test.tsx`

- [ ] **Step 3: Implement the compact page header and saved-place rows**

Use `MapPin`/`Home`, `Target`, `MoreHorizontal`, `DropdownMenu`, and `Tooltip`; keep `Add place` as the single filled text action.

- [ ] **Step 4: Move schedule creation/series editing and occurrence editing into dialogs**

The page shows only summaries and overflow actions until the user selects an edit.

- [ ] **Step 5: Collapse device detection, planned work, and calendar sync into settings rows**

Healthy sync accounts render no action. Device detection has one `Start`/`Stop` action and no radius or coordinate copy.

- [ ] **Step 6: Run settings, strip, reporter, and geofence tests**

Run: `pnpm --filter @docket/web test -- tests/work-location`

- [ ] **Step 7: Commit the completed settings redesign**

Commit type/scope: `feat(work-location)` with a substantive body describing the user-visible hierarchy and retained canonical behavior.

### Task 4: Update the end-to-end journey and prove the surface visually

**Files:**

- Modify: `apps/web/e2e/settings/work-locations.spec.ts`
- Create: `docs/design/audits/2026-08-14-work-locations.md`
- Modify: `docs/WORKLOG.md`

**Interfaces:**

- Exercises the real settings route through add/edit, home, current, schedule, and occurrence flows.
- Produces four standard screenshots plus 320px overflow and keyboard evidence.

- [ ] **Step 1: Update the Playwright journey for dialog and overflow interactions**

- [ ] **Step 2: Run focused package tests and the Playwright journey**

Run: `pnpm --filter @docket/web test -- tests/work-location && pnpm --filter @docket/web test:e2e -- e2e/settings/work-locations.spec.ts`

- [ ] **Step 3: Run repository validation**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

- [ ] **Step 4: Capture 1440x900 and 390x844 light/dark screenshots, check 320px overflow and keyboard focus, and write the craft scorecard**

- [ ] **Step 5: Update the worklog with validation, visual evidence, and retrospective**

- [ ] **Step 6: Commit the validation and documentation closeout**

Commit type/scope: `feat(work-location)` with a substantive body covering the end-to-end and design-review evidence.
