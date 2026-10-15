# Work definition authoring — local interface review

This review supersedes the authoring portions of the October 14 work-template identity audit. The focused, freely revisitable Purpose → Work → Review page replaces the earlier dialog and stacked configuration form. Identity, creation/update previews and recurrence retain their separate acceptance requirements.

**Verdict: SHIP for the reviewed local authoring interface.** The authoring hierarchy has been independently reviewed at desktop, narrow phone and short phone widths. This is local interface evidence, not release, owner or provider acceptance. The original Task creation journey now passes after fixing its first-click readiness; the populated project-catalog identity journey passes when the real contextual search isolates the newly created project. Integration still requires the affected package/build checks.

## Evidence

The standard authenticated stack and existing `capture-shots.ts` produced 48 frames: Work, Purpose, Review, selected child, Dates and empty/new Purpose at 1440×900, 390×844, 320×844 and 390×600, in light and dark. Each capture checked horizontal overflow. The persisted local fixture represents an Event definition with Community dinner sample work, Book venue, Confirm accessibility, optional nested Vendor booking and Dinner day. It was authored through the public API.

Private evidence: `/Users/williecubed/.codex/recovery/2026-10-14-athena/blueprint-final-acceptance/`, with folders `work`, `purpose`, `review`, `selected-child`, `dates`, `new-purpose` and supplemental `error`. Files in the first five folders share the Event route stem; viewport and theme suffixes identify each frame. The new Purpose folder uses the `templates-new` stem. Contact sheets aid comparison; original screenshots remain authoritative.

## Craft observations

These scores describe the captured authoring surface, not an aggregate shipment score.

| Dimension             | Score | Concrete evidence                                                                                                                                                                                                                                            |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brand and voice       | 3     | Purpose describes defining a kind of work with Event, client engagement and volunteer onboarding examples. Workspace nouns name child kinds, responsibility and cycle choices. Internal rule IDs do not appear in Review.                                    |
| Typography            | 3     | The definition name uses headline scale; sample/selected-child headings use title scale; child titles and timing use label/body scale. Compact phone action labels preserve the full name at 320px.                                                          |
| Spatial rhythm        | 3     | Shared 28px Surface shape groups the header, sample document and child region; inset document and secondary disclosures establish contained spacing rather than repeated expanded forms.                                                                     |
| Information hierarchy | 3     | One persistent next action moves Save → Review → explicit Publish. Segmented navigation freely revisits sections; sample work and compact children precede secondary settings. Phone anchors reach child structure before a long document.                   |
| Color discipline      | 3     | Shared semantic neutral container roles distinguish document, supporting children and selected editor in both themes. Accent is confined to the current section and next action.                                                                             |
| Motion and feedback   | 3     | Shared buttons/collapsibles supply focus and disclosure behavior. Save status, retained input after failure and the persistent failure banner communicate actual state. Reduced-motion browser checks retain keyboard operation.                             |
| States completeness   | 3     | Empty Purpose teaches the first step; route loading gates unresolved identity; optional child details expose authored documents/defaults; failed writes retain the draft; published history remains a secondary disclosure.                                  |
| Detail craft          | 3     | Eight-frame state matrices have no horizontal overflow; coarse-pointer rows grow with multiline timing and nested chips. Child selection reveals its editor below the header; Done restores row focus. Measured header offset keeps Review headings visible. |

## Behavior and gates

Clean archived/read-only definitions already in Review retain saved status without a redundant primary action; returning to Work restores the useful Review action. Focused regression coverage checks both states. Authoring tests cover canonical session resolution, four root kinds, private draft versus publication, failed-save retention, reader permissions, valid child bounds, nested references, sibling blockers, responsibility through milestones, Program creation-date anchors, section re-entry and first-save continuity. Shared-editor regression confirms editability changes do not emit authored Markdown changes. Automatic daily planning does not interrupt this full-page reading/authoring surface, and ordinary navigation still offers planning.

Real browser checks demonstrate deep child editing → Review heading focus → exact Work scroll/input recovery, selected child preservation, first save remaining in Review with a separate Publish action, touch row containment, keyboard optional selection, 40px minimum tested primary actions and AA primary-action contrast in both themes. Supplemental recovery captures wait for title contrast after theme switching.

| Gate                | Local evidence                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Accessibility       | Authoring keyboard, focus, touch and measured primary-action contrast pass; the original Task creation journey also passes. |
| Responsive          | All six state matrices pass the standard overflow check through 320px and short phone.                                      |
| Theme parity        | Both themes visually inspected across the standard matrices; supplemental failed-save frames are separate evidence.         |
| No placeholder      | Real persisted local API fixture and empty-state guidance; no appearance-only content.                                      |
| Screenshot verified | Original 48-frame state matrix plus supplemental error captures; independent review accepted the final hierarchy.           |

## Remaining integration work

Complete the affected package/build checks before integration. The Task creation trace showed an
enabled server-rendered button receiving a click before client handlers were ready. Both My Work
entry points now wait for the caller session; the original creation, child review and private
capture journey passes. A separate provider regression preserves composers during same-destination
route reconciliation while retaining interruption and draft recovery on real navigation. The
standard stack has been stopped and its disposable database reset after verification. No release
acceptance is claimed by this audit.
