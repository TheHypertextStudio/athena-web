# Design review: Task hierarchy — 2026-08-15

This review gives Athena maintainers the ship decision for task hierarchy interactions. Maintainers
should reject later changes that hide hierarchy, merge hierarchy with dependencies, remove the
keyboard path, or let task cards overflow the mobile canvas.

Screenshots:

- `evidence/2026-08-15-task-graph-desktop-light.png` — 1440×900, light
- `evidence/2026-08-15-task-graph-desktop-dark.png` — 1440×900, dark
- `evidence/2026-08-15-task-graph-mobile-light.png` — 390×844, light
- `evidence/2026-08-15-task-graph-mobile-dark.png` — 390×844, dark
- `evidence/2026-08-15-task-hierarchy-picker.png` — searchable parent picker
- `evidence/2026-08-15-task-graph-drag-preview.png` — accepted target and projected child position

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                        |
| --------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         |     3 | The app uses the calm, neutral Docket register. “Choose a parent task…” and “Move task here” name the operation without exposing graph or storage terms.                                                                                                        |
| 2. Typographic craft              |     3 | The page title, toolbar labels, task titles, state label, and supporting team name form a clear four-level scale. Titles and counts remain on one line at 390px.                                                                                                |
| 3. Spatial rhythm & density       |     3 | The 48px child indent, 16px branch gap, aligned card edges, and compact toolbar produce one readable rhythm. The 390px cards use the available width without touching the viewport edge.                                                                        |
| 4. Hierarchy & information design |     3 | Neutral curved rails and indentation show parentage. The blue arrow remains a separate dependency. The picker excludes the moving task and presents only valid parents. The drag preview shows the exact future child position before commit.                   |
| 5. Color discipline               |     3 | Neutral surfaces carry structure. Blue appears only for selection, dependency direction, blocked state, and accepted drop feedback. Dark mode preserves the card, rail, edge, and canvas hierarchy.                                                             |
| 6. Motion & feedback              |     3 | The dragged origin fades, the target receives a blue inset ring, and the projected child ghost appears within the target branch. The mutation updates at drop and exposes an atomic Undo. A polite live region announces valid and invalid targets.             |
| 7. States completeness            |     3 | The evidence covers the picker, selected card, accepted drop, projected result, committed hierarchy, and Undo path. Unit coverage also pins loading, application-owned error copy, invalid targets, no-op targets, native list drops, and subtree preservation. |
| 8. Detail craft                   |     3 | Rails meet card centers, handles remain outside the card fill, and the dependency arrow stays distinguishable where it crosses the hierarchy. The live 320px check reports no horizontal document overflow.                                                     |

Gates: A11y PASS · Responsive PASS · Theme parity PASS · No placeholder PASS · Screenshot-verified PASS

The keyboard alternative uses Shift+F10 or the Menu key to open the same task action. The picker
uses searchable listbox semantics and restores focus when it closes. Graph selection uses the
shared keyboard selection model. Mobile controls remain at least 40px tall. The browser test also
verified that reparenting does not alter the existing dependency.

## Findings

No blocking findings remain. When a parent also blocks its own child, the blue dependency edge and
neutral hierarchy rail occupy the same small region near the child card. The arrow color and width
keep the meanings distinct in all four screenshots. A future edge-routing pass could offset that
case if denser real graphs show repeated collisions.

Verdict: SHIP. Every dimension meets the score of 3, and every hard gate passes.
