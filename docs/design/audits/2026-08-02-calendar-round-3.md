---
surfaces: ['calendar']
date: 2026-08-02
verdict: ship
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 3
  color: 3
  motion: 3
  states: 3
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: /calendar (rebuild, round 3) — 2026-08-02

**Verdict: SHIP.** Every dimension is at or above the bar and all five gates pass. Round 2's two
failing dimensions — Hierarchy (2) and Detail craft (2) — and its red Responsive gate are closed,
each with a number rather than an opinion.

This supersedes nothing. `2026-08-02-calendar-round-1.md` and `-round-2.md` remain the record of what
was found; this document reports what moved since round 2, what is still open, and what could not be
verified.

Every claim below is backed by a PNG that was opened and looked at, or by a number printed from a
probe whose script is named. Two things are reported as **open** rather than passed, and one e2e
failure that reproduces on this surface is reported as **not caused by this work**, with the
experiment that showed it.

---

## Screenshots and machine evidence

Root: `apps/web/.data/design-review/cal-r3/`

| Set                 | Files                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Populated shot set  | `final/{320,390,768,1024,1280,1440,1920}-{light,dark}.png` + `final/report.json` |
| Layer-coloured grid | `layers/grid-1440-{light,dark}.png` + `layers/report.json`                       |
| Duplicate calendars | `layers/calendars-1440-{light,dark}.png`                                         |
| Dense resize sweep  | `sweep/report.json` (162 widths, 320 → 2200)                                     |

Probe scripts: `apps/web/.data/design-review/cal-r3/probe-{baseline,sweep,layers}.ts`
(gitignored; they drive the running dev stack with the calendar route fixtures).

---

## The seven round-2 items, and what closed them

### 1. Events were invisible — 1.04:1 light, 1.16:1 dark

**Closed. Measured 1.714:1 light and 1.768:1 dark** for an uncoloured block, and **1.99–2.18:1 light
/ 2.03–2.27:1 dark** for a layer-coloured one (`final/report.json` → `cardContrast`,
`layers/report.json`).

The fix is one recipe, `apps/web/src/components/scheduling/scheduling-item-surface.ts`, and it is a
`color-mix` rather than a container token for a reason the tonal ramp forces: `--surface` is the
_brightest_ tone in light mode and a _mid_ tone in dark, so no single container step moves in the
visible direction in both themes. `--color-on-surface` does — dark under a light theme, light under a
dark one — so mixing 22% of it into the canvas darkens the block in light and lightens it in dark, by
construction, from one expression. A layer colour is folded in at a deliberate minority share (25%)
over that floor, so a pale calendar colour can tint a block but cannot wash the step back out. The
4px stripe still carries the layer's exact colour (3.25:1 and 5.09:1 against the canvas in the two
fixtures).

`apps/web/tests/scheduling/scheduling-item-surface.test.ts` re-does that arithmetic against the real
tokens read out of `packages/ui/src/styles/globals.css` and fails with the number if either theme
drops below 1.5:1, if the block moves the wrong way in either theme, or if the title's contrast on
the new fill falls under 4.5:1.

### 2. Today's badge was a blue half-disc and titles clipped under the hour gutter

**Closed, and the cause was not the one round 2 proposed.** It is not a missing scroll-snap rule; it
is that the horizontal offset was computed once, against the _unmeasured_ lane width, and never
re-derived. Lane width comes from a measured viewport, so it always changes at least once after
mount and again on every resize — and the first paint's pixel offset survived into a completely
different geometry, parking a fraction of a lane under the `sticky left-0` gutter.
`use-scheduling-viewport.ts` now re-derives the offset from the new lane width, rounded to a whole
lane, whenever the width changes under an unchanged window.

Measured across the dense sweep: **a lane's left edge sits exactly at the gutter's right edge at all
162 widths**, `misaligned: 0` (`sweep/report.json`). Today's badge renders as a full circle at every
captured width in both themes.

**Scroll-snap was tried and deliberately rejected.** `snap-x snap-mandatory` and `snap-x
snap-proximity` both broke `e2e/scheduling/fluid-scheduling-gestures.spec.ts`: this scrollport is a
direct-manipulation surface, a resize grip is grabbed by scrolling it into view, measuring its box
and pressing that point, and a snap applied a frame after that programmatic scroll moves the grip out
from under the pointer. Verified both ways — with snap the spec fails, without it the spec passes and
the sweep's alignment result is byte-identical. The reasoning is recorded in `scheduling-canvas.tsx`
so the next person does not re-add it.

### 3. The New button fell off a 320px screen

**Closed.** Its right edge is at **301px in a 320px viewport** and **371px in a 390px viewport**;
the toolbar's `scrollWidth === clientWidth` at every measured width (`final/report.json` →
`toolbar`, `controls`). Zero elements outside the schedule scrollport extend past the viewport at any
of the seven widths in either theme.

The row's control sizes are now chosen against arithmetic rather than as one fluid rule — 36px below
a 22rem container, a **44 × 44 touch target** from there to `@2xl`, then 32px once the row carries
labels — and the heading's `min-w-16` floor is gone, because a floor on the flexible child is exactly
what turns a too-narrow row into a _control_ pushed off screen. The 44px step starts at a 22rem
container rather than at `@sm` (24rem) because `<main>` reserves a stable scrollbar gutter, so a 390px
phone reports a 379px container and would otherwise miss `@sm` entirely.

That also closes the round-2 a11y note about 40px targets: at 390 × 844 every chrome control measures
**44 × 44**.

### 4. 12px was 70% of all rendered text

**Closed, past the ask.** The distribution is now `{14px: 42}` at 320 and 390, and
`{14px: 57, 16px: 1}` at 1440 — **zero nodes at 12px or below, at every width, in both themes**
(`final/report.json` → `sizes`). The hour labels decided this on their own: 24 of them, the most
numerous run of text on the surface. They moved to 14px and the gutter widened 76 → 88px so
`12:00 AM` still fits on one line.

The per-card kind label (`Block`, `Calendar event`) is gone rather than resized. Round 2 measured it
taking a fixed 32px of a 154px card and _never truncating_ while the title beside it was cut off at
98px — chrome outranking content on the surface whose entire job is showing events. A sync **state**
("Conflict", "Sync issue") still appears, because that is something the reader has to act on.

### 5. Holiday / personal calendar dedup

**Built, at both levels.** Round 2 could not render it; this round can.

- **Calendar list (CAL-13).** A calendar arriving on more than one linked account is listed **once**,
  on a row attributed to all of them, with a banner stating the collapse and a `Show each copy`
  disclosure that expands it back to one independently toggleable row per account. Ticking the
  collapsed row ticks every copy, so what is on the grid and what the checkbox says stay in step.
  Screenshot: `layers/calendars-1440-{light,dark}.png` — two identical "Holidays in United States"
  layers on two connections render as one row reading `On 2 linked accounts`.
- **Grid (CAL-14).** `calendar-event-dedup.ts` collapses the same event arriving from two calendars
  into one block, keyed on the provider event id (+ recurrence instance) or on an identical
  case-folded title at an identical instant, and **only across different layers** — two entries
  inside one calendar are two real entries and hiding one would be the app lying about the day.
  Verified in a real browser: `e2e/calendar/calendar-duplicate-events.spec.ts` renders **one** block
  for the duplicated meeting and still **three** blocks in total, so "fewer blocks" cannot pass for
  "correct blocks". The same collapse is visible in `layers/grid-1440-*.png`, where three fixture
  items render as two.
- **Nothing is hidden silently.** The folded copies are handed back and named in the item's own
  drawer ("This event also synced from one other calendar. It is drawn once here.", plus one row per
  calendar).

### 6. Chrome outweighed content at 1440 (656px chrome vs 717px calendar)

**Closed by the tier-0 shell contract, and re-measured here.** At 1440 `<main>` is **867px** and the
schedule inside it is **824 × 808**, against **573px** of total chrome. Content now outweighs chrome
by 294px, where round 2 measured chrome ahead by 61px. Grid area share: **51.4%** of the viewport at
1440, 80.7% at 390.

### 7. The responsiveness cliff

**Verified gone.** A single page dragged from 320 to 2200px across **162 widths** (every 20px, plus
every single pixel from 1010–1040 and 1420–1460):

```
px drops: 1 · horizontal overflow: 0 · misaligned lanes: 0 · two calendars: 0 · min area share: 42.5%
```

The one px drop is **1023 → 1024**, the shell's documented nav boundary where the sidebar stops being
a drawer and becomes a column — provably unavoidable and owned by the shell contract, not by this
surface. **1439 → 1440 is 823px → 824px**, where round 2 measured 1060px → 717px and four day lanes
collapsing to two.

---

## Also confirmed, as asked

- **"It must be possible to drag events into time blocks."** `e2e/calendar/calendar-event-into-block.spec.ts`
  is **mock-free**: it creates both items through the product's own `POST /v1/me/calendar/items` in
  the signed-in browser, drags the event onto the block, asserts the UI immediately, re-reads the
  relations endpoint to prove the **server** stored it, then **reloads the page from scratch** and
  asserts it again. The existing `fluid-scheduling-relations.spec.ts` mocks the network and asserts
  recorded POST bodies; it cannot tell a working feature from a dropped write, which is why this spec
  exists beside it rather than instead of it.
- **No second calendar, ever.** `scheduleCount === 1` at every one of the 14 captured states, at all
  162 sweep widths, and in every one of the 64 panel combinations below.

## Hard gates

| Gate                | Result | Evidence                                                                                                                                                                                                                                                                                       |
| ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | ✅     | Every chrome control at 390 × 844 measures 44 × 44. Text floor is 14px with nothing below it. Block titles clear 4.5:1 on the new fill in both themes (asserted, not sampled). Landmarks labelled; one schedule region; item cards keep their named `Move …` / `Resize … from start` controls. |
| Responsive          | ✅     | 162-width live-resize sweep: one px drop, at the shell's own 1023→1024 nav boundary. Zero horizontal overflow. Zero misaligned lanes. Floor 42.5% of viewport area.                                                                                                                            |
| Theme parity        | ✅     | Light and dark captured at all seven widths, populated and empty. Dark is designed: the block fill steps _up_ off the canvas where light steps _down_, from the same expression.                                                                                                               |
| No placeholder      | ✅     | No lorem, no dead rows, no no-op controls in any probed state. The Calendars popover states the real situation and the two ways out. The duplicate banner states the collapse whether it is on or off.                                                                                         |
| Screenshot-verified | ✅     | Every claim above cites a PNG that was opened or a printed measurement. The two things not verified are named under Limitations rather than passed.                                                                                                                                            |

## Guarding tests added

- `apps/web/e2e/calendar/calendar-panel-floor.spec.ts` — the 10% floor against the **full
  cross-product** of panel states (rail docked/collapsed × Calendars / Display / item drawer / none ×
  sync alert shown/hidden) at 390 × 844, 834 × 1112, 1024 × 768 and 1440 × 900. 64 measurements, each
  reading `getBoundingClientRect()` on the live grid and comparing area against the viewport, each
  labelled with the exact combination. **Sensitivity demonstrated, not assumed**: injecting
  `#shell-aside { width: 68% }` into the running page makes it fail with
  `1440x900 · rail docked · none · no alert: grid area is 7.38% of the viewport`; removing the
  injection restores the pass.
- `apps/web/e2e/calendar/calendar-duplicate-events.spec.ts` — one block for a duplicated event, three
  blocks in total, sources discoverable in the drawer.
- `apps/web/e2e/calendar/calendar-event-into-block.spec.ts` — the mock-free drag described above.
- `apps/web/tests/scheduling/scheduling-item-surface.test.ts` — the contrast arithmetic (10 cases).
- `apps/web/tests/calendar/calendar-event-dedup.test.ts` — 11 cases, half of them negative: a double
  booking inside one calendar, two different events on two accounts, two occurrences of one recurring
  event, and native items with no provider identity all stay separate.
- `apps/web/tests/scheduling/scheduling-canvas-horizontal-viewport.test.tsx` — a new case pinning the
  lane re-alignment when the measured lane width changes.
- `apps/web/tests/calendar/calendar-layer-panel.test.tsx` — the collapsed row, its attribution, its
  one-tick-moves-every-copy behaviour, and the expansion back to per-account rows.

## Limitations — what is still open

1. **The Schedule region uses the browser's focus outline, not the design system's ring.** Carried
   over from round 2 finding 9. Visible, so not an a11y gate failure, but it is the one focus
   treatment on the page that is not the shared one. Not fixed.
2. **Day lanes still expose no `role="columnheader"`.** Carried over from round 2 finding 10. Not
   fixed.
3. **Two Athena entry points remain on screen together** — the toolbar's contextual door and the
   global FAB. Round 2 finding 7. The FAB belongs to the shell, so removing one is a cross-surface
   decision rather than a calendar one; recorded, not fixed.
4. **Loading skeletons were not captured**, same as round 2 — the surface resolves too fast against
   the local stack to catch without request throttling.

## One reproducing e2e failure that this work did not cause

`e2e/scheduling/fluid-scheduling.spec.ts` → "keeps a bounded rolling canvas…" fails at line 101: the
visible-lane anchor drifts one day back during the initial 1 → N lane transition, so the range request
is `2026-07-09 / 9 days` where the spec expects `2026-07-10 / 9`. Rendered, that means **today is the
second lane on load rather than the first**.

It is not caused by anything in this round. Both scheduling changes were disabled in the running app
and the failure reproduced byte-identically each time — with the lane re-alignment removed, with the
hour gutter returned to 76px, and with both removed together. The concurrent shell work adding a
standing banner slot above `<main>` is the most likely cause (it changes the first-paint measurement
that drives the transition), but that is a lead, not a conclusion. Recorded here so it is not lost.

`e2e/calendar/layered-calendar.spec.ts` → "read-only provider items stay visible…" fails on
`/orgs/:orgId/my-work` with `Attempted to call withOfflineOutbox() from the server` — a different
surface and a different workstream.
