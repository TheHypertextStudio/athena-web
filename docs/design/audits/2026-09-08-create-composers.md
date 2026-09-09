---
surfaces: ['create-task', 'create-project', 'create-initiative', 'create-program', 'create-team']
date: 2026-09-08
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

# Design review: create composers — 2026-09-08

This scorecard is for maintainers who decide whether the shared create-composer treatment can
ship. The five composers with product entry points pass the Docket Craft Rubric. Cycle creation
has no product entry point, so the component suite covers its shared-shell behavior and its date
copy. Phone-sized composers use the full dynamic viewport instead of shrinking the desktop panel.
This review does not claim a browser screenshot for a route that does not exist.

Screenshots: `screenshots/2026-09-08-create-composers/` contains 30 captures. Task, Project,
Initiative, Program, and Team each have 1440×900 and 390×844 captures in light and dark themes.
Each composer also has a touch-emulated 390×844 light capture. Initiative has compact and expanded
captures at both widths and in both themes. Task has a 320×844 light capture for the minimum-width
overflow probe.

| Dimension                 | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice | 3     | The dialogs use the calm Plex and neutral MD3 app register. The workspace and owner breadcrumb preserves Docket's work hierarchy. Empty property labels now say `No owner`, `No target`, and `No health` instead of mixing commands with state.                                                                                                                                                                                                                                           |
| 2. Typographic craft      | 3     | The title uses `text-headline-small`, the summary uses `text-body-large`, and controls retain the label tokens from the shared control scale. The desktop and mobile captures show the title, summary, editor prompt, properties, and actions as five distinct levels without an arbitrary type size.                                                                                                                                                                                     |
| 3. Spatial rhythm         | 3     | At 390×844 and 320×844, the shell fills the dynamic viewport and gives the editor the remaining height between its fixed header and footer. Dialog regions use the shared responsive inset contract: 16px inline and 12px block minimums on phones, expanded by the device safe area, then 24px inline and 16px block insets on desktop. The centered desktop shell retains its 42rem compact and 64rem expanded measures plus its 60dvh/36rem and 80dvh/48rem height rules.              |
| 4. Hierarchy              | 3     | The five-second path is title, optional summary, description, properties, then create. Metadata has its own first footer row. `Create more` and the primary submit occupy the second row. The primary submit stays at the right edge, and its disabled state no longer uses the active primary fill.                                                                                                                                                                                      |
| 5. Color discipline       | 3     | Every visible color comes from semantic surface, text, state, and primary tokens. Light and dark captures preserve the same tonal order: dialog, inset editor, property chips, then action chrome. No component adds a hardcoded color.                                                                                                                                                                                                                                                   |
| 6. Motion & feedback      | 3     | The Radix dialog retains its shared open, close, focus, and reduced-motion behavior. Desktop expand and collapse use separate Maximize and Minimize glyphs and keep the same editor node mounted. Phones hide that redundant control because their composer is already full-screen. The browser check confirms that editor scrolling does not move the title or footer.                                                                                                                   |
| 7. States completeness    | 3     | The captures cover the initial empty state, disabled submission, compact metadata overflow, expanded editing, both themes, and minimum-width layout. The template action appears below the description hint where templates are enabled. Pickers use explicit nullable-state copy.                                                                                                                                                                                                        |
| 8. Detail craft           | 3     | The shared close and expand controls use the same 28px desktop geometry and separate 40px coarse-pointer squares with a 4px gap. The responsive header reserves only the close column on phones and both columns once the expand action appears. Safe-area offsets protect the close control and footer. The 320px probe reports exact viewport geometry and no page overflow. The editor owns vertical scrolling and contains wheel overscroll, while the title and footer remain fixed. |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Findings

1. **Cycle creation has no product entry point.** The shared shell and `No start date` / `No end
date` copy pass component tests, but no person can open that composer through the current app.
   The browser matrix must add Cycle when the product adds its trigger. Adding a hidden or test-only
   production route would create fake product behavior, so this change does not do that.
2. **The first production browser pass exposed scroll chaining.** The editor had overflowing
   content but computed `overscroll-behavior-y: auto`. The editor surface now owns
   `overflow-y-auto overscroll-contain`, and the rerun confirms that wheel input cannot move the
   dialog or page at either scroll boundary.
3. **The 390px metadata rows need an overflow menu.** The mobile captures show two high-value
   properties and the shared ellipsis instead of wrapping chips into the action row. The full set
   remains reachable through that menu. This is deliberate progressive disclosure, not clipped
   content.
4. **A viewport-only mobile run missed coarse-pointer defects.** The first review found overlapping
   40px header targets and a metadata fitter that still budgeted a 28px ellipsis. A production
   `hasTouch: true` run now checks all five composers. It confirms that the targets do not overlap,
   each visible metadata control stays inside the inline lane, and the overflow target receives the
   full 40px width. Task recurrence now uses the measured metadata contract instead of bypassing it.
5. **The first mobile treatment remained a shrunken desktop dialog.** At 390×844, the centered
   60dvh panel measured only 506px tall and left 338px of dead scrim around a 212px editor. The
   composer now uses the shared responsive-fullscreen dialog presentation, fills `100dvh` below the
   `sm` breakpoint, and keeps the approved centered sizes above it. The refreshed light, dark, touch,
   and 320px captures verify that the editor receives the recovered height.

Verdict: **SHIP** — every dimension meets the score of 3, and all five hard gates pass for every
create composer with a product entry point.
