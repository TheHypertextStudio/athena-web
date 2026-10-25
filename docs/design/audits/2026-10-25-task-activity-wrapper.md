# Task activity metadata wrapper — 2026-10-25

Verdict: **BELOW BAR — narrow-screen inspector acceptance remains open.**

The wrapper now shares the surrounding page tone and uses an explicit shared outline boundary.
Grouped and standalone entries use the same action/content/disclosure renderer. Ordinary comments
remain visible in source order, while scalar consolidation preserves individual edits in the
recorded-activity inspector. The header retains agent artwork, a smaller authority avatar/name,
recorded time range and real detail controls. Native destinations are permission-filtered;
external work keys do not become invented provider URLs.

## Evidence and scores

Captures are in `/Volumes/WillieDrive/CodexScratch/docket-activity-wrapper-1961/shots/`, with
receipts in the same root. Sixteen frames cover simulated conversation, mutation-only work,
expanded changes and the inspector at 1440×900 and 390×844 in both themes. These demonstrate local
presentation, not provider execution. Direct inspection found inspector clipping on phones.

| Dimension                 | Score | Evidence                                                                                                                            |
| ------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice  | 3     | Conversation frames use a quiet outline on the shared rail; no synthetic work-result heading.                                       |
| Typography                | 3     | Compact identity and range are subordinate to ordinary Plex content; one action heading replaces the description/view-change stack. |
| Spatial rhythm            | 3     | Header identity and semantic row icons share a gutter; ordinary activity no longer sits on a separate tonal block.                  |
| Hierarchy and information | 3     | Comments and mutations remain in order; the inspector exposes each source edit without consolidation.                               |
| Color discipline          | 3     | Surrounding page tone and semantic neutral outline hold in both themes. Scoped timeline axe checks pass.                            |
| Motion and feedback       | 3     | Six browser tests cover disclosures, reduced motion, keyboard focus and inspector close/focus restoration.                          |
| States completeness       | 2     | All four states are captured, but narrow inspector text and controls require correction and re-verification.                        |
| Detail craft              | 2     | Phone inspector relationship text clips. Automated viewport checks did not adequately cover this panel's internal bounds.           |

## Gates and handoff

Timeline keyboard/axe checks, 320px touch controls, 200% text and title/action bounds pass.
Theme parity is captured. Fixtures are identified as simulations. Responsive acceptance fails for
the inspector; its complete accessibility and reachability must be checked after reflow is fixed.
Do not infer visual acceptance from green tests.

30 API, 26 web, 7 UI and 6 browser tests pass, along with affected package builds, typechecks, lint
and the complexity ratchet. Native API tests preserve owner-only session detail access while
retaining visible task changes. Full native detail navigation still needs acceptance. The stack
was stopped and the shared development database reset. This refinement is preserved as a branch checkpoint at the user’s request and remains
unshipped. Resume with inspector sizing/wrapping, reachable controls and scoped overflow checks,
then refresh this audit and integrate the completed change. External mentions remain separate.
