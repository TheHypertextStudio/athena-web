# Gallery and organization work: design direction and integration map

## Decision

Make the gallery an entry into the existing organization work model: **choose an outcome → inspect the actual work → review the copies → keep private drafts or explicitly publish → create the first real item**. The useful object is an Event, Client engagement or Fundraising campaign with an understandable structure. Catalog selection is a means to that outcome.

Use the accepted Purpose / Work / Review authoring model, semantic work outline, and separate Included work / Recurring work branches as the continuation of this journey. Avoid a second editor or an onboarding-only configuration experience.

Grouping follows the person's task before the work kind. The library leads with **Continue defining**
for unfinished personal and authorized team drafts, including unpublished edits to existing
publications, then **Ready to use**, with blank **Defaults** and archived definitions in
subordinate disclosures. Current authorized references place supporting definitions beside the work
that needs them, preserving shared relationships and exact version identity. Published names and
draft names remain distinct. Search and kind filtering remain available for expert use; kind is
supporting row information rather than another heading level. Permissions are management, not a
step in choosing work. An empty ready-to-use group offers starting work and ordinary definition.

The copy review starts with the selected work, preserving the chosen outcomes and their order.
Purpose groups carry clear headings; kind is supporting information. The first useful group opens,
and other groups expose counts and focused details on demand. Required definitions remain subordinate.
Adjustments and omissions belong beside the work they affect; destination and visibility sit beside the final action. A complete
60-definition fork must stay complete without mounting 60 expanded outlines or making someone scan
an undifferentiated list. A single selection opens directly without redundant outcome or kind
headings. Inspect is an explicit action with a truthful included-work summary. Preserve group state
and return focus after inspecting a definition. Supporting instructions follow included work and
routines; fork facts have a real loading state rather than a temporary zero-result claim.

This design governs implementation. Acceptance requires current authenticated interaction and responsive evidence.

## Inspected baseline and concrete implications

- `docs/engineering/specs/work-template-gallery-athena.md` governs copies, every-plan manual access, explicit visibility, exact dependencies, omissions, provenance, private bundles and Athena review.
- The existing work-definition authoring audit establishes the outline, focused editor and responsive baseline. Gallery acceptance must verify its own complete journey.
- Current authoring already has a large definition header, ordered parent/Included work/Recurring work outline, one focused editor, meaningful child documents, and explicit return/focus restoration. Gallery detail and copied-draft review should reuse these relationships.
- The saved short-phone composer shows why a separate routine region is useful, but also why a gallery review cannot place several configuration panels above the selected structure. One short action bar and one main scroll owner are sufficient.
- The prior settings list grouped workspace templates by kind. The library now groups by readiness
  and actual relationships, with gallery navigation and expert search. Permission administration
  stays subordinate to discovery and definition.
- Existing onboarding exposes three informational intents: personal, startup and nonprofit. Its public `OrgCreate.intent` has those three values. Agency is a supported vocabulary preset and a supported gallery fork, but is not an accepted organization intent. Do not send `intent: agency` or silently change vocabulary as a side effect of choosing gallery material.
- Unsaved template prose currently survives navigation in session-scoped tab memory (`work-template-form-draft.ts`). It is not a durable saved draft. A Keep action must persist real canonical drafts/bundle metadata before any Saved or Resume claim.

## Collection facts and exact scope

The current metadata contains **110 entries**, not 110 suggested next actions. Categories contain Intake 17, Engineering & product 11, Marketing & content 12, Sales & clients 10, Operations & finance 13, People 9, Nonprofit 14, Events 8, Research & writing 6, Personal 10.

Approved fork membership overlaps: startup 60, nonprofit 47, agency 46, personal 14. These are exact eligible sets derived from catalog metadata, not an estimate of workspace behavior. Some research entries are gallery-only. Two Renewal entries remain distinct by kind, intended use, slug and exact source identity.

Preserve the approved full-fork operation. **All nonprofit work (47)** selects every marked nonprofit root; equivalent full selections exist for the other forks. Do not label a smaller recommendation as the full fork, quietly skip members or install only the first loaded page. Before acceptance, show the complete selected root set and full deduplicated transitive closure. Root selection and dependency counts are different facts.

A clearly named **Choose starting work** path may select a smaller subset. It starts with no implicit selection. Suggested outcomes offer a small number of relevant roots, but selecting each is an explicit action. The entire fork remains available under All nonprofit work; every catalog entry remains available through Browse all templates. Recommendations never claim imported usage, popularity, recent activity or evidence that was not actually observed.

## Navigation

1. **Work templates** is a dedicated full-page workspace destination beside the work destinations. Unfinished work comes first, with explicit continuation and current prerequisite links. Each work definition retains its available publication beside its unpublished edits. Compact Define another kind and Find controls remain reachable without promoting the gallery over returning work. Authoring permissions alone remain in Settings. **Continue defining** brings unfinished drafts back into the flow. **Choose starting work** opens the gallery; **Define work** starts the canonical editor. Preserve current private/team/published distinctions and exact version links.
2. **Choose starting work** is a discoverable entry from the created workspace's first-use surface and Work templates. It deep-links into the same gallery, carrying an explicit fork context. Skipping it leads to usable ordinary work; it stays reachable later.
3. **Gallery** has Suggested and Browse all views. Suggested is contextual and small. Browse all is a grouped searchable list, not a second home dashboard. Selection survives both views.
4. A real link opens **Gallery / Event** detail. Browser Back returns to the same query, group expansion, selected roots, scroll position and focused row. A detail page supports copying its URL without carrying private source bodies or permission-bearing tokens.
5. **Review selection** opens a full route. Do not stack an install dialog over a gallery detail over the existing editor. Full review is revisitable; selected work precedes adjustments, then the explicit destination/publication decision.
6. **Saved draft bundle** becomes a reenterable destination after Keep. It links to the existing canonical editors, with bundle overview and required publication order. A successful published install instead returns to the workspace library and offers ordinary creation from a copied root.

Proposed route map under the existing settings area:

| Destination       | Route shape                                              | Persisted/URL context                                                                     |
| ----------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Workspace library | `/orgs/[orgId]/work-templates`                           | Existing authorized workspace scope                                                       |
| Gallery browse    | `/orgs/[orgId]/work-templates/gallery`                   | `view`, `fork`, `category`, `targetType`, `search` and current cursor/filter-bound paging |
| Catalog detail    | `/orgs/[orgId]/work-templates/gallery/[slug]`            | Actual release namespace and slug; return query retained                                  |
| Copy review       | `/orgs/[orgId]/work-templates/gallery/review`            | Owner-scoped review state; actual server preview fingerprint, never authority             |
| Saved bundle      | `/orgs/[orgId]/work-templates/gallery/copies/[bundleId]` | Authorized persisted copy bundle/entries, not a fabricated template publication           |

Register these in the existing typed route/query/navigation system. Literal gallery/copies routes take precedence over the existing `[templateId]` route. The URL may retain public catalog filters. Private draft content, source workspace identifiers and accepting principal metadata stay out of shareable query strings.

## Decision order and plain copy

### 1. Choose an outcome

Heading: **What would you like to organize?**

Supporting line: **Choose reusable work for [workspace name]. You can change it before anyone uses it.**

Fork control: **Starting points for Nonprofits** with Change. A secondary link reads **Browse all templates**. A separate full-set action reads **All nonprofit work (47)**; activating it selects the exact complete fork and reveals the selection count, then offers Review selection.

Present at most three outcome groups initially. Each group has a descriptive heading, one sentence and two or three actual catalog rows. Grouping is editorial navigation over existing categories and identities; it does not invent new stored work kinds or mutate fork membership.

| Fork      | First outcome groups, in order                                                | Actual example roots                                                                         |
| --------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Startup   | Ship a product; Keep delivery moving; Publish useful updates                  | Product launch / Product release; Bug report / Incident; Content calendar / Newsletter issue |
| Nonprofit | Deliver your program; Bring people together; Fund your work                   | Program delivery / Cohort; Event / Community event; Fundraising campaign / Grant application |
| Agency    | Run a client engagement; Deliver a campaign; Keep the business running        | Client engagement / Proposal; Campaign / Content calendar; Month-end close / Invoice run     |
| Personal  | Keep up with everyday work; Plan something ahead; Make room for a longer goal | Weekly review / Renewal; Trip / Move; Side project / Learning a skill                        |

These are optional recommendations, not full fork installations. Do not silently preselect the table. Every row shows its actual kind using workspace vocabulary and its concrete use sentence. A person can choose a simple Task without choosing a larger Program or Initiative. Catalog copy never starts a recurring run by itself.

### 2. Make the primitive concrete

Do not ask new users to choose among four abstract data types before showing useful work. A selected outcome reveals the real kind and the relevant one-line explanation:

- Initiative: **Connect related projects and programs around an outcome.**
- Program: **Keep ongoing work and its recurring routines together.**
- Project: **Deliver one outcome with its tasks and milestones.**
- Task: **Track an action, with subtasks when it needs them.**

Only the selected kind's explanation is necessary. Custom workspace nouns replace the visible kind label through `useVocabulary`; API kind and semantic structure remain unchanged. A reusable template does not become a new entity kind.

### 3. Inspect actual included and recurring work

Detail leads with Event, its kind and use sentence. Then show **Starting work**, **Included work**, and, only when present, **Recurring work**. Keep root identity once. The outline is the same authored sibling order and semantic nesting used in the editor.

Event example:

```
Event · Project
Included work
  Book venue · Task · 21 days before the Event date
    Get quote
    Confirm
    Pay deposit
  Promote event
  Confirm headcount
  Run event
  Send thank-yous
```

Use the actual released definition and resolved catalog closure for the precise rows and offsets. The example is a composition rule, not permission to add missing children or hard-code a different catalog outline. Parent → child → subtask relationships must be visible. A row expands or opens its document, actual timing, dependencies and responsibility rules; it does not produce a coequal card for each property.

Program example: Client engagement has Included work → Kickoff and Recurring work → Monthly client report. The recurring row summarizes the real rhythm and template reference. Its detail shows name pattern, beginning relative to Program creation, responsibility and exact referenced release. **These routines begin when you create a Program from this template. Each Program gets its own editable copies.** No next-run date or previewed live title is inferred while the Program does not exist.

Collapsed Included work retains its child count. Recurring work remains reachable without traversing a long child branch. Preserve optional markers and actual selected defaults; definitions can be adjusted in the canonical editor after private copying. Gallery selection itself selects reusable roots, not optional generated work instances.

### 4. Review the complete copy

Review order is **What you chose → Required templates → Destination and visibility → Adjustments → Confirm**. Desktop places the known work hierarchy beside consequences; phone follows that linear order. The four decisions are not four nested modal dialogs.

- **What you chose:** selected root names/kinds, exact release version and a Remove action. Group long selections by category with selected counts. First group expanded; all groups available. Removing a root recomputes closure and preserves every unrelated choice.
- **Required templates:** **Event also needs Vendor booking. It will be copied once.** Required dependency rows cannot be deselected while referenced. Explain the requiring root(s); do not duplicate a shared dependency for each parent. Distinguish root selections from total reusable definitions. No generated-work counts unless computed by the canonical planner for that exact preview.
- **Destination:** actual workspace name remains visible. Mode choices are **Keep private drafts — Only you can review these copies** and **Publish to [workspace] — Members can see and use the published templates**. Default private; public choice is intentional. A person's current authoring policy still applies on every plan.
- **Adjustments:** meaningful label/image omissions and optional offering suggestions, grouped by affected template. Show **Bug label is not mapped. This copy will have no Bug label.** Offer **Choose a label** and **Leave out**; do not create a label automatically or match it silently by display name. Image warning: **1 image will be left out because it cannot be copied here.** Do not print storage identifiers or inaccessible source URLs.
- Team offerings are subordinate to visibility: **Offer in team creation menus**. Explain **Published templates are visible throughout this workspace. Offerings choose where people can start new work with them.** A Design/Marketing suggestion is unconfirmed text until an authorized administrator chooses actual destination teams. Non-admins can continue lawfully without pretending the suggestion became an assignment. Use destination permission/omission response, not a client-imagined grant.
- People, cycles, provider connections, absolute work dates and old receipts are not copied. Summarize actual dropped fields where relevant. Avoid a wall of empty No owner / No cycle / No estimate rows.

Private-mode primary: **Keep private drafts**. Publication-mode primary: **Add to [workspace]**. Adjacent copy: **Creates [N] independent reusable templates. Existing work stays as it is.** Add **This does not create work or start schedules** for Program-heavy selections where the consequence could be misunderstood. No second generic Are you sure dialog after this concrete review.

Origin disclosure: **From the Docket gallery · Release 1**. Destination version is a separate fact shown only after the server assigns/publishes it. The publication's own number is not relabeled as the catalog release. Updates are separate reviewed copies/updates; no auto-sync promise.

## Browse organization, search and selection

- Browse all uses the ten actual category labels, in stable authored order. A category rail on desktop and one Category filter on phone replace ten top-level tabs. Start with the current fork's context; All audiences is one deliberate choice. Do not pretend every category belongs to every fork.
- Default sorting follows server-authored category/entry order. Search should prioritize a matching exact name, then other supported matches only if the server explicitly exposes that ranking; otherwise preserve returned order. Do not client-sort paginated results into an apparently complete ranking. An alphabetical option requires a coherent server cursor/sort contract before exposing it.
- First entry leads with organizational context and suggested outcomes. Search and taxonomy are secondary exploration controls. Optional Category and Work kind controls open a compact filter region. Applied filters remain visible and removable; Clear filters restores all results without clearing selection. Search does not clear selected roots.
- Desktop rows show name, kind and one use sentence; phone shows the same information in two or three lines. No badges for all fork tags on every row. Renewal rows state **Client renewal · Project** versus **Personal renewal · Task** in supporting use context without changing their immutable names/identities.
- Selection is a native checkbox beside a real detail link, not a checkbox inside an anchor/button. Select-all controls have explicit scope: **Select this category (12)** or **Select all 47 nonprofit templates**. Never use an ambiguous Select all after search/paging. Group checkboxes expose indeterminate state through the shared primitive.
- A compact selection region reads **3 selected** and offers **Review selection**. It remains in a stable location. On phone it is one bottom action row; the selected count opens the selected list. Removing the final root disables Review with a clear Choose at least one template explanation.
- A dependency already copied within this request is one entry. A previously installed independent copy is not silently reused, replaced or overwritten. If the service detects a prior receipt, show its actual idempotent result; a deliberately new copy requires a new explicit request.

## Saving, returning and recovery

Before Keep, filters/selection/form choices may survive navigation within an account-scoped review session. Do not label browser memory Saved. The current template form's tab cache must not be used as evidence of reload/cross-device persistence. A durable pre-accept review-draft claim requires a separately implemented typed persisted review state; do not stuff catalog selections into a Task/Project composer draft or fake a PlanNode.

**Keep private drafts** is the durable checkpoint already required by the copy contract: one real canonical private draft per copied definition plus its persisted bundle entries. After acceptance show **[N] private drafts kept** with **Open drafts** and a bundle deep link. Reopen loads current authorized server drafts and exact reserved dependency identities. The private bundle remains visible only to its authorized acceptor, even when its destination publications later become workspace-visible.

The bundle overview shows Selected work, Required drafts and publication readiness. **Continue reviewing** opens the selected root in the existing Purpose / Work / Review editor. **Review publication** rechecks the actual closure, saved edits, current authoring rights, label/offering choices and exact fingerprint. Publishing dependencies is explicit and follows the ordinary writer/reservation rules; no hidden auto-publish on opening or editing a parent.

After published installation: **[N] templates added to [workspace]**; **Create an Event** (or the selected root's actual kind/name) opens the ordinary composer with the copied publication. **View templates** is the secondary destination. Multiple roots require choosing which first item to create. Actual Program creation reviews included work and schedule copies in the existing composer, preserving the accepted layer3 behavior.

State copy and behavior:

| State                           | Behavior and application-owned copy                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Loading catalog/detail          | Stable skeleton rows/outline; preserve prior selection and query; no empty-state flash                                                                                                                 |
| No results                      | **No templates match these filters.** Clear filters; keep current selected roots                                                                                                                       |
| Preview rejected/too large      | **This selection could not be prepared.** Show actionable bounded reason (e.g. Choose fewer templates); preserve roots and decisions                                                                   |
| Stale source/choices            | **This review changed. Review the updated copies before continuing.** Refresh computed facts, retain authored decisions where still lawful, require fresh explicit acceptance                          |
| Permission revoked              | **You can no longer add templates here.** Preserve lawful local choices; offer workspace library/back. Do not disclose hidden sources or pretend retries can bypass policy                             |
| Write failure                   | **Could not keep these drafts** / **Could not add these templates**. Keep review and offer Retry using the same request ID; do not mint a second bundle                                                |
| Unknown write outcome           | **Checking whether your templates were added…** Reconcile the persisted receipt before presenting Retry or success                                                                                     |
| Undo                            | Existing aggregate undo; report only safe retained/conflicted outcomes. Independently edited or used copies remain recoverable. Never reveal identities/counts of hidden work that protects a template |
| Archived/unavailable dependency | Explain the authorized retained source/version or require an updated selection; no implicit latest fallback/name matching                                                                              |
| Catalog/new release             | Show actual origin and offer a separate reviewed update; continue using installed independent copies                                                                                                   |

## Manual onboarding and optional Athena

Do not introduce an unreviewed fourth `OrgCreate.intent`. After the existing wizard has created a real workspace, show an optional **Choose starting work** entry. Its gallery Audience chooser supports all four catalog forks independently. The initial suggestion can use the saved informational intent; changing it to Agency changes catalog recommendations only. If a later product slice genuinely adds Agency to initial organization creation, it must update organization DTOs, shared types, persistence/telemetry, wizard branching/copy, vocabulary rules and save/reentry tests together. Do not derive personal/shared ownership from a gallery fork.

Manual starting-work selection, full-fork copying, private drafts, publication, ordinary creation and schedules work on every plan. Athena is a secondary **Ask Athena to tailor this** action, shown with accurate capability/policy availability. It never intercepts or gates the manual Continue action. No connector, account upgrade or conversation is required to use curated material.

Athena's tailored proposal appears in the existing Inbox with the actual persisted proposal/session provenance. **Keep draft**, **Adjust**, **Dismiss**, and lawful **Undo** execute checked review transitions; Mark read is separate. Generated copy says **Suggested by Athena** and names the authorized context in a safe summary; it does not imply observed usage without evidence. Adjust opens the same canonical editor after the correct private materialization/checkpoint. Publication remains a person's explicit decision.

## Visual composition and interaction treatment

Carry MD3 Expressive through hierarchy and response rather than adding decoration: a clear outcome headline, recognizable work glyphs, useful tonal grouping, selected emphasis and a responsive outline/detail transition. Preserve Docket's concise voice and actual work content. Do not use a marketing illustration above every group or 110 independent cards.

- Outer workspace/detail/review regions use shared `Surface shape="large"` (16px). Inset document/consequence wells use `shape="medium"` (12px). Flat list rows do not each receive a resting card. Keep shared control radii/size tokens, including their existing 8px control treatment; the 16/12 container direction is not a global control override.
- One prominent header groups page identity, destination and the main action. One selected detail surface owns content. Neutral tonal steps establish structure; accent identifies selection and the primary action. Warning/error tone appears only for actual attention.
- Use semantic MD3 headline/title/body/label tokens. The work name is stronger than kind/version; purpose is stronger than technical origin. Version/provenance is readable supporting information, with full detail on demand.
- Desktop browse uses a compact category/context rail and one useful row list. Detail/review then uses the accepted outline plus focused content/consequences composition. Avoid a three-pane catalog+outline+editor at 1100px content width.
- Phone has one main page scroll owner. A selected child/detail replaces the outline region with an explicit **Back to outline** action; the return restores branch, selected row, scroll and focus. Do not mount independent 300px inner scroll boxes for every branch.
- Header shrinks on short phones to identity, current section and one action. Footer avoids multiple explanatory paragraphs above the primary button; consequences remain in the body. Add safe-area and measured footer/header scroll insets so the last row and focused field cannot be obscured.
- Feedback changes state promptly. Pending acceptance keeps the button width stable and says Keeping… or Adding…. Do not delay ordinary navigation for decorative animation. Reduced motion retains every relationship via direct state changes.

## Keyboard and accessibility contract

Use actual links for navigation, native checkbox semantics for selection, shared disclosures for groups, and buttons for actions. Separate the detail link and selection checkbox in the row's layout; never nest interactive controls. Tab order follows content order. Space toggles a checkbox; Enter opens the focused link/action. Shared Tabs handles its existing arrow/Home/End pattern only when there are actual tab panels. Page destinations should use link navigation, not misleading tab semantics.

Collapse/expand does not lose selected descendants. Return from detail restores the originating row and expansion; removal focuses the next logical selected row or group heading. Opening the filter overlay traps focus through the shared Dialog/Sheet, Escape dismisses and restores its trigger. Plain section/group disclosures do not trap focus.

Announce selection count and completed preview changes politely without announcing the whole tree on each keystroke. Errors are application-owned text, associated with the affected choice, and an attempted submission focuses an error summary/first invalid decision without clearing valid input. Source/version/visibility labels are textual, never color-only. Preserve selectable documents, long names, Unicode and browser text editing. Do not claim a screenshot establishes screen-reader or keyboard acceptance.

## Concrete code integration map

| Existing seam                                                                                                       | Required integration                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/components/templates/work-template-settings.tsx`, settings templates routes/registry                  | Group ready-to-use work and private/team drafts by purpose, then kind; subordinate defaults, archive and permissions; add real gallery and saved bundle links while preserving authorized scopes                                                                                                                   |
| `apps/web/src/lib/app-location`, typed route/nav registry                                                           | Register gallery, detail, review and bundle routes; real links; retain filter/query/back context without private body data in URLs                                                                                                                                                                                 |
| `apps/web/src/lib/query.ts`, `work-template-queries.ts` pattern                                                     | New gallery query definitions/list/detail/preview mutations use `apiQueryOptions` and def-only typed hooks; current authoring setting/offerings fetched through their existing typed services; no component fetch/useEffect data layer                                                                             |
| `domains/work/src/contracts/template-gallery.ts`                                                                    | Consume actual browse/detail/preview identities, complete copy vector, roots, omissions, mode and fingerprint. Distinguish catalog release from destination publication; no fabricated `WorkTemplateOut`/version/step rows                                                                                         |
| `apps/api/src/lib/template-gallery/{catalog,preview,choices}.ts`                                                    | Existing in-progress authorized list/detail/preview seam. Full-fork selection requires all matched slugs across pagination or a checked explicit fork-selection service; no first-page Select all. No UI sort/facet promise beyond service output                                                                  |
| New `components/templates/gallery/` presentation leaves                                                             | Outcome groups, searchable row list, root selection state, actual catalog detail, transitive review, copy result/bundle overview. Keep data adapters separate from reusable structure rendering                                                                                                                    |
| `work-template-blueprint-workspace.tsx`, `work-template-blueprint-outline.tsx`, `work-template-review-children.tsx` | Reuse their nesting/order/disclosure/focus conventions. Extract read-only structure presentation if needed; catalog source resolver is honest catalog identity, workspace draft resolver is authorized draft, publication resolver is actual publication. Do not spoof catalog dependencies as workspace templates |
| `work-template-authoring.tsx`, `template-definition-sections.tsx`, `use-template-section-navigation.ts`             | Continue copied real drafts through existing Purpose/Work/Review; preserve header measurements, focus/scroll, authored child order and current permission checks                                                                                                                                                   |
| `program-default-schedule-{outline,review,workspace}.tsx`                                                           | Render actual copied Program defaults with Included/Recurring distinction; no live run activation during template installation                                                                                                                                                                                     |
| `template-definition-action.tsx`, ordinary canonical copy/publication services                                      | Explicit private Keep and reviewed publish; exact reserved dependency handling and existing writer; no second editor/publication transaction in UI                                                                                                                                                                 |
| `apps/web/src/components/onboarding/{step-intent,types,wizard-shell}.tsx`, onboarding page                          | Preserve current organization creation; optional post-creation Choose starting work entry links to four-fork gallery selector; do not submit agency as a current intent                                                                                                                                            |
| Existing Inbox proposal/action/notification components and services                                                 | Typed template-review detail and actual Keep/Adjust/Dismiss/Undo transitions; mark-read remains independent; Athena availability does not gate manual flows                                                                                                                                                        |
| `@docket/ui/primitives`                                                                                             | Surface, Button, Checkbox (including indeterminate), Input/Field/Select, Chip, Collapsible, Dialog/Sheet, Skeleton, Separator, shared control tokens. Extend a neutral primitive when needed instead of drawing custom panels/menu/dialog infrastructure                                                           |
| `@docket/ui/components`                                                                                             | EntityList/EntityListRow for real linked browse rows, with sibling checkbox; InlineBanner for contextual attention. A complex keyboard ListView is optional only when it provides real value without creating nested grid/checkbox semantics                                                                       |

Known implementation requirements, not present-tense claims: saved bundle browse/detail/accept/publish/undo routes and durable resume UI depend on root's storage slice; catalog detail needs honest transitive resolution for nested read-only rendering; any new sort/facet summaries require matching typed API contracts; pre-accept cross-device review persistence is not supplied by the current tab-memory editor cache.

## Acceptance before calling the new flow usable

Use actual all 110 metadata, approved fork totals and a populated destination, not a dozen simulated cards. Test startup/nonprofit/agency/personal selection, gallery-only research, both Renewals, Event→Vendor booking, Fundraising campaign's Projects and Client engagement's Kickoff/report routine. Include long root/child names and a complete full nonprofit fork.

| Scenario                          | Required observable outcome                                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-use manual path             | A new person finds an outcome, names the actual primitive/children, predicts private vs published result and reaches a useful copied template without Athena or an upgrade                           |
| Exact full fork                   | All 47 nonprofit roots selected, full list reviewable, transitive dependencies deduplicated; filtering/paging never silently changes selection                                                       |
| Curated subset                    | Choose starting work selects only explicitly chosen roots; UI never presents it as the complete fork                                                                                                 |
| Structure comprehension           | Person distinguishes included Kickoff from recurring Monthly client report, Project child from Task/subtask and copied reusable template from actual work                                            |
| Private checkpoint/reentry        | Keep persists real drafts with zero publications; reload/new session on another supported device resumes the authorized bundle and independent child edits                                           |
| Published installation/first work | Explicit publication uses current policy/offerings; creates copies only; ordinary Create from template then creates the reviewed actual work and Program-owned schedule copies                       |
| Navigation/expert flow            | Search→detail→Back retains query/selection/scroll/focus; repeated named-template retrieval takes search, one selection and Review without repeating first-use guidance                               |
| Failure/undo                      | Stale409 and rejected writes retain choices; same request reconciles/retries once; undo preserves edited/used copies and does not leak hidden protecting work                                        |
| Permission/privacy                | Non-admin authorized manual copy works; changed authoring rights fail safely; private bundles/proposals and source identifiers do not leak after destination publication                             |
| Keyboard/screen reader            | Entire select/filter/detail/review/keep/reopen/publish flow works without pointer; selection/heading/error announcements are coherent; no nested interactive controls or focus trap outside overlays |
| 1440×900 desktop, both themes     | Useful category/list and outline/detail relationships, readable full consequences; no decorative empty pane or duplicated identity                                                                   |
| 390×844, both themes              | Selection/action and actual work hierarchy remain legible; filter/detail return restores exact context                                                                                               |
| 390×600 short phone, both themes  | Long review and selected child can reach final action without a footer/header obstruction; routine branch remains reachable while children collapse                                                  |
| 320×844, both themes              | No horizontal overflow; names/visibility/actions wrap; nesting indentation is capped and remaining hierarchy stays semantic                                                                          |
| Zoom/motion/long content          | 200% zoom and larger text preserve controls/content; reduced motion preserves usable transitions; long document and 24-child branch does not lose outline/action reachability                        |

Record actual captures and interaction evidence using the repository's existing stack/session/capture procedure when implementation is ready. Saved baseline frames support continuity decisions; they are not evidence that this proposed gallery flow exists or passes these conditions.
