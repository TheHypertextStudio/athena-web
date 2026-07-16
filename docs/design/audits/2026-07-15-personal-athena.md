# Design review: personal Athena — 2026-07-15

Screenshots: `/Users/williecubed/Projects/Hypertext Studio/athena-service/.claude/worktrees/athena-experience/apps/web/test-results/athena-personal-personal-A-6daec-rects-and-responsive-themes-chromium/` — authenticated `/athena` at a 1440×900 desktop viewport and 390×844 mobile viewport in light and dark. The final Playwright rerun passes 1/1, regenerates all four files, and also checks the final surface at 320px.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                        |
| --------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | The surface uses Docket's calm, dense app register and direct work language: Your Athena work, Needs you, Working, Finished, and Only you can see this decision. No workspace-agent or generic session-management framing remains.                              |
| 2. Typographic craft              | 3     | The objective is the strongest heading, state and queue labels are compact, and timestamps/counts use tabular numerals. Desktop and mobile captures retain a clear three-level hierarchy without chat-bubble typography.                                        |
| 3. Spatial rhythm & density       | 3     | Desktop aligns a 19rem queue with the workbench and optional context rail; activity uses restrained divided rows. Mobile deliberately stacks the queue above the selected objective and decision on the 4px spacing rhythm.                                     |
| 4. Hierarchy & information design | 4     | The current objective and private decision precede chronology, approval is the one primary action, raw tool data stays behind disclosure, and the visible Sunsama outcome is readable without opening technical detail.                                         |
| 5. Color discipline               | 3     | Neutral MD3 surfaces dominate. Accent is reserved for selected work, execution state, and approval. All four captures verify the same hierarchy in light and dark, and the primary decision pair passes an automated AA contrast check.                         |
| 6. Motion & feedback              | 3     | The dock enters from its shell edge, live query states use shape-matched skeletons, mutation controls disable while pending, and keyboard focus produces the shared visible ring. The compact pulse gives persistent status feedback without decorative motion. |
| 7. States completeness            | 3     | Working, awaiting approval, structured tool outcome, loading, recoverable error, and selected states are implemented. An empty personal queue teaches the durable-work model and provides a working objective composer instead of a dead instruction.           |
| 8. Detail craft (squint test)     | 3     | Borders align across queue/workbench lanes, activity disclosure stays subordinate, long copy wraps, mobile queue rows remain selectable, the 320px check reports zero document overflow, and every visible Athena button/textarea meets the 40px touch floor.   |

Gates: A11y ✅ (semantic landmarks/labels, keyboard shortcut, visible focus, measured 40px controls, primary-action AA contrast) · Responsive ✅ (1440px, 390px, and automated 320px verification) · Theme parity ✅ · No placeholder ✅ (authenticated application data comes from the explicit Playwright API fixture; every visible action is wired) · Screenshots ✅

## Findings resolved during the review

1. The queue collapsed to zero height on a narrow flex layout. The mobile composition now stacks a bounded, scrollable queue above the selected workbench while desktop retains the dense columns.
2. The empty queue described what to inspect but offered no way to begin. It now has a tested objective composer that creates personal Athena work with preserved invocation context.
3. Several compact action variants inherited 32–36px heights. Athena lifecycle, decision, composer, dock, and contextual-entry controls now enforce the rubric's 40px mobile floor.
4. Workbench ghost controls inherited ambient text color in dark mode. The workbench root now owns the correct on-surface token, verified in the regenerated dark captures.
5. Raw provider identifiers were present in the DOM under a native disclosure but hidden visually. The browser journey now distinguishes hidden from absent and proves the identifier becomes visible only after the user opens Technical details.
6. The global pulse overlapped approval controls in the narrow full workspace. `/athena` now suppresses that redundant pulse while retaining the keyboard-accessible dock; the route journey asserts the pulse is absent before capturing.

Verdict: **SHIP BAR** — every dimension is at least 3 and every hard gate passes.
