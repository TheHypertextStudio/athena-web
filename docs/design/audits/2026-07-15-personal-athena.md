# Design review: personal Athena — 2026-07-15

Screenshots: `/Users/williecubed/Projects/Hypertext Studio/athena-service/.claude/worktrees/athena-experience/apps/web/test-results/athena-personal-personal-A-6daec-rects-and-responsive-themes-chromium/` — authenticated `/athena` at a 1440×900 desktop viewport and 390×844 mobile viewport in light and dark. The 2026-07-16 spec-review rerun passes 1/1, regenerates all four files after each theme transition settles, checks the final surface at 320px, and adds `athena-mobile-below-fold.png` with the tool outcome, open technical disclosure, and composer visible together.

The five inspected captures have no product-control overlap, clipped tool outcome, disclosure
overflow, or obstructed composer. The small black `N` launcher in local mobile captures belongs to
the Next.js development overlay and is absent from the shipped application; the Athena pulse itself
is absent from the full route as asserted by the browser journey.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                         |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | The surface uses Docket's calm, dense app register and direct work language: Your Athena work, Needs you, Working, Finished, and Only you can see this decision. No workspace-agent or generic session-management framing remains.                               |
| 2. Typographic craft              | 3     | The objective is the strongest heading, state and queue labels are compact, and timestamps/counts use tabular numerals. Desktop and mobile captures retain a clear three-level hierarchy without chat-bubble typography.                                         |
| 3. Spatial rhythm & density       | 3     | Desktop aligns a 19rem queue with the workbench and optional context rail; activity uses restrained divided rows. Mobile deliberately stacks the queue above the selected objective and decision on the 4px spacing rhythm.                                      |
| 4. Hierarchy & information design | 4     | The current objective and private decision precede chronology, approval is the one primary action, raw tool data stays behind disclosure, and the visible Sunsama outcome is readable without opening technical detail.                                          |
| 5. Color discipline               | 3     | Neutral MD3 surfaces dominate. Accent is reserved for selected work, execution state, and approval. All four captures verify the same hierarchy in light and dark; Cancel work, Approve, and Reject each pass an automated enabled-state WCAG AA contrast check. |
| 6. Motion & feedback              | 3     | The dock enters from its shell edge, live query states use shape-matched skeletons, and keyboard focus produces the shared visible ring. A controlled approval request proves actions move to the distinct shared 50% disabled treatment only while pending.     |
| 7. States completeness            | 3     | Working, awaiting approval, structured tool outcome, loading, recoverable error, and selected states are implemented. An empty personal queue teaches the durable-work model and provides a working objective composer instead of a dead instruction.            |
| 8. Detail craft (squint test)     | 3     | Borders align across queue/workbench lanes, activity disclosure stays subordinate, long copy wraps, mobile queue rows remain selectable, the 320px check reports zero document overflow, and every visible Athena button/textarea meets the 40px touch floor.    |

Gates: A11y ✅ (semantic landmarks/labels, keyboard shortcut, visible focus, measured 40px controls, enabled action AA contrast) · Responsive ✅ (1440px, 390px, and automated 320px verification) · Theme parity ✅ · No placeholder ✅ (authenticated application data comes from the explicit Playwright API fixture; every visible action is wired) · Screenshots ✅

## Findings resolved during the review

1. The queue collapsed to zero height on a narrow flex layout. The mobile composition now stacks a bounded, scrollable queue above the selected workbench while desktop retains the dense columns.
2. The empty queue described what to inspect but offered no way to begin. It now has a tested objective composer that creates personal Athena work with preserved invocation context.
3. Several compact action variants inherited 32–36px heights. Athena lifecycle, decision, composer, dock, and contextual-entry controls now enforce the rubric's 40px mobile floor.
4. Cancel work and the secondary decision relied on inherited foreground color, while the original review captured controls after starting a mutation and before theme transitions had settled. Both secondary variants now own the on-surface foreground explicitly. The browser journey waits for enabled AA contrast before every capture, then separately holds approval pending to prove the disabled state remains visibly distinct.
5. Raw provider identifiers were present in the DOM under a native disclosure but hidden visually. The browser journey now distinguishes hidden from absent and proves the identifier becomes visible only after the user opens Technical details.
6. The global pulse overlapped approval controls in the narrow full workspace. `/athena` now suppresses that redundant pulse while retaining the keyboard-accessible dock; the route journey asserts the pulse is absent before capturing.
7. The ambient shell previously polled the full queue and selected detail even while closed. It now
   polls only compact counts, enables queue/detail reads on demand, contains filtered selection to
   visible sessions, clears transient source/draft context on every route/open, and announces safe
   shared mutation feedback. Queue and workbench labels truncate within their lanes at narrow widths.

Verdict: **SHIP BAR** — every dimension is at least 3 and every hard gate passes.
