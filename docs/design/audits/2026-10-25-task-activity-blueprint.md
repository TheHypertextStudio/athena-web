# Design review: task activity blueprint — 2026-10-25

Register: Docket app, Plex typography and semantic tonal surfaces. Scope: task Activity and its
masthead correction. This is local implementation acceptance, not production or provider acceptance.

## Rendered evidence

Captures live in `.data/blueprint-activity/shots/`. Each named state has 1440×900 and 390×844 frames
in light and dark. The existing capture tool also checks overflow at 320px.

- `simulated-blueprint-conversation-*`: collapsed contribution, intentional task comments and a question.
- `simulated-blueprint-changes-*`: expanded changes and description before/after with absolute timestamps.
- `simulated-blueprint-continuation-*`: a human reply followed by the same session's continuation.
- `simulated-blueprint-mutation-only-*`: a session with two changes and no authored update.
- `simulated-blueprint-empty-*`, `simulated-blueprint-loading-*`, `simulated-blueprint-error-*`:
  retained composer, loading skeleton and recoverable read failure.

These are explicitly simulated activity responses on a real API-created local task, using the
Urbanist collateral example. They establish presentation, not actual agent execution or delegation.
Private scenario and receipt files remain outside repository history. Successful final receipts are
`geometric-final-receipts.jsonl`, `work-record-receipts.jsonl`, `state-receipts.jsonl` and
`detail-final-receipts.jsonl` under `.data/blueprint-activity/`. An initial error-state readiness
selector used “Retry” instead of the actual “Try again”; that failed frame is excluded and the
corrected four-frame state was captured successfully.

## Craft scorecard

| Dimension                      | Score | Evidence                                                                                                                                                                                                     |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brand identity & voice         | 3     | Neutral linework, compact square agent nodes and circular human nodes express chronology. Existing small-corner session surfaces retain the app's shape system. The session has one identity header.         |
| Typographic craft              | 3     | Plex body copy, label hierarchy and mono timestamps separate authored comments, questions and individual changes. Expanded dates include seconds and preserve the source ISO value.                          |
| Spatial rhythm & density       | 3     | Shared primitives own the 24px node box, 16px gutter gap and 24px contribution rhythm. Human text and session text share their left edge. Phone content reflows inside the same gutter.                      |
| Hierarchy & information design | 3     | Latest intentional task comment is prominent; earlier comments and actual edits disclose separately. Mutation-only sessions show changes without inventing a report. Continuations stay after human replies. |
| Color discipline               | 3     | Semantic neutral rail and tonal surfaces work in both themes; color does not encode delegation or completion. Scoped axe AA checks pass in both themes.                                                      |
| Motion & feedback              | 3     | Shared disclosures expose keyboard focus and expanded state immediately. Chevron motion uses the fast token and becomes transition-free under reduced motion.                                                |
| States completeness            | 3     | Populated, expanded, continuation, mutation-only, empty, loading and recoverable error captures exist. Read failure retains the comment composer. Transcript-only sessions produce no task contribution.     |
| Detail craft                   | 3     | Rail bounds stop at endpoint centers; orthogonal stubs align with session headers. Long titles remain separate from masthead actions with the calendar open. Expanded edit text wraps and stays selectable.  |

## Gates and checks

A11y **PASS for the affected surface**: four browser checks cover keyboard Enter, retained focus,
expanded state, reduced motion, scoped axe WCAG A/AA in both themes, and ≥40px disclosure heights
in an actual coarse-pointer 320px context. This is automated and visual acceptance, not a manual
screen-reader study.

Responsive **PASS**: checked 320px touch, 390px phone, 1440px with the calendar panel, 1920px and
200% root text size; no document horizontal overflow. Theme parity **PASS**: paired captured
states. No placeholder **PASS**: functioning app controls; simulated activity is identified as such
in the evidence. Screenshot-verified **PASS**: local captured states inspected.

Verdict: **SHIP for this local UI slice**. No unresolved local craft gate. Production delivery,
real connected-agent interaction and human usability acceptance remain outside this evidence.

## Engineering boundary

A work session is correlation metadata on intentional comments and recorded mutations, independent
of whether it finishes or produces a closing update. The same work key can touch several entities;
each entity projects only its relevant records. Neither session completion nor an ordinary response
publishes a task update. Native task questions, linked participant answers and safe failure notices
remain eligible; thoughts, tool calls, proposals, private prompts and ambiguous historical messages
remain in session history. Review found and excluded automatic executor answers from the participant
reply projection so they cannot displace an intentional task comment.

The code review also verified that source filtering precedes pagination limits, authority scopes
external correlation, and mutation-only containers do not require an authored result. Existing
REST/MCP keys and opaque identities are unchanged; no endpoint or migration was added.
