# Work definitions and Program schedules — local interface review

This review supersedes the earlier October 15 authoring scorecard. It covers the revised Purpose → Work → Review definition flow and Program-owned schedule overview, setup and history. The central change is decision order and hierarchy: identity, ordered included work, focused content, contextual timing and responsibility, then consequences.

**Verdict: SHIP for the reviewed local interfaces.** The owner-directed structural pass has been independently inspected at desktop and short-phone widths. The current pass also covers reusable Program routine authoring, creation review and independent schedule copies. The final organization pass is independently accepted locally. This audit does not claim integration, release or provider acceptance.

## Evidence

The canonical authenticated stack, real passkey session and existing `capture-shots.ts` produced 104 frames across thirteen states, each at 1440×900, 390×844, 320×844 and 390×600 in both themes. The capture procedure checks horizontal overflow. Fixtures were persisted through the public API: a Program, Event definition with a filled document, Book venue instructions, optional nested Vendor booking, an active monthly routine, a paused routine and a completion-based routine. A separate published-and-archived Event fixture verifies retained-version continuity. Disposable records were removed by stopping the standard stack and resetting its database.

Private evidence root: `/Users/williecubed/.codex/recovery/2026-10-15-athena/program-schedule-ia/`. Current matrices are `final-definition-root`, `final-definition-child`, `final-definition-purpose`, `final-definition-review`, `final-overview`, `final-setup-work`, `final-setup-repeat`, `final-setup-review`, `final-archived-setup`, `final-new-schedule`, `final-empty-program` and `final-history-failed`. `final-definition-long` is supplemental long-document evidence from the same pass. Filenames retain the literal route and viewport/theme suffix. Earlier unprefixed folders document superseded iterations.

The organization pass adds forty current frames in `final-organization-outline`, `final-organization-collapsed`, `final-organization-routine`, `final-organization-review` and `final-organization-composer` under the same private evidence root. Each matrix covers 1440×900, 390×844, 320×844 and 390×600 in both themes, with the standard overflow assertion. The final fixtures use Neighborhood association, Community gatherings, Event and Monthly community dinner, persisted through authenticated public APIs. These matrices supersede the earlier authoring and Review images; the earlier schedule setup, failure and archive evidence remains applicable to those unchanged interfaces.

## Organization and returning navigation

Work has one ordered outline: the parent identity, Included work and Recurring work. Child lists now carry actual semantic nesting while retaining authored sibling order. Included work is a shared keyboard-operable disclosure whose count remains visible when collapsed. A person can reach recurring work without traversing a long child branch. Returning from a child reopens its branch before restoring focus; returning from a routine preserves the branch's collapsed state.

A real browser case with twenty document sections and twenty-four children first reproduced an offscreen outline after reading the final document note. The desktop outline now stays below the measured definition-header height using the existing 24px separation; it introduces no second scroll region. The same case verifies that a collapsed long branch keeps the routine reachable on a phone. Short-phone captures retain the same single page scroll owner.

Review groups Starting work, Included work and Recurring work. Desktop places the starting document alongside the work hierarchy and routines; phone presents the groups in that order. Repeated identity and empty no-cycle/date rows are removed. Program owner and Parent assignee wording keeps responsibility contextual, including the explicit selected-team fallback. Optional inclusion, actual date rules, blockers, publication/version choices and private-work constraints remain visible; meaningful starting overrides and child documents remain expandable.

Reusable routine editing orders work choice, schedule name and item title, rhythm, responsibility, then version and ordering actions. Relative starts use When created / After / Before and a positive day count; canonical signed offsets remain unchanged. Custom Practice, Gathering, Action and Circle vocabulary is covered across routine authoring, relative-start controls, definition Review and composer schedule summaries.

The final navigation review reproduced and corrected an offscreen routine return with Included work
expanded to twenty-four children. Existing routine Back, new-routine cancellation and Remove now
scroll the focus target below the measured header while preserving the branch state. The real case
passes at 390×600, 320×844 and desktop. Root and nested remove-first/add regressions now append new
children after retained siblings, preserving their prior order and Move earlier/later behavior.

The semantic header type-role correction has four refreshed, inspected frames in
`final-overview-token-fix` (desktop and short phone, both themes). Four more final frames in the
private `schedule-missed-decision` evidence folder verify the explicit Create work action for an
unresolved missed date. A real authenticated browser action creates exactly one Project, preserves
the other pending decision and survives reload. Failed attempts retain the separate Retry action.
These supplement the forty final organization frames and the unchanged schedule setup/archive/failure
matrices; earlier header and missed-decision images are superseded.

## Craft observations

| Dimension             | Score | Concrete evidence                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand and voice       | 3     | Event, Community dinner and Book venue give the flow a concrete vocabulary. Optional summaries and contextual responsibility controls replace generic configuration sections. Internal invocation and failure details stay out of product copy.                                                                                                                                                            |
| Typography            | 3     | Definition identity, selected editor and document use distinct shared MD3 scales. Schedule cards lead with the routine identity and actual next work title; cadence, template and civil date are subordinate.                                                                                                                                                                                              |
| Spatial rhythm        | 3     | Outer authoring and schedule containers use 16px shapes; inset document and responsibility wells use 12px shapes. One desktop outline/editor workspace replaces stacked coequal cards. Review uses three logical surfaces rather than a card for every row. Phone detail shows selected content with an explicit return action.                                                                            |
| Information hierarchy | 3     | The work outline separates parent, included and recurring branches, with semantic nesting, persistent counts and a collapsible child branch. Root content precedes optional summary/properties. Child content is followed by inclusion, dates/dependencies, responsibility and advanced template placement. Compact Program identity and tabs keep the first routine and its next work visible at 390×600. |
| Color discipline      | 3     | Shared semantic surfaces distinguish navigation, document, focused editing and attention in light and dark. Accent marks current section and primary action; failed-run attention uses the shared warning treatment.                                                                                                                                                                                       |
| Motion and feedback   | 3     | Native shared controls retain focus/disclosure behavior. Child return restores its outline action; root and schedule child focus survive phone/desktop changes. Rejected saves retain input and show owned recovery copy. Reduced-motion interaction remains usable.                                                                                                                                       |
| States completeness   | 3     | Real empty Program and new schedule states teach the first decision. Loading and failed previews retain draft choices. Durable failed runs expose attention on the overview, safe history copy and an actionable retry. Archived work names its exact retained version.                                                                                                                                    |
| Detail craft          | 3     | Standard matrices pass overflow through 320px. Selected documents contain meaningful prose. A fifteen-section parent document survives child re-entry without loss or horizontal overflow. Shared coarse-pointer primary action measures 40px.                                                                                                                                                             |

## Behavior and gates

A controlled 409 save rejection retains the changed schedule name across section switches and renders only application-owned copy. Removing that interception permits a real saved revision. Reopening today’s saved revision advances the editable boundary to the next calendar day; the minimum respects the saved timezone and the existing revision boundary. Unit coverage includes same-day and future-boundary re-entry.

Optional nested Vendor booking can be deselected; its descendants disappear from the reviewed consequences while the remaining four items persist. Keeping the draft from the close prompt preserves that choice. Responsibility editing moves focus to the selected child and restores its outline button on return. Parent editor focus remains visible after desktop → narrow-phone changes.

Suspending the disposable assignee through the membership API produces a real failed occurrence. Restoring that member and pressing Retry creates one Project at attempt two under the same occurrence ID. Repeating the same date request returns the same root and one history row. Older materialized runs retain their original Event version after publication and future edits. The overview reads the server-owned next title and failure count; it does not infer a materialized title from the newest revision.

A separate schedule is materialized before its template is archived. Existing-revision preview and save accept future title changes against the exact retained closure. The picker reads the actual retained name and version, and structure choices stay locked while responsibility remains editable. Program definition editing authors and preserves `defaultSchedules` with explicit interaction coverage. A fresh real journey saves and reopens a monthly routine, publishes its Program definition, reviews its actual first-run date and grouped unassigned/date-anchor consequences in the Program composer, and creates work. Two Programs receive distinct schedule identities. Editing and republishing the definition leaves both existing copies unchanged; a newly created Program receives the revised routine.

| Gate                | Local evidence                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accessibility       | Keyboard focus/return and breakpoint visibility verified live; rejected-save recovery and coarse-pointer primary action verified. Existing shared primary-action contrast remains unchanged. |
| Responsive          | All thirteen standard matrices pass the capture overflow check through 320px and short phone; long document navigation also passes.                                                          |
| Theme parity        | Light/dark originals inspected for populated root, child, schedule overview, setup, review, archive, empty and failure states.                                                               |
| No placeholder      | Persisted public-API work and meaningful documents, plus deliberate first-use empty states.                                                                                                  |
| Screenshot verified | Standard 104-frame evidence set, with independent inspection of final hierarchy, next-work priority and failure attention.                                                                   |

## Validation and remaining scope

Affected schedule, template hierarchy, recurrence, preview and shared detail-header tests pass. The original focused run covered 64 tests. The organization extension adds passing focused authoring, Review, recurrence and consequence checks, including the vocabulary and navigation cases; its final changed-source tests, web typecheck and owned-source lint pass. The real author/save/reopen/publish/create/independence journey and long-document navigation case also pass. Compact header tests preserve the full Overview context while exercising the collection-focused identity and actions; the existing collapse contract still checks the extracted full masthead. No release acceptance is inferred from these checks.

The final navigation/ordering correction passes 37 focused tests and the original authoring journey,
plus the extended long-outline browser regression. Reusable Program default-schedule controls have
passed focused authoring and runtime acceptance. Creation previews display backend-owned independent schedule summaries and first-run dates. Independent agent review accepted the final desktop hierarchy and regenerated Review. Integration and release acceptance remain separate.
