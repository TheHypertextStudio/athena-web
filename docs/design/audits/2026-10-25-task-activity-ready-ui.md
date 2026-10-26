# Ready task activity timeline — 2026-10-25

Verdict: **SHIP for the narrowed timeline UI.** The activity inspector and new session
navigation are excluded. Their checkpoint findings remain in the wrapper audit and their
unfinished work remains in Docket. This is local UI acceptance, not production acceptance.

## Scope and evidence

Sessions are outlined metadata wrappers at the surrounding page tone, connected to the existing
chronological spine. Header identity, smaller authority avatar and recorded time range stay
secondary to ordinary comments, questions, saved content and recorded metadata changes. Grouped
and standalone records share the content renderer. Each change has one expandable action heading
with lossless source edit details; there is no redundant View description change control.

Twelve final frames live in
`/Volumes/WillieDrive/CodexScratch/docket-activity-wrapper-1961/ready-shots/`, with receipts in
`ready-receipts.jsonl` in the parent artifact root. Conversation, mutation-only and expanded-change
states were captured at 1440×900 and 390×844 in both themes, with 320px overflow checks. Direct
inspection includes both palettes and phone relationship wrapping. Activity fixtures are explicit
simulations on a task created through the real local API, not provider execution receipts.

Fresh capture inspection caught long change headings extending beyond their container. The shared
change trigger now has a maximum width, and the 320px browser regression checks a long relationship
control's bounds directly. This covers a failure that document-level overflow checks alone missed.

## Craft scorecard

| Dimension                 | Score | Evidence                                                                                                                                                                                                                           |
| ------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice  | 3     | Conversation frames show a quiet outline on the shared spine, neutral geometry and a compact session label rather than a separate result card.                                                                                     |
| Typography                | 3     | Plex content and labels carry distinct roles; normal type is used for the recorded range and source timestamps. No monospace chrome is introduced.                                                                                 |
| Spatial rhythm            | 3     | Header artwork and semantic row icons share a gutter. Phone change headings wrap inside the outline while human replies retain the same outer alignment.                                                                           |
| Hierarchy and information | 3     | Authored comments and mutations remain in recorded order. Saved content and relationships are visible before interaction; exact before/after values replace the preview when expanded.                                             |
| Color discipline          | 3     | The session uses the surrounding page tone and the existing shared Card outline. Both themes retain hierarchy without introducing completion, ownership or delegation colors. Scoped axe AA checks pass.                           |
| Motion and feedback       | 3     | Shared disclosure controls preserve keyboard focus and expanded state. Browser checks cover reduced motion, tokened chevrons and coarse-pointer touch targets.                                                                     |
| States completeness       | 3     | All three changed timeline states are captured. Mutation-only work needs no final authored report. Existing loading, empty, error and pagination behavior remains covered by feed tests. Unaccepted inspector controls are absent. |
| Detail craft              | 3     | Exact edit timestamps remain available; long labels and 320px control bounds are verified. Title/actions remain separate with the calendar open, and 200% text preserves viewport bounds.                                          |

## Gates and validation

Local gates pass for the included surface: scoped keyboard/axe checks, responsive control bounds,
paired themes, identified fixture data and direct capture inspection. The five browser checks cover
390/1440/1920px, 320px touch targets, long relationship controls, 200% text, normal fonts,
reduced motion and artwork loading/failure fallback. No manual screen-reader study is claimed.

75 API tests covering the affected activity, loop, toolbox/template and review paths pass, alongside
26 web behavior/grouping tests and shared-avatar coverage. Affected package
builds, typechecks and lint pass; the unchanged complexity ledger passes. After bounding the long
heading, the web checks, build and five browser checks were repeated against the final source.
The stack was stopped and the seeded shared database reset; generated development output was
removed after capture. No new endpoint, migration or session navigation is included in this slice.

The source was self-reviewed. The full inspector/native-link checkpoint remains available at
`fc4bbd47a`. External session destinations and Slack/Discord entity mentions remain separate work.

Integration verification: the ready branch was rebased onto current remote main, preserving its
registered template-executor context and imported tool extraction alongside the explicit activity
role writers. The affected API suite, package checks, five browser checks and all twelve captures
were refreshed after rebase. The original full checkpoint is preserved on the local
`codex/task-activity-full-checkpoint` branch for the separately tracked follow-up work.
