# Task activity contributions — 2026-10-25

The user accepted the recovered content-first direction and asked for refinement: a session is a
time-bound container for work, not an owner. This review supersedes the rejected count-only and
audit-label treatments. It records local rendering and behavior, not production acceptance.

## Interaction model

The entity history remains primary. A contribution shows its saved description content, concrete
relationship subjects and scalar value transitions. Its heading describes recorded actions;
performer and available authorizing-principal labels are secondary. The session does not acquire
task responsibility. This uses the identity/session/activity separation in
[Linear's agent interaction model](https://linear.app/developers/agent-interaction) as a reference;
it does not copy a transcript or infer a lifecycle from a correlation key.

The displayed range is the first-to-last recorded activity in the loaded contribution, with an
accessible description and exact source timestamps. It is not claimed execution duration. A single
record remains a point in time. Different performers get separate chronological contributions even
when they share session context. Agent comments and mutations still group when the displayed author
and authorizing person differ.

Repeated scalar edits consolidate by subject, field, performer and recorded authority. The visible
transition retains the initial value and latest recorded value; every individual timestamp and
before/after pair remains available. A newly edited field moves to its latest source position, so
long-list folding cannot hide recent work. Distinct relationships remain distinct. Only unusually
long lists fold their middle. No final update is required or generated.

## Captured evidence

Twelve final frames live in `.data/blueprint-activity/container-shots/`, with successful receipts in
`.data/blueprint-activity/container-receipts.jsonl`. Each state has 1440×900 and 390×844 frames in
light and dark, plus the existing capture tool's 320px overflow check:

- `simulated-container-mutation-only-*`: visible revised content and a concrete relationship, with a recorded activity range.
- `simulated-container-conversation-*`: authored update, distinct question, visible saved changes and human discussion.
- `simulated-container-changes-*`: expanded exact timestamp and individual before/after content.

The local task was created through the real API. Activity responses are explicitly simulated for
presentation; these frames do not establish connected-provider behavior or delegation. Existing
empty/loading/error states were unchanged and retain the prior captured evidence.

## Craft scorecard

| Dimension                      | Score | Evidence                                                                                                                                                                                                        |
| ------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity & voice         | 3     | Neutral geometric timeline and small corners remain. Content carries the contribution; ordinary Plex typography replaces monospace.                                                                             |
| Typographic craft              | 3     | Action heading, secondary attribution/window, readable content and subordinate edit disclosures have separate roles.                                                                                            |
| Spatial rhythm & density       | 3     | Header and body use shared surface insets. Scalar bursts become one value transition rather than repeated rows; long values wrap on phones.                                                                     |
| Hierarchy & information design | 3     | Saved work is visible before interaction. Questions have their own tonal region. Full individual edits remain accessible without becoming the primary content.                                                  |
| Color discipline               | 3     | Shared semantic surfaces preserve light/dark hierarchy. No color invents completion, delegation or responsibility. Scoped WCAG AA checks pass in both themes.                                                   |
| Motion & feedback              | 3     | Shared controls retain keyboard focus and expanded state; chevron motion uses a token and disappears under reduced motion.                                                                                      |
| States completeness            | 3     | Populated, mutation-only and expanded states were recaptured. Tests cover repeated edits, distinct relationships, performer changes, legacy connections, long lists, question-only and transcript-only records. |
| Detail craft                   | 3     | Absolute source times remain in edit details. Activity windows distinguish history from execution lifecycle. Recent changes remain visible when the middle of a long list folds.                                |

Local gates pass: scoped accessibility/keyboard checks, responsive bounds, paired themes, explicitly
identified fixture data and captured inspection. Four browser checks cover 390/1440/1920px, actual
coarse-pointer controls at 320px, 200% text, retained keyboard focus, reduced motion and normal
activity font family. This is not a manual screen-reader or usability study.

Verdict: **SHIP for the local contribution-rendering refinement.** The broader entity-history goal
remains incomplete: Slack/Discord mentions and other external conversations need source-aware
entity correlation, permission filtering, links and deduplication. No new endpoint, migration,
ownership contract or session-lifecycle claim was introduced. Nothing was deployed.
