# Design review: daily planning — 2026-09-23

The reader is the Docket product team. Use this audit to decide whether the daily planning screens are ready to ship. The captured task list uses separate, reorderable cards. A task's project sits directly under its title, while planned time and actions stay beside the text.

Screenshots: [`screenshots/2026-09-23-daily-planning/`](screenshots/2026-09-23-daily-planning/) contains the 1440×900 and 390×844 planning flow in light and dark themes. It also contains Today entry and acceptance, loading and empty states, and [`work-reorder-desktop-light.png`](screenshots/2026-09-23-daily-planning/work-reorder-desktop-light.png) during a drag.

| Dimension                        | Score | Evidence                                                                                                                                                                                                                        |
| -------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice         |     3 | [`plan-desktop-light.png`](screenshots/2026-09-23-daily-planning/plan-desktop-light.png) keeps the Docket rail, Plex type, neutral surfaces, and direct labels.                                                                 |
| Typographic craft                |     3 | [`plan-phone-dark.png`](screenshots/2026-09-23-daily-planning/plan-phone-dark.png) distinguishes the page title, section names, task titles, and quiet project labels without adding a fourth text level inside each card.      |
| Spatial rhythm and density       |     3 | The three tasks in [`plan-phone-dark.png`](screenshots/2026-09-23-daily-planning/plan-phone-dark.png) each occupy one compact card. Titles and projects share a text cell, and time and actions stay on the same line at 390px. |
| Hierarchy and information design |     2 | [`review-desktop-dark.png`](screenshots/2026-09-23-daily-planning/review-desktop-dark.png) gives a large static summary more weight than the agenda and hides the lower agenda beneath the sticky footer.                       |
| Color discipline                 |     3 | [`plan-desktop-dark.png`](screenshots/2026-09-23-daily-planning/plan-desktop-dark.png) uses neutral cards and reserves blue for scheduled blocks and the main action. The light capture uses the same hierarchy.                |
| Motion and feedback              |     3 | [`work-reorder-desktop-light.png`](screenshots/2026-09-23-daily-planning/work-reorder-desktop-light.png) shows the source fading and a visible insertion line under the destination. The browser run used reduced motion.       |
| States completeness              |     2 | Loading, empty, and failed-save states are covered, but the planner does not yet produce a proposed schedule from selected work.                                                                                                |
| Detail craft                     |     3 | [`plan-phone-light.png`](screenshots/2026-09-23-daily-planning/plan-phone-light.png) keeps the task controls within the card. The browser flow found no document overflow at 320px.                                             |

The tested controls are keyboard and touch operable. The responsive and theme gates pass in the captured states. The screenshot gate must be repeated after the proposal and layout changes.

Verdict: **BELOW BAR**. The planner still requires manual block placement. The sticky footer overlaps the agenda, the step labels look like navigation but are inert, planned time is a select, and the large deterministic summary impersonates Athena's role. The next review must capture the corrected proposal and flow.
