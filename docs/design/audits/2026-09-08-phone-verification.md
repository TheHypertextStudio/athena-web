# Design review: Phone verification — 2026-09-08

This scorecard is for the maintainer who ships phone verification. The maintainer can ship the
canary UI without another craft pass. Public access must remain disabled until the Twilio account
leaves trial status and a public-launch canary passes.

The base screenshot directory is
`apps/web/.data/design-review/2026-09-08-phone-verification/`. It contains 1440×900, 390×844,
390×600, and 320×844 captures in light and dark. The
`2026-09-08-phone-verification-exhausted/` directory contains the same set for a terminal
challenge. The repository capture tool reported no horizontal page overflow at 320 pixels.

| Dimension                           | Score | Evidence                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity and voice         |     3 | The captures keep phone verification inside the existing Athena settings section. The copy uses product terms such as “Send me a code,” “Try a new code,” and “Verified.” It does not expose Twilio names, provider statuses, or exception text.                                                                                                                 |
| 2. Typographic craft                |     3 | The desktop and phone captures keep the shared settings title, section title, field labels, phone summary, badge, actions, and feedback at distinct token-backed levels. The 320-pixel capture retains every label without clipping.                                                                                                                             |
| 3. Spatial rhythm and density       |     3 | The desktop form keeps the country and phone controls on one compact row. The phone layout gives the form and each number one contained row. The exhausted 320-pixel capture keeps the masked number, badge, primary recovery action, and overflow menu inside the section bounds.                                                                               |
| 4. Hierarchy and information design |     3 | An empty account has one primary action. An active or recoverable challenge replaces the form with its masked destination and one valid next action. Secondary actions move into the overflow menu at narrow widths.                                                                                                                                             |
| 5. Color discipline                 |     3 | Light and dark captures preserve the same surface tiers. Blue marks the primary send action. Red appears only for rejected or terminal challenge feedback. Neutral badges identify state without competing with the next action.                                                                                                                                 |
| 6. Motion and feedback              |     3 | The component test verifies that the code field receives focus after the server accepts a send. It also verifies that pending mutations disable their controls, feedback clears before each action, and the expiry timer advances without a reload. The production-shaped browser journey completed the wrong-code and success feedback sequence in 4.4 seconds. |
| 7. States completeness              |     3 | The captures cover the empty form and an exhausted challenge. Twenty-nine component cases cover unavailable, sending, awaiting-code, unknown-delivery, failed, expired, exhausted, wrong-code, offline, reload, focus, timer, and narrow-width behavior. The production-shaped browser journey verifies persistence after reload.                                |
| 8. Detail craft                     |     3 | The controls use shared inputs, buttons, badges, and menus. Phone numbers remain masked in the row and in feedback. The 320-pixel capture shows no wrapped action row or clipped overflow trigger. The code field uses one-time-code input semantics.                                                                                                            |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

## Findings

The review found no canary UI blocker. The documented development-session helper failed before it
could create a fresh capture account. It waited 60 seconds for the sign-up name field. The
production-shaped release harness created its own account and passed the complete phone journey,
so the auth-helper failure does not invalidate the phone flow. It remains a separate local tooling
defect.

Verdict: SHIP for the private canary.
