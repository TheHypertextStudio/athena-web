# Design review: daily planning — October 6, 2026

This review is for Docket's product and engineering maintainers. Use it to check the daily loop before deployment. The screenshots use an authenticated local fixture account. They are visual evidence, not production acceptance.

The application uses Docket's Plex typography and shared MD3 surfaces. Today remains home. Review yesterday, Plan today, Review plan, and confirmation each retain their own screen. Add work opens a separate searchable surface.

The capture set is in [screenshots/2026-10-06-daily-planning](screenshots/2026-10-06-daily-planning/). Every main stage has 1440 × 900 desktop, 390 × 844 phone, 320 × 844 narrow phone, and 390 × 600 short phone captures in both themes. The revision-preview set shows the proposed displacement before Apply. The revision set shows the updated-plan confirmation. The short-block set verifies five-minute geometry in planning, review, and Today.

| Dimension                        | Score | Evidence                                                                                                                                                                                                 |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice         | 3     | Plan and review retain the application typography, muted surface colors, and direct action labels. No priority-task or motivational headline appears.                                                    |
| Typographic craft                | 3     | Work-card titles occupy the full first line. Project labels and numeric minutes occupy the second line. Desktop and phone captures preserve that hierarchy.                                              |
| Spatial rhythm and density       | 3     | Individually contained cards keep the grip beside the title. Desktop review gives the agenda more width. The phone review puts the agenda first.                                                         |
| Hierarchy and information design | 3     | Contained stage buttons show the current stage. Agenda bounds, Organize day, preview, and affected work share one column. Confirmation has its own screen.                                               |
| Color discipline                 | 3     | The shared surfaces and primary controls preserve contrast and hierarchy in both themes. Proposed flexible blocks use a dashed boundary; fixed events retain their distinct appearance.                  |
| Motion and feedback              | 3     | Placement uses the shared canvas. Apply and Undo remain explicit. Failed saves retain the edit and expose Retry. The artifact journeys verify reduced motion, visible keyboard focus, and touch targets. |
| States completeness              | 3     | The authenticated scenarios cover resumed drafts, overload, packed and split blocks, active work, interrupted work, tomorrow, and bulk review. Optional Athena leaves confirmation available.            |
| Detail craft                     | 3     | Numeric duration replaces the dropdown. Phone titles wrap above controls. The narrow confirmation action wraps inside its card. The retrospective picker arrow stays within its own width.               |

The screenshots show no horizontal overflow at 320 pixels. The footer follows the content instead of covering the agenda. Timed rectangles use the same minute scale for tasks and events. Short block details appear outside the timed rectangle when necessary.

The official PostgreSQL artifact runner passed all twenty release cases. A second frozen-source run passed all fourteen daily-planning cases after the final date-entry guard. Eighty-eight fresh frames cover each stage and its short-block geometry in both themes. The journeys verify keyboard and touch alternatives, reduced motion, focus, Retry, revisions, actual-versus-planned history, and absence of horizontal overflow or critical error toasts. Authenticated production verification remains a separate release gate.

Verdict: SHIP for the local design and behavior gates. No outstanding layout finding remains in the captured primary flow. Deployment and authenticated production acceptance must still pass before the feature is declared released.
