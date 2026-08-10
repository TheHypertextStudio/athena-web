---
surfaces: ['markdown-code']
date: 2026-08-10
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

# Design review: Markdown inline code and code blocks — 2026-08-10

**Verdict: SHIP.** Every dimension meets the craft bar and all five gates are green.

## Screenshots and measurements

Root: `docs/design/audits/screenshots/2026-08-10-markdown-code/`.

- `project-code-1440x900-light.png`
- `project-code-1440x900-dark.png`
- `project-code-390x844-light.png`
- `project-code-390x844-dark.png`
- `comment-code-1440x900-light.png`
- `comment-code-1440x900-dark.png`
- `comment-code-390x844-light.png`
- `comment-code-390x844-dark.png`
- `measurements.json` — theme contrast, 320px overflow, internal code overflow, and touch targets

The captures show both the editable project document and a persisted task comment after their
Markdown was written through the real API and parsed by the production surfaces. The long
TypeScript lines are intentional overflow evidence, not placeholder copy: at 320px the editable
source scrolls 685px inside a 262px code viewport and the read-only comment scrolls 701px inside a
235px viewport while the document itself remains exactly 320px wide.

## Scores

| Dimension                 | Score | Evidence                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice | 3     | The block stays in the app's calm MD3 register: one tonal container, one hairline, no developer-tool chrome or ornamental badges. “TypeScript” and “Copy” are direct product language.                                                                                                                                                                      |
| 2. Typographic craft      | 3     | Surrounding prose retains `text-body-medium`; the rail uses the label scale; only source and inline code switch to IBM Plex Mono. The editor keeps a 75ch prose measure while the source preserves exact spacing.                                                                                                                                           |
| 3. Spatial rhythm         | 3     | The 40px rail, 16px source inset, 8px rail inset, and 12px block separation all sit on the 4px grid. Language and copy controls share one baseline at both captured widths.                                                                                                                                                                                 |
| 4. Hierarchy              | 3     | Prose remains primary; the outlined tonal block is one nested step; its slim rail subordinates language and copy actions to the source. The mobile capture preserves that order without moving controls away from their block.                                                                                                                              |
| 5. Color discipline       | 3     | More than 90% of the surface remains neutral. Syntax spends only existing primary, secondary, tertiary, error, and on-surface tokens. Measured keyword contrast is 5.04:1 in light and 7.10:1 in dark.                                                                                                                                                      |
| 6. Motion & feedback      | 3     | Copy gives immediate stable `Copied` or `Retry` text in the reserved 64px action width, so feedback causes no rail shift; the polite live region reports the same result. Keyboard activation was exercised in the evidence run.                                                                                                                            |
| 7. States completeness    | 3     | Editable blocks show a language selector; read-only blocks show the language label; plain and unknown fences stay readable without a grammar request; chunk and clipboard failures degrade to readable source and retry feedback. Component tests cover every state; persisted E2E covers project and comment save, reload, lazy highlight, and exact copy. |
| 8. Detail craft           | 3     | The outline, divider, radius, and insets remain pixel-aligned in all four captures. At 320px, document overflow is zero, both touch targets are 40px, and long source scrolls only inside the code viewport.                                                                                                                                                |

## Gates

| Gate                | Result | Evidence                                                                                                                                                                                              |
| ------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | ✅     | Named native language select and named button; Tab moves from language to copy; Enter activates copy; polite live feedback; 40px targets at 320px; measured syntax contrast clears AA in both themes. |
| Responsive          | ✅     | Desktop and 390px captures are intentional reflows. The 320px probe reports `documentWidth: 320` for a `viewportWidth: 320`; long code remains internally scrollable.                                 |
| Theme parity        | ✅     | Light and dark were captured at 1440×900 and 390×844. Tonal separation and syntax hierarchy remain visible in all four.                                                                               |
| No placeholder      | ✅     | No dead or synthetic product UI was introduced. Plain, unknown, loading-failure, copy-failure, editable, and read-only states all remain functional.                                                  |
| Screenshot-verified | ✅     | Eight standard captures across editable and compact read-only surfaces, plus machine measurements, are stored beside this scorecard.                                                                  |

## Findings

No ship-blocking findings. The mobile project page already clips its long tab row at the right edge,
but the code block remains inside the content column and introduces no additional page overflow; that
pre-existing page-level tab behavior is outside this surface.

Verdict: **SHIP** — all dimensions are at least 3 and every hard gate is green.
