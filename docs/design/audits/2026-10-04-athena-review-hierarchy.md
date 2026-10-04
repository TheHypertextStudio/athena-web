# Design review: Athena work review — 2026-10-04

Register: app, calm Plex/MD3. Scope: the full `/athena` review surface and its phone picker.

## Evidence

- Before: `/Users/williecubed/.codex/visualizations/2026/10/04/athena-remaining-proof/comment-preview-delivery/after-desktop-light.png`.
- Local review fixture, explicitly test data: `/Users/williecubed/.codex/visualizations/2026/10/04/athena-hierarchy/review-1440-light.png`, `review-1440-dark.png`, `review-390-light.png`, `review-390-dark.png`, and both 320 px captures in that directory.
- Real empty local account, created by the existing dev-session tool: `/Users/williecubed/.codex/visualizations/2026/10/04/athena-hierarchy-empty/athena-1440x900-light.png` and the standard eight-frame set in that directory. No records were invented to fill the empty account.
- Owning browser cases: `apps/web/e2e/athena/companion-work.spec.ts`, five cases passed. Checks cover native comment approval/receipt, one review per document, content before decisions, phone picker keyboard selection, preserved ten-line draft, overflow, contrast, focus, and coarse-touch target size.
- Independent source and full screenshot review: no remaining actionable findings after correcting selection persistence and the chat history fold.

## Scorecard

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | The main review uses “Review comment,” “View task,” and explicit decisions. The complete user-authored request is preserved in a secondary disclosure; application copy does not adopt dispatch terminology. Shared MD3 surfaces and Plex match the app.                                                                    |
| 2. Typographic craft              | 3     | The structural review title, body prose, and muted metadata use the existing title/body/label tokens. Review prose is capped at the existing 640 px measure; navigation clamps long requests to two lines.                                                                                                                  |
| 3. Spatial rhythm & density       | 3     | Compact work navigation has a 240 px desktop column. The selected entry and composer own the remaining width. The phone picker occupies one 40 px row while closed; it no longer divides the screen between work and an empty chat.                                                                                         |
| 4. Hierarchy & information design | 3     | One selected review leads with saved content and its destination. Approve is the sole filled review action, Reject is subordinate, and request/history follow as disclosures. Agenda and the redundant overdue reminder are absent from this route.                                                                         |
| 5. Color discipline               | 3     | Neutral surfaces dominate both captures; selection, native task link, and approval earn the accent. Browser contrast sampling verifies the approval text/background pair >=4.5 in both themes.                                                                                                                              |
| 6. Motion & feedback              | 3     | Picker selection immediately returns focus to the full entry. Disclosure rotation respects reduced motion. The approval browser journey visibly transitions the same entry into its finished receipt.                                                                                                                       |
| 7. State design                   | 3     | Empty accounts retain the conversation and composer. Pending review and finished receipt are covered in owning browser cases. Older selected work remains visible while old chat stays folded; queue insertion keeps selection stable. Existing conversation error/loading behavior is retained, with Athena tests passing. |
| 8. Detail & finish                | 3     | A saved native comment appears once; original request remains readable when expanded. View task uses the shared authenticated navigation primitive, and the phone composer retains its draft after choosing work.                                                                                                           |

## Hard gates

- **A11y**: Local pass. Approval contrast >=4.5 in both themes; visible keyboard focus; semantic Work/Conversation landmarks; keyboard picker selection focuses the selected article; coarse-touch approval target >=40 px. Existing native decision authorization is unchanged.
- **Responsive**: Local pass at 320, 390, and 1440 px, with no document overflow; short 390×600 composer case passes. Wider production verification remains pending.
- **Theme parity**: Local pass with full desktop and phone light/dark captures. Reduced motion prevents capturing a half-finished theme transition.
- **No placeholder**: Pass. Fixture screenshots are identified as tests; empty-account screenshots are genuinely empty. Production proposals and task fields have not been altered.
- **Screenshot-verified**: Local pass. Actual owner record with the longer saved comment remains the final production acceptance gate.

## Findings addressed

1. Full work cards dominated a narrow pane above an empty conversation. Replaced them with compact navigation and one selected entry in the conversation.
2. Approval controls preceded the content, with repeated summary/state and a nested step disclosure. Native pending comment content now precedes decisions, appears once, and leaves request/history secondary.
3. Agenda and a redundant overdue reminder competed with the review. The route owns its main width and the picker owns review awareness.
4. Queue updates could replace the default review, and the history fold could hide selected older work. Persisted selection and explicit focused-work visibility fix both, with regression coverage.

Verdict: **Local ship bar met; production acceptance pending.** Do not call the delivery complete until the actual owner’s saved comment is verified after deployment.
