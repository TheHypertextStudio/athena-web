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
editor. The control rail aligns with the active table's visible perimeter. It uses distinct row and
column icons, uses the shared level-two elevation to separate itself from the editor, keeps copy
formats and destructive actions in one menu, and adds no Athena navigation or entity collections to
document content.

## Screenshots and runtime evidence

The screenshot root is `docs/design/audits/screenshots/2026-08-28-editor-markdown-tables/`.

| State                              | File                      |
| ---------------------------------- | ------------------------- |
| Desktop light, 1440 by 900         | `desktop-light.png`       |
| Desktop dark, 1440 by 900          | `desktop-dark.png`        |
| Mobile light, 390 by 844           | `mobile-light.png`        |
| Mobile dark, 390 by 844            | `mobile-dark.png`         |
| Minimum-width overflow, 320 by 720 | `mobile-320-overflow.png` |

The authenticated isolated run used the real My Work task composer. The test typed an introductory
paragraph and then pasted a tab-separated four-column table through the browser clipboard event. The
editor rendered that data as a Markdown table and opened the contextual controls from a real cell
selection. A dedicated rail host mounted under the composer dialog but outside the editor scroller.
Browser geometry proved that the rail's left edge matches the table, its bottom stays 8 pixels above
the table, it clears both the task title and preceding paragraph, and the table keeps at least 11
pixels below it inside the editor surface.

The browser moved focus into the toolbar with Alt+F10. Escape returned focus to the editor without
opening the composer's discard confirmation. At 320 pixels, the browser proved that the page does
not scroll horizontally. It also proved that the options control remains visible, accepts a pointer,
and exposes Add column inside the dialog after the primary action collapses into the menu. Every
visible mobile control measured at least 40 by 40 pixels. The options menu used the dialog as its
collision boundary. The browser scrolled its last Delete table action into view and proved that the
action accepts a pointer without leaving the modal.

## Scores

| Dimension                 | Score | Evidence                                                                                                                                         |
| ------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity & voice |     3 | The rail uses Docket's neutral app register, direct action labels, specific row and column icons, existing tonal surfaces, and shared elevation. |
| 2. Typographic craft      |     3 | Table headers, cell text, composer title, and control labels preserve the existing MD3 type hierarchy at both captured widths.                   |
| 3. Spatial rhythm         |     3 | The rail follows the table perimeter with an 8-pixel gap. A 56-pixel desktop and 64-pixel compact reservation clears preceding text.             |
| 4. Hierarchy              |     3 | Add row and Add column remain primary on ordinary widths. Copy formats and destructive actions stay subordinate in one options menu.             |
| 5. Color discipline       |     3 | Both themes use semantic surface, outline, text, focus, and primary tokens. The toolbar adds no decorative color.                                |
| 6. Motion & feedback      |     3 | The contextual rail appears at the active table. The 320-pixel capture shows the shared keyboard focus ring on the options control.              |
| 7. States completeness    |     3 | The review covers two themes, desktop, mobile, minimum width, wide-table overflow, keyboard entry, Escape, pointer input, and disclosure.        |
| 8. Detail craft           |     3 | The rail and table share a left edge. Level-two elevation keeps the rail distinct. The table has a 4-pixel radius with square cells.             |

## Hard gates

| Gate                | Result | Evidence                                                                                                                                     |
| ------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | Pass   | The toolbar and options control have accessible names. Alt+F10 and Escape work. The modal keeps focus, and mobile targets are at least 40px. |
| Responsive          | Pass   | The browser reports no page overflow at 320 pixels. It hit-tests the options control and the last scrollable menu action.                    |
| Theme parity        | Pass   | The 1440-pixel and 390-pixel captures preserve the same hierarchy in light and dark themes.                                                  |
| No placeholder      | Pass   | The screenshots use the real local composer and editor. The journey types its task title and intro, then pastes the table under review.      |
| Screenshot-verified | Pass   | Five final captures cover the required theme and width matrix plus the 320-pixel overflow state.                                             |

## Findings

The first audit found that the editor scroller clipped the rail and that selection-caret geometry did
not align it with the table. The final rail anchors to `.tableWrapper`. Each editor creates a
dedicated host under its nearest dialog or the document body. That host lets the rail escape the
scrollport while keeping Tiptap's focus ownership limited to the rail and its menu. Moving focus to a
sibling control hides the rail and removes the table's active spacing.

The first corrected capture showed the rail covering the task title. A later paragraph-first fixture
showed that a 32-pixel margin also let the rail overlap preceding prose. The active table now reserves
56 pixels on ordinary widths and 64 pixels on compact widths. Table-cell paragraphs drop the general
document paragraph margins, which keeps rows compact enough to preserve the editor's bottom inset.
The rail listens to the nearest computed scroll owner, so entity pages and composers update its
position from their own scroll containers.

The 320-pixel state keeps Add row visible and moves Add column into the options menu. The browser
hit-tests the options button and the final Delete table action after menu scrolling. The dialog acts
as the menu's collision boundary, and the page stays within the 320-pixel viewport. The table uses a
4-pixel outer radius while every cell remains square. The rail uses the shared level-two floating
surface shadow, so its border and tonal fill do not blend into the editor in either theme.
