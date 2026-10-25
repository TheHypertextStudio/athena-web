# Task activity readability correction — 2026-10-25

Rejected by the user: visible audit labels still failed to convey the work. This review does not
establish design acceptance. See the [contribution refinement](2026-10-25-task-activity-contributions.md) for the recovered content-first composition.

The prior blueprint pass hid the actions behind a count and introduced unnecessary monospace.
The user rejected that result. The original readable activity rows were a better foundation;
session grouping should reduce repetition while preserving visible evidence of work.

## Local result

Ordinary change lists now show every action directly inside their session contribution. Each row
opens its before/after content and exact timestamp. Only sequences exceeding ten changes fold the
middle, with the first three and latest three visible. Opening that disclosure restores the middle
in its original position. Session headers, comments and edit timestamps use the normal app typeface.
The existing chronological rail, attribution and continuation boundaries remain.

The page's primary model is entity history: actions for, by and in relation to the task. Session
identity is secondary metadata. Mentions and linked conversations belong in that model when their
source access, entity association, attribution, source links and deduplication are established.
Current task Activity does not yet project Slack/Discord mentions; this correction does not claim
the complete entity-history capability is delivered.

## Evidence

Twelve final frames live in `.data/blueprint-activity/readability-shots/`, with receipts in
`.data/blueprint-activity/readability-receipts.jsonl`. These use the existing capture tool and an
API-created local task, with explicitly simulated activity responses:

- `simulated-readable-mutation-only-*`: the two actual action summaries are readable without a count disclosure.
- `simulated-readable-conversation-*`: authored comments, questions and visible action summaries share the contribution.
- `simulated-readable-changes-*`: one-level expanded before/after content, absolute time and a wrapping dependency summary.

Every state was captured at 1440×900 and 390×844 in both themes; the capture tool also checks 320px
overflow. The existing loading, empty and recoverable-error presentation was not changed. Its prior
captures remain evidence of those unchanged states, not of this revision's populated rows.

## Craft assessment

| Dimension                      | Score | Evidence                                                                                                                                                                                         |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brand identity & voice         | 3     | Normal app typography replaces monospace; the existing neutral spine and discrete sessions remain.                                                                                               |
| Typographic craft              | 3     | Normal body text carries action summaries, subordinate labels carry time, and the session identity remains a single heading.                                                                     |
| Spatial rhythm & density       | 3     | Compact readable action rows replace a count-only box. Wrapping text stays inside the shared phone gutter.                                                                                       |
| Hierarchy & information design | 3     | Action meaning is visible before interaction; only full diffs and the middle of unusually long sequences disclose.                                                                               |
| Color discipline               | 3     | Existing semantic tonal surfaces retain parity in paired light/dark captures; scoped contrast checks pass.                                                                                       |
| Motion & feedback              | 3     | Existing tokened chevrons, keyboard focus and expanded states remain operable with reduced motion.                                                                                               |
| States completeness            | 3     | Mutation-only, mixed and expanded states were recaptured. Behavior checks cover five visible actions, twelve actions with an expandable middle, question-only and transcript-only contributions. |
| Detail craft                   | 3     | Exact edit times remain alongside expanded values. Long row text wraps; touch disclosures remain at least 40px at 320px.                                                                         |

Local gates: accessibility spot checks, responsive bounds, theme parity, explicit simulated evidence
and rendered inspection pass. Four browser checks cover 390/1440/1920px, 320px coarse-pointer
controls, keyboard focus/Enter, normal timestamp font family, reduced motion, scoped WCAG AA checks
in both themes and 200% text. Nineteen focused web tests pass. These checks do not establish human
usability or manual screen-reader acceptance.

This is a local readability correction. User design acceptance and the broader source-aggregation
model remain open; the previous count-only surface must not be used as evidence of design approval.
