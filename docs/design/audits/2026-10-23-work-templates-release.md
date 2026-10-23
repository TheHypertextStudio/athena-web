# Work-template release verification

Reader: A Docket maintainer deciding whether to integrate the work-definition feature.

**Verdict: SHIP within the local delivery boundary.** All required feature checks and rendered craft gates pass.
The final source starts from ac65111fafff3ea8815c637851d43bb46f20d200 on
codex/work-templates-ship-ready. The old feature/work-template-ui branch remains intact at de31fafc4.
This delivery stops before integration, push and deployment.

## Reconciliation

Current main already supplies versioned definitions, blueprints, Program routines, gallery copies
and schedule management. Its focused Purpose → Starting work → Included work → Review activity
supersedes the original Basics/Work/Review template dialog. The compact library remains intact.
The original three commits were compared rather than replayed over current authoring.

| Original requirement                                    | Status                    | Evidence                                                                                                       |
| ------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Create/edit four kinds, metadata and sharing            | Implemented               | Identity and workflow browser suites; authoring component coverage                                             |
| Large template setup with persistent section values     | Superseded                | Focused activity, retained editors, desktop tabs and phone section menu                                        |
| Starting fields and document editor                     | Implemented               | Four-kind persistence, long-document and keyboard coverage                                                     |
| Included work, optional children and relative dates     | Implemented               | Authored-blueprint, creation and update browser suites                                                         |
| Review before creation; stale review rejection          | Implemented               | Concurrency API coverage; stale-publication browser case passed                                                |
| Publication, revised versions and template changes      | Implemented               | Identity/update browser cases; authorization and publication API suites                                        |
| Standalone repeat setup and management                  | Implemented               | Persisted schedule revision, management overlay and history browser cases                                      |
| Program routines and independent installed copies       | Implemented               | Program browser suite, API recovery and schedule component tests                                               |
| Gallery preview, copy recovery and undo                 | Implemented               | Gallery browser suite and real PostgreSQL copy acceptance                                                      |
| Dirty dismissal, failure recovery and focus restoration | Implemented               | Browser and component recovery cases; phone menu touch and Escape checks passed                                |
| Phone archive pagination                                | Already corrected on main | Compact Previous/More labels; actual first/last-page captures and browser case passed                          |
| Workspace vocabulary; names/examples remain data        | Implemented               | Vocabulary-backed fields, renamed definitions and editable fixture data                                        |
| No duplicate setup after lost committed responses       | Corrected                 | Atomic receipt routes on PostgreSQL and real browser response-loss case                                        |
| Active workspace link announcement                      | Corrected                 | Actual Slot integration regression and workspace assertions passed; six no-retry navigation repetitions passed |

## Corrections

Repeat setup could commit a definition or series, lose its response, and create another resource on
retry. Independent Idempotency-Key headers now identify the unchanged definition and schedule
requests. Each resource and its canonical receipt commit together. Replays recheck current access
and resume initial work on the original schedule. The request bodies and recurrence semantics stay
unchanged. Receipts last 48 hours; the browser retains retry identity only while the dialog remains
mounted. Closing, reloading, or changing input does not provide cross-session recovery.

The shared link wrapper explicitly passed an undefined aria-current value through Slot. That
removed the parent navigation item's active-page announcement. The wrapper now omits an absent
value. Pending links still suppress current-page announcements until navigation completes.

Rendered review found organization-only empty-state wording, a heading that repeated arbitrary
names, horizontal tab rules, a Program section divider, and phone tabs that hid Review. The final
surface uses generic human-facing copy, a constant Starting work heading, shared contained tabs on
desktop, spacing between Program groups, and a phone control that shows the current step and all
four choices. The menu returns focus to the selected panel after releasing its focus trap.

## Verification evidence

Local evidence lives in .data/design-review/work-ship. The checks directory retains command logs.
The studio directory retains authenticated screenshots, declarative scenarios and capture records.
The local release handoff records the final commit and verifies its files against the tested-source
manifest. Documentation-only edits are excluded from its code fingerprint.

| Check                                                       | Result                                                                       | Log                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Work-template, gallery, Program and recurrence API coverage | 529 tests / 80 files passed                                                  | work-ship-api-acceptance.log                                                        |
| Receipt boundary, OpenAPI, contract and security coverage   | 148 tests / 15 files passed                                                  | work-ship-api-contracts.log                                                         |
| Work-template domain coverage                               | 175 tests / 16 files passed                                                  | work-ship-domain.log                                                                |
| New receipt routes on PostgreSQL 18.6                       | 16 scenarios passed                                                          | work-ship-retry-postgres.log                                                        |
| Final definition replay effects on PostgreSQL               | 6 selected tests passed                                                      | work-ship-definition-final-pg.log                                                   |
| Existing PostgreSQL gallery-copy acceptance                 | 4 tests / 2 files passed                                                     | work-ship-copy-postgres.log                                                         |
| Web recovery, archive and stale review components           | 38 tests / 3 files passed                                                    | work-ship-web-behavior-final.log                                                    |
| Canonical schedule components                               | 19 tests / 5 files passed                                                    | work-ship-schedule-ui.log                                                           |
| Library, authoring and actual link integration              | 38 tests / 4 files passed                                                    | work-ship-studio-copy-checks.log                                                    |
| Blueprint, routine and section navigation components        | 29 tests / 3 files passed before phone menu; final menu 4 tests passed       | work-ship-studio-final-ui-checks.log; work-ship-studio-final-navigation-recheck.log |
| Shared tabs, including contained variant                    | 25 owning tests passed                                                       | Local owning tab-suite run                                                          |
| API typecheck and lint                                      | Passed through Turbo                                                         | work-ship-studio-package-recheck.log; work-ship-studio-final-checks.log             |
| UI, web and admin typechecks/lint                           | Passed through Turbo, including final fixture correction                     | work-ship-studio-final-ui-checks.log; work-ship-studio-final-fixture-checks.log     |
| Complexity                                                  | Passed; ledger unchanged                                                     | work-ship-studio-final-ui-checks.log                                                |
| Production Workers build                                    | Passed                                                                       | work-ship-studio-release-final.log                                                  |
| All eight production-runtime browser suites                 | All 35 journeys validated; setup-only flake closed by 6 no-retry repetitions | work-ship-studio-release-final.log; work-ship-studio-navigation-repeat.log          |
| Documentation                                               | Passed build, links, accessibility, 52 source pages and policy tests         | work-ship-studio-docs-final.log                                                     |

The initial browser run passed 31 of 35 cases. It exposed the link announcement defect and three
fixture/locator defects. Those failures are retained in work-ship-studio-release.log and do not
count as passes. The archive fixture now uses the public latestVersion.id rather than a DB-only
field. The stale case selects a team only when the destination lacks one. Page-title assertions
select the h1 rather than an unrelated hidden chooser heading. The final run closed all four
failures. Its remaining flaky result came from a sign-up 429 collected before the actual navigation
audit. Every navigation assertion passed. The collector now starts after fixture creation; it still
rejects every feature console error. All six owning repetitions passed with retries disabled, including a rate-limited sign-up.
No skipped browser case or weakened product assertion replaces these checks.

Package tasks use Turbo concurrency two; production builds run one task at a time; browser and
owning behavior tests use one worker. The overloaded original host was replaced for heavy checks by
an isolated validation checkout on WillieStudio. Its dirty primary checkout was not modified.

## Rendered craft review

The app uses the Plex/MD3 register. All fixtures are disposable, API-created verification data.
Error and pending captures explicitly simulate local request failure or delay; they are not evidence
of a provider outage. No standalone mockup supplies acceptance evidence.

The accepted-captures manifest selects 116 verified frames. It excludes superseded images.

Accepted screenshot selection:

- studio/final-core supplies desktop views, plus library/empty-library phone views.
- studio/final-states supplies desktop expanded controls, gallery, repeating-work and save states.
  Its gallery/repeat/manage phone views remain current.
- studio/final-phone replaces authoring phone views at 390×844, 320×844 and 390×600 in both themes.
  definition-step-menu shows all four sections open.
- studio/final-phone-states replaces authoring phone sharing, child dates, Program and save states.
- studio/release-shots-final supplies the final runtime failed-save captures at 320×600.

Earlier core/core-corrected/states captures and authoring phone images in final-core/final-states are
superseded. They remain diagnostic history and do not supply final craft acceptance.

| Dimension                        | Score | Evidence                                                                                                                                                                         |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand and voice                  | 3     | Empty library addresses personal work; privacy, publishing and repeating labels describe their consequences.                                                                     |
| Typography                       | 3     | long-starting-work keeps a constant section heading beneath the long identity; labels and metadata remain distinct.                                                              |
| Spatial rhythm and density       | 3     | included-work desktop groups editable rows; 320px gutters hold; Program groups use spacing.                                                                                      |
| Hierarchy and information design | 3     | definition-step-menu names the current step and exposes all four choices; review keeps one publication decision.                                                                 |
| Color discipline                 | 3     | Both themes use neutral surfaces, selected surfaces, action color and destructive/error color.                                                                                   |
| Motion and feedback              | 3     | Pending saves visibly disable submission and announce Saving; failed drafts remain editable. Reduced-motion browser paths are exercised. Exact animation timing is not asserted. |
| State completeness               | 3     | Empty, long-name/document, expanded privacy/dates, pending/error and archive first/last-page captures remain usable.                                                             |
| Detail craft                     | 3     | Contained desktop tabs have no rules; the phone menu avoids clipped labels; archive pagination and actions remain inside the viewport.                                           |

Responsive, theme parity, no-placeholder and screenshot-verification gates pass for the accepted
captures. The accessibility gate passes with the final runtime phone-menu result. Owning evidence includes
keyboard editing, retained focus, reduced motion, measured primary-action contrast of at least
4.5:1 in both themes and touch targets of at least 40px. The final phone-menu case passed
checks for all four menu items at 320px and Escape focus restoration.

## Release boundary and limitations

No new migration or template model is introduced. Existing baseline migrations still belong to the
normal deployment procedure. Defaults and examples remain editable data; the feature is not limited
to events or companies. The unrelated daily-planning defect remains outside this delivery.

Drafts have no reload recovery or autosave promise. Setup receipt recovery lasts 48 hours in the open
dialog. Browser response-loss tests establish retry after a committed result; durable failed-run
retry is established separately by API recovery and schedule component tests. They are different
failure modes.

Integration, the normal hosted release checks, deployment and deployed smoke verification remain
external gates. This delivery does not claim them. The development stack is stopped, its PGlite fixtures are reset, and the disposable PostgreSQL
containers and their owned volumes are removed. The validation checkout is removed after copying
evidence; the dedicated delivery branch remains available.
