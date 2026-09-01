---
surfaces: ['orgs-[orgId]-initiatives']
date: 2026-09-01
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

# Design review: Shared work roster correctness — 2026-09-01

This review covers the Initiative roster as the representative rendered surface for the shared
`EntityTable` implementation. The production-build acceptance test also runs the Task, Project,
Program, Team, and Cycle adapters against the same responsive and interaction contracts.

Screenshots:

- `screenshots/2026-08-28-work-roster/initiatives-desktop-light.png` — 1440×900, light
- `screenshots/2026-08-28-work-roster/initiatives-desktop-dark.png` — 1440×900, dark
- `screenshots/2026-08-28-work-roster/initiatives-medium-light.png` — 1016×1724, light
- `screenshots/2026-08-28-work-roster/initiatives-medium-dark.png` — 1016×1724, dark
- `screenshots/2026-08-28-work-roster/initiatives-mobile-light.png` — 390×844, light
- `screenshots/2026-08-28-work-roster/initiatives-mobile-dark.png` — 390×844, dark

Register: app — calm, dense, keyboard-first Plex/MD3. The capture suite seeds an isolated local
release database through product APIs. The fixture contains two roots, five hierarchy depths, long
titles, duplicate ancestor context, and 101 direct rows. It is test evidence and not production
content.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                            |
| --------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         |     3 | The roster keeps Docket's Plex typography, MD3 surfaces, sentence-case controls, and semantic status treatment. It does not add a decorative divider or a second visual language.                                                   |
| 2. Typographic craft              |     3 | The page title, saved views, column labels, group headings, row titles, and metadata form a stable hierarchy. Long titles remain readable at 1016px and truncate only when the viewport requires it.                                |
| 3. Spatial rhythm & density       |     3 | The page gives the toolbar external space from the title and roster. Compact rows measure 44px, comfortable rows measure 56px, and hierarchy elbows remain centered on the resolved row height.                                     |
| 4. Hierarchy & information design |     3 | One New Initiative action leads the page. Saved views and display controls remain subordinate. Status groups, ancestor context, and hierarchy rails distinguish direct work from orientation context.                               |
| 5. Color discipline               |     3 | Neutral containers carry structure in both themes. Status color conveys state. The roster does not use color as decoration or as the only carrier of hierarchy.                                                                     |
| 6. Motion & feedback              |     3 | Shared focus, hover, selection, drag, load-more, retry, and mutation feedback remain available. Theme captures wait for the shared transition to settle, so the evidence records stable end states.                                 |
| 7. States completeness            |     3 | The production-build journey covers 101-row continuation, a forced 503, targeted retry, preserved loaded rows, create, rename, reparent, foreign references, direct selection, and the viewer capability boundary.                  |
| 8. Detail craft                   |     3 | Header and body cells align within one CSS pixel through `data-col`. Root labels share the title axis, each Initiative depth advances 24px, sticky headers hold under scroll, and the 320px one-column roster has no page overflow. |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

- **A11y**: The browser journey uses arrow navigation, Enter activation, selection, and the
  single-row action menu. Viewer and foreign-reference rows expose only permitted controls.
- **Responsive**: The gate exercises 1440, 1016, 768, 390, and 320 pixel widths. It also checks the
  Initiative roster with the sidebar expanded and collapsed and in both density modes.
- **Theme parity**: The same hierarchy, spacing, and semantic color relationships remain visible in
  all three captured widths in light and dark.
- **No placeholder**: The evidence runner creates a disposable PostgreSQL database and seeds the
  fixture through the application API. It does not modify a production workspace.
- **Screenshot-verified**: The six production-build captures listed above are the final evidence
  set. The geometry assertions remain the release gate because screenshots are review evidence.

## Findings resolved

1. A divider below the roster header added a non-MD3 rule across the page. The shared table header
   no longer draws it.
2. The top controls sat against the title and roster. The list-page toolbar now owns external block
   margins at every width.
3. Disabled drag references could add `aria-disabled` to readable foreign-owned rows. `WorkList`
   now attaches drag and drop references only when the corresponding interaction is available.
4. A single foreign-reference action used the generic Copy label. It now says Copy link, while the
   full-scope copy action keeps the shorter Copy label.

Verdict: **SHIP** — every dimension meets the craft bar and all five hard gates are green.
