# Make work-template authoring easier to understand

**Reader:** The designer or engineer refining Docket's work-template authoring experience.
**Action:** Implement the presentation changes below, verify them in the real app, and commit the validated result. Do not integrate, push, or deploy it.
**Status:** Proposed implementation plan. Product code has not changed for this refinement.
**Baseline:** `2b74301da600b89a6703a1892ad29dd5b4212373` on `codex/work-templates-ship-ready`, reviewed on October 23, 2026.

## Decision

Keep the current full-window activity and four sections: Purpose, Starting work, Included work, and Review. Give new-template creation a guided sequence. Give existing-template editing direct section navigation. Reduce the header and decorative containers, make editable values recognizable, and show one primary action for the current task.

The user must understand three things without opening help: which template they are editing, what new work receives, and what their next action will do. Docket supports personal work and work across companies and nonprofits. Examples, work names, and workspace vocabulary remain data.

This is a presentation and interaction refinement. Preserve publication versions, child definitions, relative dates, Program routines, gallery copies, permissions, recurrence semantics, and recovery contracts. Do not add a template model, migration, autosave, or reload recovery.

## Why this approach

The current authoring header combines identity, publication state, save status, a changing action, and section navigation. Review also appears as a header action, a section, and a continuation button. Nested tinted containers compete with the fields. The phone section menu exposes the current position but hides the overall sequence.

A cosmetic token pass would leave those problems intact. A new editor or model would discard working behavior and expand the release risk. Refine the existing authoring composition instead. Preserve Docket's typography, colors, and shared controls rather than imitating another platform's appearance.

The previous release audit proves the checks it ran. Its visual verdict was too generous and does not establish approval for this refinement. Keep functional evidence for unchanged paths and produce new evidence for the revised interaction and presentation.

## 1. Separate creation from editing

Use presentation state to distinguish guided creation from routine editing. Keep the existing section keys and explicit section links.

- New templates start at Purpose. Continue validates the current section and advances. Users can revisit reached sections without losing values.
- Show all four step names during creation. On phones, use four equal columns with numbered markers and labels that can wrap to two lines. Do not use underlines, connector rules, horizontal scrolling, or a dropdown as the only progress indicator. Use semantic ordered navigation with the current step announced.
- Existing templates open at Starting work unless a link requests another section. All sections are directly available. Desktop uses compact section controls; phones retain a section chooser for direct navigation.
- A first save creates an ID and replaces the route. Preserve creation mode, the current section, focus, and scroll through that transition. Carry the presentation intent in the route so child-editor returns retain it. An ordinary library link opens editing mode. This state must not enter the saved template contract.
- Finishing a private draft or publishing ends guided creation. Opening that template later uses editing mode. Preserve parent return destinations when authoring an included definition.

Creation and editing may share content and validation. They must not infer their mode solely from whether a saved ID exists.

## 2. Give actions a stable location and explicit meaning

Creation uses a persistent footer inside the activity. It contains Back and one primary next action. Save draft is a secondary header action before Review when the draft is valid and has unsaved changes. Remove the header Review shortcut and the individual continuation buttons inside section content.

| Context                                 | Primary action                                        | Other available actions                                          |
| --------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| Creation, Purpose through Included work | Continue, with the destination in its accessible name | Back; secondary Save draft when valid and dirty                  |
| Creation, Review, unsaved changes       | Save draft                                            | Back                                                             |
| Creation, Review, saved private draft   | Publish to workspace                                  | Back; Finish with private draft                                  |
| Editing, any section with changes       | Save changes                                          | Direct section navigation                                        |
| Editing, Review, saved and publishable  | Publish to workspace or Publish next version          | Direct section navigation                                        |
| Editing, saved outside Review           | No forced primary action                              | Direct section navigation; quiet saved status                    |
| Pending save or publication             | The active action shows its pending state             | Prevent duplicate writes; preserve existing dismissal protection |
| Read-only or archived                   | No edit or publication action                         | Read sections and return through the existing navigation         |

Saving and publishing remain separate operations. Never label a draft save as completion of publication. Review explains the relevant sharing consequence beside Publish. A failed save retains the draft and its position. A failed publication retains the saved draft and offers retry. Neither failure returns the user to the library.

Editing keeps its save action in the compact header. Do not add a creation footer containing Back and Continue to routine editing. If Review contains unsaved edits, Save changes takes precedence until persistence succeeds.

## 3. Reduce containers and use the space for work

- Keep a small contextual back row, the template title, quiet state text, and the relevant action. Remove the prominent enclosing header surface and redundant kind/definition labels. Retain workspace context where it prevents editing the wrong workspace.
- Use one aligned content region. Start with a roughly 760px readable form width and expand document or outline sections only where their content benefits. Do not stretch a short form across the full activity or add a second column just to occupy space.
- Use a common left edge for section titles, labels, fields, outline rows, and footer actions. Use one phone inset rather than nested gutters.
- Remove decorative nested surfaces around whole sections and around already grouped included-work content. Use spacing and type hierarchy to group content. Keep shared surface treatments where they identify a control, disclosure, or interactive row.
- Keep included work and recurring Program work visibly distinct through headings and their existing behavior. Avoid extra cards and summary counts that repeat what the visible rows already show.
- Use one main scroll owner. Reserve footer space, including the phone safe area, so it never covers the editor or final row. Long names must wrap without squeezing actions out of view.

No horizontal hairlines, underlined tabs, custom dialog primitives, or arbitrary new colors are part of this change.

## 4. Make fields and language consistent

Use shared field labels and control treatments for editable values. A person must not have to click a heading to discover that it is an input. Keep row actions beside the row they affect. Use chevrons only for controls that open another surface, and preserve accessible names and touch targets.

Use “template” consistently in user-facing authoring copy. Keep “definition” as an internal term where needed. Distinguish the template's library identity from the content copied into new work:

| Current ambiguity                              | Intended wording or treatment                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| A name with no clear owner                     | Template name                                                                   |
| Description whose purpose is unclear           | When to use it, with the existing optional description value                    |
| Starting name                                  | Name for new work, using the workspace's work-kind noun when it reads naturally |
| An editor that resembles fixed headings        | Labeled document editor with a recognizable editable surface                    |
| Repeated instructions about the template model | One short explanation at the field that needs it                                |

Keep the existing four section names for this pass. Review their meaning in context rather than introducing another vocabulary overhaul. Do not add enterprise phrases such as “process rollout” or explanatory AI-generation language. Empty optional values must remain empty rather than acquiring invented content.

## Implementation order and ownership

1. Record the new work in `docs/WORKLOG.md`. Capture the current real-app Purpose, Starting work, Included work, and Review states with the same persisted fixture. Read `docs/engineering/ui-verification.md` before starting the stack.
2. Add explicit creation/editing presentation state in `work-template-authoring.tsx`. Preserve it through first save and nested authoring. Extend focused behavior coverage before changing navigation. Do not route the current authoring experience back through the older `template-workflow-shell.tsx`.
3. Refine `template-definition-navigation.tsx`, `template-definition-sections.tsx`, and `use-template-section-navigation.ts`. Preserve mounted editor values, per-section scroll, remembered focus, keyboard activation, and existing deep links. Use shared primitives; add a domain-neutral primitive only if existing controls cannot support the required behavior.
4. Make `template-definition-action.tsx` own the action policy above. Keep persistence in `use-work-template-form.ts` and the existing mutation layer. Share action decisions between header and footer without duplicating mutation state.
5. Refine `work-template-fields.tsx`, `work-template-blueprint-fields.tsx`, and `work-template-definition-review.tsx` as needed for alignment, labels, row grouping, and review hierarchy. Leave unrelated creation composers and the library layout alone.
6. Inspect each revised state in the actual app before expanding the change. Fix phone density and action visibility during implementation, not after a final screenshot batch.
7. Update `docs/core/work-template-ui.md`, add a dated craft audit, and finish the worklog with the checked commit and evidence. Commit the validated refinement on the dedicated branch.

All component paths above are under `apps/web/src/components/templates/`. Follow their current ownership when extracting small components. Do not increase the complexity ledger.

## Verification and acceptance

Add focused behavior tests for creation/editing mode, validation before advancement, first-save continuity, child-editor return, save/publish action precedence, pending duplicate prevention, and failures that retain inputs. Keep existing permission and publication tests intact.

Run the eight existing `apps/web/e2e/work-template-*.spec.ts` suites with one browser worker against the final implementation. Cover all four work kinds and renamed workspace vocabulary. Reuse existing fixtures and recovery scenarios rather than replacing them with visual-only smoke tests. Adjust assertions only when the intended user-facing behavior changes.

Run affected component tests with at most two workers. Run affected package typechecks and lint through Turbo with concurrency two, then the repository complexity and documentation checks. Run the affected production build through the existing release tooling. Broaden persistence acceptance only if implementation changes persistence paths; unchanged backend behavior does not require a new backend redesign or repeated unrelated test graphs.

Capture authenticated desktop at 1440×900 and phone at 390×844 in both themes. Also inspect 320px width and a short phone viewport. Include empty and populated templates, long names and documents, expanded child/routine controls, read-only state, dirty navigation, pending saves, save errors, and publication errors. Exercise keyboard and touch navigation, focus restoration, contrast, scrolling, and visible actions.

The refinement passes only when the rendered evidence demonstrates all of these outcomes:

- A new user can identify the template, its copied content, and the next action without reading supplementary explanation.
- Creation shows its sequence on a phone without clipping. Editing allows direct section access without wizard controls.
- Each state has at most one primary action. Saving and publishing have distinct labels and consequences.
- Fields look editable. Related controls align, row actions stay nearby, and empty content does not produce a large decorative frame.
- The document and included-work structure receive more attention than status badges and navigation containers.
- No horizontal overflow occurs at 320px. The keyboard and sticky footer do not conceal focused fields or actions.
- Drafts, permissions, versions, optional children, manual overrides, and recovery behavior retain their current guarantees.

Score all eight Docket Craft Rubric dimensions from fresh screenshots. Treat failed dimensions or inaccessible checks as unresolved work. Passing automated tests alone does not establish visual acceptance. Stop the owned local stack and clean verification fixtures afterward.

## Delivery boundary

The first implementation review should show the real creation and editing experiences in both themes at desktop and phone widths. Do not produce another standalone prototype. The final handoff must name the commit, checks, screenshots, remaining limitations, and any external release gates. This plan authorizes no integration into main, push, deployment, API change, or database migration.
