---
surfaces:
  [
    'orgs-[orgId]-work-templates',
    'plan',
    'orgs-[orgId]-plans-[planId]',
    'orgs-[orgId]-tasks-[taskId]',
  ]
date: 2026-10-16
verdict: needs-work
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 3
  color: 3
  motion: 3
  states: 2
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: focused work activities — 2026-10-16

Register: product application, IBM Plex and Material Design 3. Review covers work-template
authoring, gallery and work identity dialogs, daily planning, weekly and daily reviews, and the
planning canvas. It does not accept unrelated application surfaces or production deployment.

The private evidence collection is
`/Users/williecubed/.codex/recovery/2026-10-16-phone-craft/`.
Its screenshot manifest identifies each named state, viewport, theme and image hash. The original
collection remains separate; failed or superseded captures are excluded from the new gallery.
Request/response simulations are labelled and do not establish backend permission enforcement.

| Dimension                        | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice         | 3     | Authoring Purpose and Repeat use concrete work language: name a kind of work, include work, first occurrence, and responsibility. Technical blueprint and publication terminology remains in engineering contracts.                                                                                                                                                              |
| Typographic craft                | 3     | Phone activity headings use the title scale. In gallery instruction expansion, subordinate document headings no longer exceed the work-row title. The narrow work-record title keeps a readable 22px size above its actions.                                                                                                                                                     |
| Spatial rhythm and density       | 3     | The authoring alignment measurements put related headings, fields and footer actions at x=12 at 320px. The base has zero inset; active panels own one gutter. Proposed schedules no longer add a second card inset.                                                                                                                                                              |
| Hierarchy and information design | 3     | A selected child or routine replaces its outline; optional details are disclosed. Phone Work and Agenda are alternatives with retained mounted content. Evening review exposes one revisitable decision at a time.                                                                                                                                                               |
| Color discipline                 | 3     | Light and dark frames use existing semantic tonal surfaces and controls. Supporting-copy contrast measurements are included in the private review records.                                                                                                                                                                                                                       |
| Motion and feedback              | 3     | Actual canvas journeys retain node measurements through controlled updates and animation completion. Search waits for measured matches. Capture tooling waits for finite entrance motion without fast-forwarding paused, scroll-linked headers.                                                                                                                                  |
| States completeness              | 2     | Named empty, pending, failure, retry, retained-draft, publication, archive and read-only states are included. Pending template lookup no longer incorrectly says a valid selection is unavailable. Inline recovery owns its errors without a competing toast. One intermittent development cold-load hydration failure remains unresolved; it prevents unconditional acceptance. |
| Detail craft                     | 3     | Actual narrow-header geometry tests cover expanded and scrolled work titles. The Athena sheet measures 448px on desktop and 390px on a 390px phone. Seven weekdays remain readable with touch targets at least 40px at 320px.                                                                                                                                                    |

## Findings corrected

- Remove stacked phone canvas, section and editor insets; align the remaining content gutter.
- Compact activity headers and preserve section position and input focus when revisiting work.
- Separate the narrow work-record title and action lanes, including the scrolled state.
- Keep primary review actions after the decisions they complete, with prerequisites explained.
- Disclose empty-week detail and upcoming check-ins instead of filling the initial view with them.
- Preserve optional assessment disclosure through asynchronous review, and explain archived plans
  inside their isolated inspector.
- Correct loading-template copy, nested instruction heading size, contextual menu guidance and
  dialog focus return.
- Retain observed canvas dimensions through graph updates and animation completion; fix empty
  search-result heading semantics.

Distinct published templates may have the same name. The contextual chooser identifies the pinned
current template and previews alternatives before confirmation. It does not invent owner or source
metadata absent from the published-choice contract, or hide independently editable publications.

## Acceptance evidence

All 319 named states are independently reviewed: 132 authoring, 83 gallery and 104 planning.
The collection contains 1,378 accepted images: 1,274 standard frames and 104 representative narrow
or short-phone frames. The phone-only step chooser has two standard phone frames. No failed capture
is included. Per-state review ledgers and image hashes are retained with the private collection.

Keyboard checks cover authoring step navigation, retained input focus/drafts, child return,
weekday Space activation, dialog Escape, contextual Save-as focus return, and Athena modal
Tab/Shift+Tab containment and origin focus restoration. Settled contrast spot checks range from
4.86:1 to 17.61:1. These are targeted accessibility checks, not an exhaustive screen-reader audit.

Affected component tests, web/UI types, affected source lint, complexity and the production build
pass. The actual browser journeys verify short agenda blocks, phone header bounds and canvas
search. Two fresh production actors complete eight cold archive loads with no route errors.

**Verdict: BELOW BAR for unconditional integration.** The visible layout findings are corrected
and the screenshot collection is ready for owner review. A development cold load intermittently
hydrated the activity shell against Next's hidden metadata sibling; 32 later development loads and
eight production loads pass, but no causal fix is proved. Preserve that diagnostic and close the
explicit worklog follow-up rather than treating successful retries as resolution. Fresh owner
visual acceptance and production deployment remain separate from this local review.
