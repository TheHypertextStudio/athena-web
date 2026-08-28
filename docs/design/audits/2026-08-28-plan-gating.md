---
surfaces: ['connections-plan-gating']
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

# Design review: Connections plan gating — 2026-08-28

**Verdict: SHIP.** A free workspace now sees the paid Connections capability in the Settings
content region. Docket does not add a second dialog, backdrop, focus scope, or navigation change.
The same product boundary renders for Import with copy that describes one-time migration.

## Screenshot evidence

The authenticated screenshots use a disposable free workspace in the dedicated Hypertext Studio
Chrome profile. They live in
`docs/design/audits/screenshots/2026-08-28-plan-gating/`:

- `connections-light-1440x900.jpg`
- `connections-dark-1440x900.jpg`
- `connections-light-390x844.jpg`
- `connections-dark-390x844.jpg`

## Scores

| Dimension                 | Score | Evidence                                                                                                                                                |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice | 3     | The copy names live connections and supported work types. It also states that the current workspace remains available instead of using upgrade jargon.  |
| 2. Typographic craft      | 3     | The page heading, feature-card title, body copy, and action use the existing Material type tokens at both widths.                                       |
| 3. Spatial rhythm         | 3     | The card uses the Settings column edge, a 20 px inset, and one 12 px internal rhythm. Mobile preserves the same order without compressed text.          |
| 4. Hierarchy              | 3     | Connections stays the page subject. The paid capability appears as one subordinate card with one action instead of interrupting the entire app.         |
| 5. Color discipline       | 3     | Neutral container and outline tokens carry the card. Blue is reserved for the billing action, and both themes preserve the same depth order.            |
| 6. Motion & feedback      | 3     | The state resolves in place through the existing query shell. It adds no modal entrance, focus theft, redirect, or blocking animation.                  |
| 7. States completeness    | 3     | The paid boundary teaches what the feature does and where to review it. It replaces both the indefinite skeleton and the generic failed-read treatment. |
| 8. Detail craft           | 3     | The action row does not wrap, prose stays within the card, and the 390 px captures show no clipped text or horizontal scroll.                           |

## Hard gates

| Gate                | Result | Evidence                                                                                                                           |
| ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | Pass   | The notice uses a heading and a semantic link. Three Tab presses reach View Docket Pro, which displays the shared 2 px focus ring. |
| Responsive          | Pass   | The 390×844 captures show intentional single-column reflow. At 320 px, `scrollWidth` equals `innerWidth` at 320 px.                |
| Theme parity        | Pass   | The same authenticated state was captured at both widths in light and dark themes.                                                 |
| No placeholder      | Pass   | The card describes the real Docket Pro capability and links to the workspace Billing section.                                      |
| Screenshot-verified | Pass   | All visual findings cite the four Hypertext Studio Chrome captures above.                                                          |

## Findings

No ship-blocking findings remain. The surrounding Settings surface is still a dialog by product
design. The paid feature state does not create a nested dialog or another backdrop.
