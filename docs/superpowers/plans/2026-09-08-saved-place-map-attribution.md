# Saved-Place Map Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the saved-place picker's long generated attribution banner with short visible OpenMapTiles and OpenStreetMap links.

**Architecture:** `PlaceMapPicker` will disable MapLibre's generated attribution control and will own one static attribution row over the map. The row names only the two required data projects, while the existing OpenFreeMap styles and all map interaction stay unchanged.

**Tech Stack:** React 19, TypeScript, MapLibre GL JS 6, Tailwind CSS, Vitest, Testing Library, Playwright

---

### Task 1: Replace the generated banner with short visible credits

**Files:**

- Modify: `apps/web/tests/work-location/place-map-picker.test.tsx:101-123`
- Modify: `apps/web/src/components/work-location/place-map-picker.tsx:92-98,174-215`
- Modify: `apps/web/e2e/settings/saved-place-picker-shots.spec.ts:77-79`
- Modify: `docs/WORKLOG.md:10-27`
- Replace: `docs/design/audits/screenshots/2026-09-08-saved-place-picker/place-editor-1440x900-light.png`
- Replace: `docs/design/audits/screenshots/2026-09-08-saved-place-picker/place-editor-1440x900-dark.png`
- Replace: `docs/design/audits/screenshots/2026-09-08-saved-place-picker/place-editor-390x844-light.png`
- Replace: `docs/design/audits/screenshots/2026-09-08-saved-place-picker/place-editor-390x844-dark.png`

- [ ] **Step 1: Write the failing component test**

Add this test after the light-style test in `place-map-picker.test.tsx`:

```tsx
it('uses short visible map credits instead of MapLibre attribution', async () => {
  render(<PlaceMapPicker value={null} onChange={vi.fn()} />);
  await screen.findByRole('region', { name: 'Place map' });

  expect(runtime.maps[0]?.options['attributionControl']).toBe(false);
  expect(screen.getByRole('link', { name: 'OpenMapTiles' })).toHaveAttribute(
    'href',
    'https://openmaptiles.org/',
  );
  expect(screen.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute(
    'href',
    'https://www.openstreetmap.org/copyright',
  );
  expect(screen.queryByText('OpenFreeMap')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify that it fails**

Run:

```bash
pnpm --filter @docket/web exec vitest run tests/work-location/place-map-picker.test.tsx --maxWorkers=1
```

Expected result: The new test fails because `attributionControl` is `{}` and neither short credit link exists.

- [ ] **Step 3: Add the static attribution row**

Change the MapLibre option in `place-map-picker.tsx`:

```tsx
attributionControl: false,
```

Render this row inside the existing relative map wrapper after the loading and failure overlays:

```tsx
<p
  aria-label="Map data attribution"
  className="bg-surface/85 text-on-surface-variant absolute right-1 bottom-1 z-10 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-4 whitespace-nowrap backdrop-blur-sm"
>
  <span aria-hidden="true">©</span>
  <a className="underline-offset-2 hover:underline" href="https://openmaptiles.org/">
    OpenMapTiles
  </a>
  <span aria-hidden="true">· ©</span>
  <a className="underline-offset-2 hover:underline" href="https://www.openstreetmap.org/copyright">
    OpenStreetMap
  </a>
</p>
```

Keep the links in the current tab. That behavior avoids an unrequested new-window side effect and preserves normal browser link controls.

- [ ] **Step 4: Run the focused component test and verify that it passes**

Run:

```bash
pnpm --filter @docket/web exec vitest run tests/work-location/place-map-picker.test.tsx --maxWorkers=1
```

Expected result: The `PlaceMapPicker` test file passes with 11 tests.

- [ ] **Step 5: Update the browser assertion**

Replace the old generated-control assertion in `saved-place-picker-shots.spec.ts` with:

```tsx
await expect(dialog.locator('.maplibregl-ctrl-attrib')).toHaveCount(0);
await expect(dialog.getByRole('link', { name: 'OpenMapTiles' })).toBeVisible();
await expect(dialog.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
```

- [ ] **Step 6: Run the authenticated visual journey**

Read `docs/engineering/ui-verification.md`, then use its existing development stack and session flow. Run the shot test with one worker:

```bash
E2E_EVIDENCE=1 pnpm --filter @docket/web exec playwright test settings/saved-place-picker-shots.spec.ts --workers=1
```

Expected result: One Playwright test passes. The command replaces all four screenshots. Each image shows a single-line credit without the long OpenFreeMap banner or horizontal overflow.

- [ ] **Step 7: Run focused static validation**

Run:

```bash
pnpm turbo typecheck lint --filter=@docket/web --concurrency=2
```

Expected result: The filtered typecheck and lint tasks pass.

- [ ] **Step 8: Complete the work log**

Move `WORK-LOCATION-ATTRIBUTION-001` to completed status. Record the exact focused test count, Playwright result, two widths, two themes, typecheck result, lint result, and any environment failure that remains unresolved. Remove the design-review blocker.

- [ ] **Step 9: Inspect and commit the owned change**

Run:

```bash
git diff --check
git status --short
```

Stage only the picker, its two test files, the four replacement screenshots, and `docs/WORKLOG.md`. Commit with this message through standard input rather than `git commit -m`:

```text
fix(work-location): Reduce saved-place map attribution

The saved-place picker no longer lets the generated provider banner consume a
large part of the map. It shows short visible OpenMapTiles and OpenStreetMap
links while preserving the required data credit and all map behavior.

The compact row stays on one line at desktop and mobile widths in both themes.
OpenFreeMap remains the basemap host, but its optional name is omitted from the
visible credit.

Docs-impact: Updated - The work log records the attribution decision and visual
evidence.

Co-authored-by: Codex <codex@openai.com>
```

Expected result: One `fix(work-location)` commit contains the implementation, behavior tests, refreshed visual evidence, and work-log completion.
