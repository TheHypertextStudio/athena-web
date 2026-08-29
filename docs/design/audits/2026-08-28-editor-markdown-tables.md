---
surfaces: ['composer-shell']
date: 2026-08-28
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

# Design review: Markdown table editing — 2026-08-28

**Verdict: SHIP.** Web maintainers can ship the Markdown table controls in the shared composer
editor. The editor keeps row and column actions next to the active table. It moves copy formats and
destructive actions into one menu. The controls do not reproduce Athena navigation or entity
collections inside the document.

## Screenshots and runtime evidence

The screenshot root is `docs/design/audits/screenshots/2026-08-28-editor-markdown-tables/`.

| State                              | File                      |
| ---------------------------------- | ------------------------- |
| Desktop light, 1440 by 900         | `desktop-light.png`       |
| Desktop dark, 1440 by 900          | `desktop-dark.png`        |
| Mobile light, 390 by 844           | `mobile-light.png`        |
| Mobile dark, 390 by 844            | `mobile-dark.png`         |
| Minimum-width overflow, 320 by 720 | `mobile-320-overflow.png` |

The authenticated local run used the real My Work task composer. The test pasted a tab-separated
four-column table through the browser clipboard event. The editor rendered that data as a Markdown
table and opened the contextual controls from a real cell selection. The capture helper hid only
Next.js development chrome, which the passing production build does not ship.

The browser moved focus into the toolbar with Alt+F10. Escape returned focus to the editor without
opening the composer's discard confirmation. At 320 pixels, the browser proved that the page does
not scroll horizontally. It also proved that the options control remains visible, accepts a pointer,
and exposes Add column after the primary action collapses into the menu. Every visible mobile control
measured at least 40 by 40 pixels.

## Scores

| Dimension                 | Score | Evidence                                                                                                                                           |
| ------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice |     3 | The toolbar uses Docket's neutral app register, shared icons, direct action labels, and existing tonal surfaces.                                   |
| 2. Typographic craft      |     3 | Table headers, cell text, composer title, and control labels preserve the existing MD3 type hierarchy at both captured widths.                     |
| 3. Spatial rhythm         |     3 | The controls use one compact 4-pixel rhythm. The toolbar follows the active row without changing the table's cell padding or the composer's inset. |
| 4. Hierarchy              |     3 | Add row and Add column remain primary on ordinary widths. Copy formats and destructive actions stay subordinate in one options menu.               |
| 5. Color discipline       |     3 | Both themes use semantic surface, outline, text, focus, and primary tokens. The toolbar adds no decorative color.                                  |
| 6. Motion & feedback      |     3 | The shared floating-menu behavior explains which table receives the actions. The 320-pixel capture shows the shared visible keyboard focus ring.   |
| 7. States completeness    |     3 | The review covers two themes, desktop, mobile, minimum width, wide-table overflow, keyboard entry, Escape, and narrow-width disclosure.            |
| 8. Detail craft           |     3 | Borders align across the table. Labels stay on one line. The table scrolls inside its editor while the page and toolbar remain within 320 pixels.  |

## Hard gates

| Gate                | Result | Evidence                                                                                                                                      |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | Pass   | The toolbar and options control have accessible names. Alt+F10 and Escape work. Visible mobile controls measure at least 40 by 40 pixels.     |
| Responsive          | Pass   | The browser reports no page overflow at 320 pixels. It hit-tests the options control after Add column moves into the menu.                    |
| Theme parity        | Pass   | The 1440-pixel and 390-pixel captures preserve the same hierarchy in light and dark themes.                                                   |
| No placeholder      | Pass   | The screenshots use the real local composer and editor. The isolated test account supplies only the task title and pasted table under review. |
| Screenshot-verified | Pass   | Five final captures cover the required theme and width matrix plus the 320-pixel overflow state.                                              |

## Findings

The first mobile capture clipped the options control. The 320-pixel capture then showed that the
control could exist in the DOM while an ancestor hid it. The final design collapses Add column into
the options menu at 350 pixels and below. The browser now hit-tests the options button before it
accepts the responsive gate.

The first keyboard capture also exposed the composer's discard confirmation after toolbar Escape.
The composer now stops Radix dismissal while focus belongs to the table toolbar. The toolbar then
returns focus to the editor as intended.
