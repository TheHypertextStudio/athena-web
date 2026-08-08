---
surfaces: ['agenda']
date: 2026-08-07
verdict: needs-work
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 3
  color: 2
  motion: 3
  states: 3
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: false
---

# Design review: the Agenda rail — 2026-08-07

**Verdict: BELOW BAR.** Seven dimensions are at the bar. Colour discipline is a 2, and the
screenshot gate is red because one state I am required to capture — the rail in its mobile Sheet —
I did not capture. Both are stated below rather than rounded up.

This surface had never been reviewed. It had never been in `surface-inventory.md` either; nor had
the two rail panels beside it. That is the first finding, and it is the reason a full time grid sat
in a 280px column for as long as it did: nothing in the process was looking at it.

## Screenshots and machine evidence

Root: `apps/web/.data/design-review/agenda-rail-final/` (gitignored).

| Set                    | Files                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| Populated, both themes | `today-1440x900-{light,dark}.png`                                          |
| Empty day, both themes | earlier run, same path, before seeding                                     |
| Mobile viewport        | `today-390x844-{light,dark}.png` — **rail not visible**, see the gate note |

Probe: `apps/web/.data/design-review/agenda-audit.ts` (gitignored) drives the running stack, seeds
four items through the product's own `POST /v1/me/calendar/items`, and measures the rendered result.

```
railWidth 280 · scheduleWidth 256 · gutterWidth 44
labelCount 25 · subHourLabels 0 · firstLabels ["12 AM","1 AM","2 AM","3 AM"]
fontSizes {14px: 38, 16px: 1} · cardsWithoutText 0 · docOverflow false
```

## Scores

| Dimension                 | Score | Evidence                                                                                                                                                                                                                                  |
| ------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice | 3     | Correct register: calm, dense, no decoration. The rail states the day (`Today · Aug 7`) and shows it; it does not explain what a calendar is. Nothing on it is filler.                                                                    |
| 2. Typographic craft      | 3     | `{14px: 38, 16px: 1}` across the whole rail — **zero nodes at or below 12px**, holding round 3's floor. Hour labels are `tabular-nums`. The header moved off raw `text-sm font-semibold` onto `text-title-small`.                         |
| 3. Spatial rhythm         | 3     | 44px gutter against a 256px canvas: 17%, down from 34%. One rhythm; the header is a single non-wrapping row whose date is the only flexible child.                                                                                        |
| 4. Hierarchy              | 3     | Title first at `text-title-small`, time range one step down, nothing else at rest. `Read-only` is a 16px glyph rather than a chip at the title's own size.                                                                                |
| 5. Colour discipline      | **2** | Every block's fill mixes a raw provider hex at 25% (`scheduling-item-surface.ts:80`), so hue is spent on which calendar an event came from — not on any of the earned categories the rubric lists. See Findings 1.                        |
| 6. Motion & feedback      | 3     | Hover/focus are one CSS cascade off two custom properties, no JS hover state, `motion-reduce` honoured on every transition touched.                                                                                                       |
| 7. States completeness    | 3     | Empty offers a control, not an instruction. Loading is a sibling of the canvas, so it cannot produce a second scrollbar. Overflow verified: a 5-minute block keeps its title, a 96px block clamps to 3 lines, dense collisions show `+N`. |
| 8. Detail craft           | 3     | `docOverflow false`; 320px check passes. One relationship icon across both densities where there were two. Lock and link glyphs share a stroke weight with the grip.                                                                      |

## Gates

| Gate                | Result | Evidence                                                                                                                                                                                |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | ✅     | Every rail control carries a name — `Previous day`, `Next day`, `List view`, `Timeline view`, `Show more detail`, `Show more hours`, plus per-item move/resize/relate. 14px text floor. |
| Responsive          | ✅     | `docOverflow false` at 1440; the capture tool's 320px check passes. Rail width is a `clamp`, so it contributes no step to `<main>`.                                                     |
| Theme parity        | ✅     | Populated and empty captured light and dark at 1440×900.                                                                                                                                |
| No placeholder      | ✅     | No lorem, no dead rows. The empty state's control resolves to `/calendar`.                                                                                                              |
| Screenshot-verified | ❌     | The rail's **mobile presentation was not captured**. Below `lg` it is a Radix Sheet behind the top bar's `Show Agenda` trigger, so the standard 390×844 shot does not contain it.       |

## Findings, by severity

1. **Colour is spent on provenance, not meaning.** `scheduleItemFill` folds a raw provider hex into
   every block at 25% and `scheduleItemStripe` carries it at full strength. The rubric's earned list
   is health, priority, workflow state, agent status, and one org accent; "which calendar this came
   from" is on none of them. There is a real argument the other way — a layer colour is the user's
   own taxonomy, not decoration — and round 3 designed the current recipe deliberately, with
   measured contrast in both themes. **Not changed here.** It cannot be a no-op at 1440px, so it is
   a `/calendar` decision, not a rail one, and rewriting a shipped SHIP verdict's fill on one
   reviewer's reading is not a call this review gets to make. It is the open item.
2. **The mobile Sheet is unreviewed.** Two `[aria-label="Schedule"]` regions exist in the DOM at
   390px — the docked aside stays mounted and CSS-hidden while the Sheet mounts its own. The hidden
   one is `display:none` and so leaves the accessibility tree, but it is still rendering and still
   running its `ResizeObserver`. Neither the visual nor the touch-target sizes were verified.
3. **The rail panels were absent from the inventory.** `agenda`, `day-tasks-panel` and `focus-panel`
   had no rows. Added in this change, in a section of their own — they are docked columns at `lg`,
   not overlays. `day-tasks-panel` and `focus-panel` remain unreviewed.
4. **The tooling this file's own README describes does not exist.** `scripts/surface-inventory.ts`,
   `surface-inventory.test.ts`, and `scorecard-schema.test.ts` are all named as if they enforce this
   process; none is in the repository. The inventory says so plainly in its own header and the
   README does not. Until they are written, every count here is a claim and no gate is machine-checked.

## What moved, and the number behind each

| Was                                            | Now                                                    |
| ---------------------------------------------- | ------------------------------------------------------ |
| 88px gutter — 34% of a 256px canvas            | 44px — 17%                                             |
| A label every 30 minutes                       | `subHourLabels: 0`, 25 hour labels                     |
| Titles truncated to one line in 96px blocks    | Clamped to a height-derived budget, 3 lines at 96px    |
| Blocks under 24 minutes drew an unlabelled bar | `cardsWithoutText: 0`                                  |
| `Read-only` chip at the title's type size      | A 16px lock, words on `aria-describedby`               |
| No scale control at all                        | `+ / 1x / −`, rail-local persisted density, default 48 |
| Month and year rendered zero times             | `Today · Aug 7`                                        |
| Athena pill floating over the evening hours    | Cleared via `--shell-rail-inline-size`                 |

## Limitations

- The mobile Sheet, as above.
- Loading skeletons were not captured; the local stack resolves too fast to catch without throttling.
  Same limitation round 3 recorded.
- Contrast was not re-measured on the block fill. Nothing in this change touched
  `scheduling-item-surface.ts`, and `apps/web/tests/scheduling/scheduling-item-surface.test.ts`
  re-does that arithmetic against the real tokens on every run.
