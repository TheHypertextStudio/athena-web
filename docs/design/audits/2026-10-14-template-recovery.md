# Design review: recovered template and repeating-work setup

The review covers existing template creation/editing, project repetition, and recurrence
management. Versioned work templates and nested blueprints are separate delivery layers.

Evidence is the authenticated local application with persisted audit fixtures. Forty captures
under `apps/web/.data/design-review/2026-10-14-template-recovery/` cover Basics, Work, Review,
repeat setup, and management at 1440×900, 390×844, 320×844, and 390×600 in both themes.
Captures remain ignored local evidence. The browser journeys cover all four kinds, save/reopen,
sharing, repeat creation, future revisions/history, discard, focus restoration, long documents,
footer reachability, touch-target size, and primary-action contrast.

| Dimension                        | Score | Observed evidence                                                                                                                                   |
| -------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice         | 3     | Work names its kind and optional starting fields; Basics separates the template identity and sharing from created work.                             |
| Typographic craft                | 3     | Template title, kind, field labels, settings, and document headings have distinct shared roles in both themes.                                      |
| Spatial rhythm and density       | 3     | Short desktop work fits its content; phone fields stack on common edges. The long-document journey retains one scroll owner.                        |
| Hierarchy and information design | 3     | Basics, Work, and Review expose distinct tasks. Repeat setup puts included work beside its release choice on desktop.                               |
| Color discipline                 | 3     | Shared neutral surfaces and semantic selection/action tokens retain readable light and dark hierarchy.                                              |
| Motion and feedback              | 3     | Shared dialogs preserve dismissal and focus; browser coverage exercises Keep editing, Discard, save, and reopening.                                 |
| States completeness              | 3     | Tests cover empty and long documents, four kinds, sharing, pending/error retention, and recurrence revisions/history.                               |
| Detail craft                     | 3     | All captured frames pass overflow checks. Short-phone management keeps its save action visible; touch actions and contrast pass browser assertions. |

## Gates and findings

Responsive, theme parity, functional-content, and screenshot gates pass for this slice. Keyboard
dismissal/focus restoration, ≥40px touch targets, and ≥4.5:1 primary-action contrast have browser
coverage. This is focused accessibility evidence, not a complete screen-reader audit or usability
study. Fixture labels identify the audit data; no production account supplies these captures.

Independent engineering review found that a rejected occurrence move lost its chosen date when
the editor unmounted. Keeping the date in the persistent occurrence controls restores failure
recovery; a regression exercises rejection, reopening, and a successful retry.

Verdict: SHIP for the recovered existing-flow slice after its affected verification passes.
The withdrawn October 3 verdict remains historical; this review uses fresh captures and behavior.
