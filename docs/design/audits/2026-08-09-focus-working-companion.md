---
surfaces: ['focus-panel', 'focus-mode']
date: 2026-08-09
verdict: ship
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 4
  color: 3
  motion: 3
  states: 4
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: Focus working companion and immersive mode — 2026-08-09

**Verdict: SHIP.** Every dimension meets the Craft Rubric and every hard gate is green. Focus is
now intentionally sparse rather than unfinished: the active task is dominant, controls remain
close at hand, and Athena accepts an interruption without introducing a conversation into the
working surface.

Revalidated on 2026-08-10 after the independent code-review fixes. The evidence harness now lives
with the critical Playwright journey and recaptures the full matrix from real workspace data.

## Screenshots and machine evidence

Root: `docs/design/audits/screenshots/2026-08-09-focus-working-companion/`.

| Set               | Files                                                           |
| ----------------- | --------------------------------------------------------------- |
| Immersive idle    | `focus-{1440x900,390x844}-{light,dark}.png`                     |
| Immersive active  | `active/focus-{1440x900,390x844}-{light,dark}.png`              |
| Working companion | `rail/rail-{1440x900,390x844}-{light,dark}.png`                 |
| Narrow overflow   | `active/focus-320x844-light.png`, `rail/rail-320x844-light.png` |

The authenticated browser probe used a real Personal workspace, created a real anchored timer,
opened the rail through both the desktop activity bar and mobile panel sheet, and measured:

```text
immersive 320px document overflow: 0
mobile rail 320px document overflow: 0
mobile rail sheet overflow: 0
Focus interactive targets below 40px: 0
keyboard order: return → dominant task → timer task → rename → pause → finish → handoff
```

## Scores

| Dimension                 | Score | Evidence                                                                                                                                                                                                                             |
| ------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity & voice |     3 | Plex typography, restrained MD3 surfaces, application-owned receipts, and direct verbs keep the Docket register. Athena is an action handoff, not a chat-shaped detour.                                                              |
| 2. Typographic craft      |     3 | The immersive title uses the display scale and balances at both widths; metadata, clock, receipts, and Today totals descend through shared tokens with tabular numerals where values change.                                         |
| 3. Spatial rhythm         |     3 | The rail uses a compact 12/16px rhythm while immersive mode opens into a deliberate two-column composition. Mobile reflows to one column with a single divider and full-size controls.                                               |
| 4. Hierarchy              |     4 | The task is the unequivocal subject: dominant linked title and context on the main side, with timer, interruption handoff, and recent work in a supporting column. The rail ends purposefully at its Focus-mode action.              |
| 5. Colour discipline      |     3 | Colour is limited to semantic surface elevation, the running-state dot, primary focus indicators, and existing state roles. Light and dark retain the same hierarchy without decorative hue.                                         |
| 6. Motion & feedback      |     3 | Timer transitions retain the existing immediate state feedback; the handoff moves through one live receipt. No new decorative motion was introduced, and the reduced-motion probe remained fully usable.                             |
| 7. States completeness    |     4 | Running, paused, unanchored, anchored, loading, error, empty-day, long-title, handoff lifecycle, and idle-after-finish states are designed. Missing descriptions/subtasks collapse honestly instead of producing filler.             |
| 8. Detail craft           |     3 | Linked titles and every control have visible keyboard focus; interactive targets reach 40px in immersive mobile mode; long titles truncate in the compact card and wrap in the dominant view; all 320px probes report zero overflow. |

## Gates

| Gate                | Result | Evidence                                                                                                                                                                                                       |
| ------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | ✅     | Semantic main/header/section/aside landmarks, named controls, keyboard traversal, visible focus indicators, and no Focus target below 40px. Shared semantic colour roles preserve the app's AA token contract. |
| Responsive          | ✅     | Immersive mode reflows at `md`; the shell presents the rail in its mobile Sheet. Document and Sheet overflow are both zero at 320px.                                                                           |
| Theme parity        | ✅     | Rail and immersive, idle and active, were captured in light and dark at the standard desktop and mobile widths.                                                                                                |
| No placeholder      | ✅     | The browser probe used real workspace, task, workflow, timer, and time-ledger data. Absent description, subtasks, and recent sessions render as absence rather than fabricated examples.                       |
| Screenshot-verified | ✅     | All surface, state, width, and theme claims above have committed captures under the audit root.                                                                                                                |

## Findings resolved during review

1. Shared controls initially inherited 28–32px compact targets. Focus now keeps compact typography
   while every rail and immersive action has a measured target of at least 40px.
2. Task links depended on the generic ring treatment. Both the dominant title and compact timer
   title now use an explicit outline that remains visible over light and dark surfaces.
3. The mobile entry path was verified through the shell's existing supplemental-panel Sheet:
   `Show Agenda` → `Focus` → `Open focus mode`. The launcher selects same-tab navigation at that
   breakpoint, as specified.

## Limitations

- Loading skeletons were inspected in component tests but resolve too quickly in the local stack
  for a stable browser capture.
- The seeded task deliberately had no description or subtasks. Their expanded rendering and
  progress semantics are covered by component data and focused tests rather than fake screenshot
  content.
