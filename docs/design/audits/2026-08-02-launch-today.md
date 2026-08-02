---
surfaces: ['today']
date: 2026-08-02
verdict: needs-work
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 2
  color: 3
  motion: 2
  states: 3
  detail: 2
gates:
  a11y: false
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: /today (launch pass) — 2026-08-02

**Verdict: BELOW BAR.** The A11y gate fails on a measured 1.34:1 text contrast and on 36px controls
at mobile width. Hierarchy, motion, and detail craft are each below the bar.

Reviewed against `docs/design/craft-rubric.md` on the branch's dev stack, signed in as the local
review account. Every number below came out of a probe run against the live surface.

## Screenshots

Root: `docs/design/audits/screenshots/2026-08-02-launch-surfaces/`

| Set               | Files                                                     |
| ----------------- | --------------------------------------------------------- |
| Standard shot set | `today-{1440x900,390x844}-{light,dark}.png`               |
| Keyboard focus    | `focus-today-tab4.png` — fourth tab stop, sidebar "Tasks" |
| 3x detail crops   | `today-ask-athena-row-3x.png`, `today-now-line-3x.png`    |

## Scores

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | The page opens with a time-of-day eyebrow ("Late night") above the date, and the composer's prompt is written in the product's own voice — "What's on your plate?" / "Paste your firehose here — Athena will sort it out…" / "nothing lands until you approve it." That last clause is the import model stated in one line. Domain-neutral throughout; no developer vocabulary leaks.                                                             |
| 2. Typographic craft              | 3     | Measured: the `h1` is 48px, the section headings 22px, body 14–16px — three clear levels. `today-390x844-light.png` keeps the same three levels at 390 with no orphan on "What's on your plate?".                                                                                                                                                                                                                                                 |
| 3. Spatial rhythm & density       | 3     | One rhythm, measured. Inside a `main` box of 760x884 at x=256, content sits at x=296 (a 40px inner inset); the three blocks are at y=64/277/581 with heights 173/265/218, so the gaps between them are 40px and 39px. That is a single spacing vocabulary held across the page.                                                                                                                                                                   |
| 4. Hierarchy & information design | 2     | The frame offers competing destinations for the same work. The sidebar lists **"Stream" twice** — once in the unlabelled personal group and again under "Workspace" — with the same icon and the same word, plus the near-duplicate pairs Today/My Work and Inbox/Triage. Eight of the first tab stops are nav links; a reader cannot tell from the frame which altitude owns their day.                                                          |
| 5. Color discipline               | 3     | Neutral-first in both themes; the accent is spent on the active nav row, the composer's primary action, and the calendar's current-time line. `today-1440x900-dark.png` is re-tinted rather than inverted — the sidebar blends into the canvas while the content panel stays a distinct raised surface, which is the intended MD3 relationship.                                                                                                   |
| 6. Motion & feedback              | 2     | Both composer actions ship **disabled with no explanation**. Measured: the "Ask Athena" button reports `disabled: true` and the "Add task" button likewise, and the text of their containing row is exactly `"Ask Athena⌘↵Add task"` — no adjacent sentence, no tooltip, nothing that says "type something first". The rubric requires a disabled state to explain itself. Keyboard focus rings are present and visible (`focus-today-tab4.png`). |
| 7. States completeness            | 3     | Both empty states teach rather than announce. "Nothing scheduled — You're clear for now. Capture a thought above, or timebox work onto your calendar." names the two next moves, and the agenda rail carries its own "Nothing scheduled. Use the calendar to plan this day." Zero console errors and zero page errors on load.                                                                                                                    |
| 8. Detail craft (squint test)     | 2     | Three separate defects, all captured. See findings 1–3.                                                                                                                                                                                                                                                                                                                                                                                           |

Gates: A11y ❌ (see findings 1 and 4) · Responsive ✅ (document overflow measured at 320/390/1440 =
0/0/0px) · Theme parity ✅ · No placeholder ✅ (no TODO copy, no fake data — the empty states are
genuinely empty, not staged) · Screenshots ✅

## Findings (ordered by severity)

1. **The `⌘↵` hint on the primary action is 1.34:1 against the button it sits on.** Measured
   directly: the `kbd` computes `color: lab(35.0059 -0.209 -3.006)` at `font-size: 10px` on a button
   whose background is `lab(41.7003 22.5097 -73.931)`. Converting both through CIE Lab (D50) to
   linear sRGB and applying the WCAG formula gives **1.34:1**, against a 4.5:1 AA requirement — and
   below even the 3:1 non-text minimum. The button's own label is fine at 5.55:1. `today-ask-athena-row-3x.png`
   shows the result at 3x: the label is crisp and the shortcut is a smudge. This alone fails the
   A11y gate.

2. **The agenda rail's current-time line is occluded by its own empty-state copy.**
   `today-now-line-3x.png` shows the red now-indicator rendering as two disconnected stubs — one at
   the gutter, one at the right edge — with the segment between them washed out behind the
   two-line "Nothing scheduled. Use the calendar to plan this day." block. The one piece of
   real-time information on the rail is the piece that is broken.

3. **Every enabled button on the surface computes `cursor: default`.** Measured: 29 enabled
   controls, of which **11** are not `pointer` — the workspace switcher, the search button, the
   nudge dismiss, the account row, "Open Athena for today", the four agenda controls, the agenda
   collapse, and the floating Athena launcher. Every `<a>` on the same page computes `pointer`, so
   the split is `<button>` vs `<a>`, i.e. one shared primitive rather than eleven mistakes.

4. **Two controls fall under the 40px mobile touch-target floor.** At 390px, "Ask Athena" and
   "Add task" both measure 36px. (The 18px "Skip to content" link is the standard visually-hidden
   skip link and is not counted.)

5. **The floating Athena launcher covers page content at 390px.** Measured with
   `elementsFromPoint` at the launcher's centre: the element underneath is the "Nothing scheduled"
   card. No gutter is reserved for it, so on a phone the launcher sits on top of the surface's
   second content block rather than beside it.

## Not verified in this pass

Hover and active treatments, transition token usage, and `prefers-reduced-motion`. The motion score
rests on the observed focus ring and the observed unexplained disabled states.
