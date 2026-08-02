---
surfaces: ['search']
date: 2026-08-02
verdict: needs-work
scores:
  brand: 2
  typography: 3
  spacing: 3
  hierarchy: 2
  color: 3
  motion: 3
  states: 3
  detail: 2
gates:
  a11y: false
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: /search (launch pass) — 2026-08-02

**Verdict: BELOW BAR.** The A11y gate fails on five controls under the mobile touch-target floor,
and the surface ships two unstyled native date inputs that render `mm/dd/yyyy` inside an otherwise
fully tokenised MD3 surface.

This is the first Craft Rubric review this surface has ever had — before this pass `/search` was one
of the rows in `docs/design/surface-inventory.md` with no scorecard at all.

## Screenshots

Root: `docs/design/audits/screenshots/2026-08-02-launch-surfaces/`

| Set               | Files                                        |
| ----------------- | -------------------------------------------- |
| Standard shot set | `search-{1440x900,390x844}-{light,dark}.png` |

## Scores

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 2     | The copy is right — "Find work, people, updates, and activity", scoped "All workspaces", and a Family/Window vocabulary that reads as authored. The controls contradict it: measured, the surface renders **2 raw `input[type="date"]`** elements, and `search-1440x900-dark.png` shows them as `mm/dd/yyyy` with the browser's own calendar glyph. A US-locale placeholder string and an OS date picker are exactly the developer-tool tell the rubric names under "Never". |
| 2. Typographic craft              | 3     | Measured: `h1` at 22px over a 14px scope line; group labels ("Family", "Window") and field labels ("From", "To") sit a level below at 14/12px. Three levels, no ad hoc sizes, nothing wrapping badly at 390.                                                                                                                                                                                                                                                                 |
| 3. Spatial rhythm & density       | 3     | The densest of the five app surfaces reviewed, and deliberately so. Measured inside `main` (760x884 at x=256): content insets to x=280, the header block is y=32 h=110, the body y=162 h=706, leaving only 24px of trailing space. The page fills its panel instead of trailing off, unlike `/portfolio` and `/inbox`.                                                                                                                                                       |
| 4. Hierarchy & information design | 2     | The query field correctly leads and results follow, but the shared sidebar lists "Stream" twice (personal and Workspace groups, same word and icon) alongside Today/My Work and Inbox/Triage — and this surface itself is one of two search destinations in the nav, the other being the shell's search button. The frame competes with the page.                                                                                                                            |
| 5. Color discipline               | 3     | Neutral-first; the accent appears only on the active nav row and the recovery-codes nudge. `search-1440x900-dark.png` re-tints the family chips and both cards so the hierarchy survives in dark.                                                                                                                                                                                                                                                                            |
| 6. Motion & feedback              | 3     | Keyboard `Tab` paints a visible focus ring at each stop reached. The surface is as-you-type rather than submit-driven, which is the right feedback model here and is stated on the surface.                                                                                                                                                                                                                                                                                  |
| 7. States completeness            | 3     | The pre-query state teaches correctly: "Search — Results appear as you type." tells the reader what will happen and why the panel is currently blank. Unlike `/portfolio` and `/inbox`, the absent action is right — the action is the field above, already focused-adjacent and unmissable.                                                                                                                                                                                 |
| 8. Detail craft (squint test)     | 2     | Two defects. The native date inputs break control consistency across the surface (every other control is a tokenised component). And measured: 32 visible controls, all enabled, of which **14** compute `cursor: default`, including all four Family chips.                                                                                                                                                                                                                 |

Gates: A11y ❌ (five controls under the 40px mobile floor — see finding 2) · Responsive ✅ (document
overflow at 320/390/1440 = 0/0/0px) · Theme parity ✅ · No placeholder ✅ (no TODO copy, no dead
control) · Screenshots ✅

## Findings (ordered by severity)

1. **Two unstyled native date inputs.** Measured: `document.querySelectorAll('input[type="date"]').length`
   returns `2`. `search-1440x900-dark.png` shows both rendering the browser's `mm/dd/yyyy` placeholder
   and its own picker glyph, which in dark mode is a dark icon on a dark field. Every other control
   on the surface is a Docket component. This is one of very few places in the app where the reader
   sees the browser instead of the product.

2. **Five controls fall under the 40px mobile touch-target floor.** Measured at 390px: the query
   input (36px), the four Family chips Work / People / Content / Activity (36px each), and the two
   date inputs (36px each). The rubric's A11y gate sets the floor at 40px on mobile. (The 18px
   "Skip to content" link is the standard visually-hidden skip link and is not counted.)

3. **Fourteen enabled buttons compute `cursor: default`,** including all four Family chips. Same
   shared Button primitive as the other four surfaces in this pass.

4. **The floating Athena launcher covers the results card at 390px**, with no reserved gutter.

## Not verified in this pass

Result rendering. Every capture is of the pre-query state, so nothing here scores result rows,
grouping, ranking, keyboard traversal of results, or the no-matches state.
