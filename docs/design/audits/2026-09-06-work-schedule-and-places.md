# Design review: Work schedule and Places — 2026-09-06

This scorecard is for the frontend maintainer who ships the new personal-settings destinations.
The maintainer can ship these surfaces without another craft pass.

Screenshots: `screenshots/2026-09-05-work-schedule-and-places/` contains populated 1440×900 and
390×844 captures in light and dark. Its `empty/` directory contains empty-state captures at
1440×900, 390×844, 390×600, and 320×844 in both themes. Its `loading/` directory contains mounted
390×844 loading states for both routes.

| Dimension                           | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity and voice         |     3 | The populated captures use Docket's calm MD3 app register. The copy names concrete jobs such as “Default schedule,” “Date changes,” “Saved places,” and “Automatic location.” The interface does not use provider terms or a generic “Calendar sync” label for these jobs.                                                                                                                                  |
| 2. Typographic craft                |     3 | The section titles, group titles, row labels, and supporting text form four stable token-backed levels at both widths. The phone captures keep all actions and labels intact. The schedule summaries use concise time and location strings instead of adding another visual level.                                                                                                                          |
| 3. Spatial rhythm and density       |     3 | The desktop captures hold the content to the shared `max-w-3xl` settings measure. The groups follow one 24px page rhythm and one 16px group rhythm. Rows align their leading glyphs, copy, and trailing controls. The phone captures preserve those alignments after the shell collapses.                                                                                                                   |
| 4. Hierarchy and information design |     3 | `Work schedule` gives the default one header action and keeps dated replacements in a separate group. `Places` gives `Add place` the only primary treatment. Provider names that need a decision appear under `Unmatched names`, while device detection stays under `Automatic location`. Empty captures teach the first action instead of showing a bare list.                                             |
| 5. Color discipline                 |     3 | The populated and empty captures use neutral surface tiers for structure and reserve blue for primary actions and focus. Both dark captures retain the same hierarchy. Measured contrast was 5.57:1 for the light `Add place` action, 8.54:1 for its dark counterpart, 16.87:1 for the light automatic-location setup action, and 15.30:1 for its dark counterpart.                                         |
| 6. Motion and feedback              |     3 | Buttons, menus, dialog controls, and the MD3 switch use shared interaction primitives and focus treatment. The loading captures keep the section heading mounted and replace only the body with skeletons. Screenshot capture with animations disabled did not change layout or access to any control. Automatic location explains unavailable and prerequisite states next to its control.                 |
| 7. States completeness              |     3 | The `empty/` captures show instructional states for both destinations. The `loading/` captures show body-shaped skeletons beneath stable headings. The 320×844 captures have no clipped controls. Read failures replace unsafe create or edit actions with application-owned error text and a `Try again` action. Unknown provider labels use a `Resolve` flow and never create a place without a decision. |
| 8. Detail craft                     |     3 | All six keyboard stops in the primary phone flow showed the shared 2px focus ring. The 390px automatic-location action stacks below its description. The populated capture asserts that geometry. The 320px capture reports equal document client and scroll widths. Icons, badges, corners, and row insets remain consistent in light and dark.                                                            |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

## Findings

The review found no remaining ship blocker. It found and fixed two issues during the review:

1. The automatic-location setup action competed with its explanatory copy at 390px. The shared
   settings row now supports a narrow stacked trailing action. The control remains inline when the
   container has room. See `apps/web/src/components/settings/setting-row.tsx:37` and
   `apps/web/src/app/(app)/settings/places/page.tsx:578`.
2. The first Work schedule loading capture recorded the previous route before the settings client
   route mounted. The evidence test now waits for both the destination heading and the shared
   loading status before it writes either loading screenshot. See
   `apps/web/e2e/settings/work-locations-shots.spec.ts:61`.

Verdict: SHIP.
