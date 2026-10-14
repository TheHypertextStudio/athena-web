# Design review: template and repeating-work overlays — 2026-10-03

> **Verdict withdrawn on 2026-10-04.** The user rejected the spatial design. The screenshot shows an oversized sparse panel and unclear editing affordances. The passing scores below are historical claims, not current approval. See the layout correction worklog entry.

Reader: A Docket maintainer deciding whether the approved first UI delivery can be committed.

The real app meets the Docket Craft Rubric for this delivery. The UI keeps the current template
and recurrence contracts. It does not introduce nested definitions or a new state-machine runtime.

## Evidence

Authenticated captures use the existing dev-session and capture-shots tools. The disposable local
account contains persisted API fixture data, including Process rollout and a project with nine tasks.
The old standalone preview supplies no evidence.

The screenshot root is `.data/design-review/2026-10-02-work-template-ui/` in this checkout.
Each of `template-basics/`, `template-work/`, `repeat-work/`, and `management/` contains light and
dark captures at 1440×900, 390×844, 320×844, and 390×600. The capture tool checks document overflow
and rejects damaged compositor frames. Phone frames enable touch input.

The baseline is `baseline/orgs-sharedOrgId-settings-templates-1440x900-light.png`.
Additional live captures show `template-review-1440x900-light.png`,
`template-review-1440x900-dark.png`, `template-review-320x844-dark.png`,
`repeat-cadence-390x844-light.png`, `repeat-cadence-320x844-dark.png`, and
`repeat-review-390x844-light.png`, `repeat-review-390x844-dark.png`,
`repeat-review-320x844-dark.png`, and `repeat-review-1440x900-light.png`.
The final desktop repeat review has measured columns of 760px and 320px.

## Scores

| Dimension                        | Score | Evidence                                                                                                                                                                                                                                              |
| -------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice         | 3     | Shared app surfaces and workspace vocabulary; Basics names the template, Work names defaults, and actions state Create template, Save changes, and Start repeating. No event-specific product types or AI-process narration appears.                  |
| Typographic craft                | 3     | Shared MD3 title, body, and label tokens distinguish identity, sections, fields, and supporting copy. Long fixture names wrap in repeat setup and truncate in management.                                                                             |
| Spatial rhythm and density       | 3     | Desktop Work uses a flexible editor and secondary defaults column. Repeat review uses a 20rem settings column. Phone fields share their insets and fit at 320px.                                                                                      |
| Hierarchy and information design | 3     | Setup has three steps, editing opens Work directly, and one primary action stays in the footer. Management puts schedule controls before upcoming rows on phones.                                                                                     |
| Color discipline                 | 3     | Semantic app tokens provide tonal grouping and theme parity. Blue identifies the primary action and selected controls; status colors retain their existing meanings.                                                                                  |
| Motion and feedback              | 3     | Existing dialog and control primitives provide focus and motion treatment. Behavior tests verify pending-save locking, retained drafts after failure, and recovery through application-owned errors.                                                  |
| States completeness              | 3     | Tests cover all four kinds, empty descriptions, renamed templates, team sharing and labels, permission failures, retries, empty milestones, schedule revisions, and preserved history. Real captures include an empty Basics step and populated work. |
| Detail craft                     | 3     | Cadence select, date, interval, and end controls fit within the phone field bounds. Measured phone controls are 40px tall. Header and footer stay visible while the body scrolls. Horizontal separators were removed from the recurrence popover.     |

## Hard gates

All five gates pass for the changed surfaces.

- Accessibility passes. Shared dialogs trap focus; keyboard Tab reaches footer actions; tests verify focus restoration after dismissal and Keep editing. Phone controls and tabs measure 40px. The dark primary button's measured Lab lightness values yield about 8.6:1 contrast.
- Responsive layout passes. All standard captures pass the 320px document overflow check. At 320px, repeat review has one 580px body scroll region containing 1108px of content. Start repeating remains at y=744–784.
- Theme parity passes. Both themes have captured desktop and phone evidence.
- Functional content passes. The work roster and history come from persisted local API fixtures. The delivery adds no unavailable publishing, nesting, or graph-update controls.
- Screenshot verification passes. The scorecard uses authenticated real-app captures.

## Findings fixed

1. Compact navigation suppressed the shared phone touch size. The template tabs now retain the shared touch target.
2. Repeat review stacked full-width settings under the work on desktop. Its final grid gives settings a consistent secondary column and stacks only on narrow overlays.
3. Auto-sized review labels squeezed timezone values. The review uses a fixed label column and a flexible value column.
4. The recurrence popover retained a horizontal footer separator. The footer now separates through spacing.
5. SettingsGroup forwarded its data-heading marker as a DOM attribute and produced a React warning. The component now consumes the marker before forwarding section attributes.

The affected behavior tests, typecheck, lint, production build, and complexity check pass. The delivery is ready to commit. This review does not authorize
integration into main or deployment. Browser reload recovery and autosave remain outside scope.
