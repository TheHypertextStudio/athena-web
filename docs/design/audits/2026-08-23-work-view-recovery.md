# Design review: Work-view recovery — 2026-08-23

This review covers the shared failed-load state used by Tasks, Projects, Programs, and Initiatives.
The reviewer must decide whether this state can replace the bare error sentence that shipped on
Projects.

Screenshots: `screenshots/2026-08-23-work-view-recovery/` at 1440×900 and 390×844 in light and dark.

| Dimension                           | Score | Evidence                                                                                                                                                     |
| ----------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity and voice         |     3 | The app keeps its calm MD3 register. The copy names the failed resource and tells the person that Docket preserved the view settings.                        |
| 2. Typographic craft                |     3 | The title, explanation, and button form three clear levels with canonical body and label tokens. The explanation wraps to two balanced lines at both widths. |
| 3. Spatial rhythm and density       |     3 | The 48px icon disc, 12px internal gaps, and centered content use the shared `EmptyState` rhythm. The roster frame remains aligned with the toolbar above it. |
| 4. Hierarchy and information design |     3 | Retry is the only action inside the failed roster. Existing page controls remain available without competing inside the recovery message.                    |
| 5. Color discipline                 |     3 | The state uses semantic surface, outline, text, and primary tokens. Light and dark screenshots show the same hierarchy without added warning color.          |
| 6. Motion and feedback              |     3 | Retry uses the shared button focus and disabled states. The label changes to `Trying again` while the controller refetches.                                  |
| 7. States completeness              |     3 | The state says what failed, says what Docket preserved, and offers a working retry. The browser test proves that Retry sends a second query.                 |
| 8. Detail craft                     |     3 | The icon, text, and action stay optically centered. The 390px checks and a separate 320px width assertion show no horizontal overflow.                       |

Gates: A11y PASS · Responsive PASS · Theme parity PASS · No placeholder PASS · Screenshot-verified PASS

The browser test focused Retry by keyboard and observed the focus state. It also checked the
document width against the viewport and sent a second request through the controller. The shared
button supplies a 40px minimum mobile target and the recovery wrapper uses `role="alert"`.

Verdict: SHIP. Every dimension meets the score of 3, and every hard gate passes.
