# Design review: Athena conversation — 2026-09-28

The reader is the Athena maintainer. Keep the conversation primary when changing its navigation or approval states.

Screenshots: [desktop light](evidence/athena-1440x900-light.png), [desktop dark](evidence/athena-1440x900-dark.png), [phone light](evidence/athena-390x844-light.png), [phone dark](evidence/athena-390x844-dark.png), and [320px dark](evidence/athena-320x844-dark.png). These show a saved starting point and a proposal whose target task returns 404.

| Dimension                        | Score | Evidence                                                                                                                                                                                                |
| -------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice         | 3     | The conversation uses the app's Plex and neutral surfaces. The saved place is named `Launch review`; no internal grouping term appears.                                                                 |
| Typographic craft                | 3     | The message body leads. The saved name and decision text use smaller type with distinct weights in all four standard shots.                                                                             |
| Spatial rhythm and density       | 3     | The card aligns with the conversation inset at 390px and 1440px. The sparse conversation keeps the composer anchored without filling space with a generated index.                                      |
| Hierarchy and information design | 3     | `Jump to` is a small secondary control. The proposal states the intended move, explains why it cannot apply, and offers Dismiss in one surface. Search stays in the app's existing search control.      |
| Color discipline                 | 3     | The card uses a neutral tint in both themes. Dismiss is a neutral text button because no valid action remains to approve.                                                                               |
| Motion and feedback              | 3     | Selecting a saved place reveals older messages and scrolls the target into view. The scroll uses reduced-motion preference, and the pending reply keeps an accessible status without visible narration. |
| States completeness              | 3     | The captured 404 state names the intended move, blocks approval, and offers Dismiss. The 320px capture has no horizontal overflow.                                                                      |
| Detail craft                     | 3     | The message, marker, and card retain separate alignment at 320px. The target text wraps inside the card without clipping.                                                                               |

Gates: A11y pass · Responsive pass · Theme parity pass · No placeholder pass · Screenshot verified pass. A mobile browser check measured 40px touch targets for Jump to and the decision controls, and Tab reached a decision button. The shared button primitive supplies visible focus treatment. The captured 320px state had no horizontal overflow.

The generated proposal in this local session points to a task ID that the API returns as 404. The review card therefore cannot show a verified task title. It shows the proposed status move and lets the person dismiss the stale suggestion. This is the observed state, not demo copy. A readable target instead shows its linked task name above the proposed move.

Verdict: SHIP.
