# Work-template release acceptance — October 24, 2026

This audit is for the Docket maintainer deciding whether to integrate the work-template feature. It supersedes the October 23 release verdict and the earlier October 24 checkpoint. **Verdict: SHIP within the requested local delivery boundary.** The final source passes the required local checks and rendered craft gates. No local feature blocker remains.

## Source and delivery boundary

The baseline is `0b27c3615ac1bc652a75df9a6bdfe4583e7f9b6a`. Remote main remained unchanged when checked at 17:14 PDT on October 24. The five feature commits were rebased onto that baseline. The previous history remains on `codex/work-templates-before-main-sync-20261024`, and `feature/work-template-ui` remains intact.

The shared-tab conflict retains main's selected-tab reveal during resize and hidden native scrollbar. It also retains contained-tab sizing, including padding and gaps. This delivery uses the current focused Purpose → Starting work → Included work → Review activity. It does not restore the superseded template dialogs.

Private evidence lives in `.data/design-review/final-release/`. The source manifest records hashes of changed source and relevant configuration. The release handoff records the final commit and verifies its committed blobs against that manifest. Documentation-only edits do not change the code fingerprint. The final code fingerprint is `95bb86976d9d8194cbe58d41156751816023fde1ed39293e8aa36cd5f342ef27`.

The delivery stops before integration, push and deployment. Hosted checks and deployed smoke verification remain external gates. No database migration was added; current main's migrations still apply through the normal release procedure.

## Corrections and product decisions

Session hydration now preserves the server tree and keyboard focus. The identity hook still clears private caches before paint and blocks account transitions until their purges finish. A regression test reproduces the original hydration failure and checks account isolation.

Schedule history now opens an authorized generated Project when one exists, including after its tasks are removed. Standalone task occurrences retain their Task destination. The API batches reference reads and checks normal work visibility. The optional response field preserves existing clients and persistence contracts.

The document and included-work outline remain the focus of authoring. Defaults occupy a bounded secondary column on desktop and follow the work on phones. MD3 document and work-name roles render at 16px; dates, helper text and control labels use 14px roles. The pass does not enlarge the whole application.

Team availability now describes creation-picker availability separately from publication access. Relative dates name the actual parent anchor. Review frames the starting document so its headings do not read as additional application sections. Repeat setup omits empty count categories and retains one shared desktop frame across its steps. Required gallery copies have a visible disclosure arrow.

Pending saves lock editing while leaving the document readable. Forms and archive confirmation own their inline errors. They do not also expose a global mutation retry that bypasses form coordination. Failed writes retain the draft and never claim success.

Gallery selection, review and saved results consistently identify template copies. Saving them creates no work or schedules. The empty-library description uses no fixed work-kind names. Examples remain editable data, and workspace vocabulary continues to control work labels.

## Requirement reconciliation

The [earlier requirement matrix](2026-10-23-work-templates-release.md#reconciliation) retains the original requirement mapping. Fresh acceptance covers the current implementation as follows:

| Requirement                                                               | Status      | Current evidence                                                                             |
| ------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| Four kinds, starting fields, descriptions, names and sharing              | Implemented | Identity/workflow browser suites and authoring component tests                               |
| Large template dialog and Basics/Work/Review                              | Superseded  | Focused activity, four sections, direct editing and retained drafts                          |
| Included definitions, optional children, relative dates and versions      | Implemented | Authored-blueprint, blueprint and update browser suites                                      |
| Publication, revised publication, template changes and retained overrides | Implemented | Identity/update browsers plus authorization, concurrency and transactional API tests         |
| Standalone repetition and Program routines                                | Implemented | Workflow/Program browsers and PostgreSQL recovery acceptance                                 |
| Gallery preview, dependency copies, interrupted attempts and undo         | Implemented | Gallery browser/component/API suites and PostgreSQL reference-integrity tests                |
| Dirty dismissal, failures, stale previews and duplicate prevention        | Implemented | Browser recovery/focus coverage, hydration regression and receipt/concurrency tests          |
| Phone archive pagination                                                  | Implemented | Production workspace suite and final first/last-page captures at 320px and short-phone sizes |

No broken or unverified feature requirement remains in the local acceptance scope. The owning gallery and workspace suites pass after the final wording changes.

## Validation evidence

Heavy checks use one worker or Turbo concurrency one. The scoped frozen install passes with read-only GitHub Packages access. The formatter uses the macOS CA bundle without disabling TLS. Web typechecking uses a per-process 4GB heap after its adaptive 2GB budget failed; no global heap or complexity allowance was raised.

| Check                                                          | Result                                                                                           | Private log                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| API, contract, OpenAPI, idempotency and authorization/security | 843 tests / 103 files passed                                                                     | `final-api-tests.log`                                         |
| Templates, recurrence and identity UI                          | 351 tests / 52 files passed after final copy changes                                             | `final-web-tests-v4.log`                                      |
| Complete work-domain suite                                     | 662 tests / 68 files passed; source unchanged afterward                                          | `domain-tests.log`                                            |
| Shared tabs                                                    | 25 tests passed                                                                                  | `tabs-tests.log`                                              |
| PostgreSQL 18 persistence/recovery acceptance                  | 21 tests / 3 files passed                                                                        | `final-postgres-tests.log`                                    |
| API, web, admin and UI package checks                          | Typechecks, lint and required API build passed; final web follow-up passed                       | `final-package-checks.log`, `final-web-package-checks-v4.log` |
| Complexity                                                     | Clean across 814 files / 1,380 entries; ledger unchanged; final follow-up passed                 | `final-complexity-v4.log`                                     |
| Production Workers build and complete browser target set       | Build passed; all 37 cases passed with retries disabled                                          | `release-v2.log`                                              |
| Final inline-error ownership follow-up                         | Fresh build and 11 owning browser cases passed                                                   | `release-v3.log`                                              |
| Final gallery/library wording follow-up                        | Fresh Workers build and all eight owning gallery/workspace browser cases passed                  | `release-v4.log`                                              |
| Documentation                                                  | Final build/link/accessibility, 52-page source checks and all eight coverage-policy tests passed | `final-docs-check.log`                                        |

The first production attempt failed seven cases. Its evidence remains diagnostic. The hydration correction and isolated rerun resolved those failures. The later gallery wording pass changes presentation only; its eight owning browser cases pass against the final build. Passing checks for unchanged domain and persistence source remain valid.

## Rendered craft acceptance

`accepted-final-captures.json` selects 232 accepted frames across 29 states. Each state covers 1440×900, 390×844, 320×844 and 390×600 in both themes. Additional production recovery captures cover 320×600. The native capture tool checks settled rendering, page errors and horizontal overflow. Failed diagnostics and superseded gallery/empty-library frames are excluded.

The set includes all four kinds, creation and direct editing, Review, included-work editing, expanded dates and defaults, long names/documents, read-only state, save/publication errors and pending states, populated and empty libraries, first/last archive pages, gallery selection/review/required copies/saved outcomes, repeat setup/advanced controls/Review and management.

The empty-library fixture has zero active non-base templates after archiving its 12 shipped examples. Its four base identities remain available under Defaults. Screenshots show local verification data saved through the API; they are not production customer data. Simulated error, pending and read-only states are explicitly named in capture receipts.

`accepted-final-style-measurements.json` records the final DOM pass. It measures eight key states at 1920px, 1440px and a touch-enabled 320×600 viewport in both themes. All 48 combinations pass overflow and applicable focus checks. All 1,130 sampled text pairs meet their AA threshold; the minimum is 4.63:1. All 102 sampled touch targets meet 40px. The probe composites translucent backgrounds and excludes the hidden file-input proxy from touch geometry. Mouse-width diagnostics and pre-settlement menu probes are not accepted evidence. Production browser tests separately cover keyboard operation, focus restoration, reduced motion, primary-action contrast and phone targets.

Screenshot references below are relative to `final-screens/` in the private evidence directory.

| Craft dimension     | Score | Evidence                                                                                                                                                                                                                                     |
| ------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand and voice     | 3     | `subsystem/edit-work-1440x900-light.png` separates availability from access. `gallery-v4/gallery-review-390x844-dark.png` identifies selected templates and actual sharing choices.                                                          |
| Typography          | 3     | `subsystem/edit-work-390x844-dark.png` keeps document prose and work names readable. `subsystem/edit-review-1440x900-dark.png` separates document headings from application sections.                                                        |
| Space and density   | 3     | Desktop Starting work gives the document the main column and defaults a fixed secondary column. Phone Starting work stacks that order without nested padded cards.                                                                           |
| Hierarchy           | 3     | Review frames the authored document beside included work. `gallery-v4/gallery-required-expanded-1440x900-light.png` exposes dependencies as a subordinate, operable disclosure.                                                              |
| Color               | 3     | Both themes retain neutral shared surfaces and semantic action/error colors. The final contrast measurements pass, including the hovered save action.                                                                                        |
| Motion and feedback | 3     | `subsystem/simulated-save-pending-390x600-dark.png` shows one visible saving status and readable content. Repeat frames stay fixed; keyboard and reduced-motion browsers pass.                                                               |
| States              | 3     | `subsystem/simulated-save-error-320x844-light.png` preserves the draft and one retry path. `empty-v4/empty-library-320x844-light.png` explains the next action. Saved gallery outcomes show real copies and dependencies.                    |
| Detail              | 3     | `subsystem/expanded-child-dates-320x844-dark.png` keeps field and arrow bounds aligned. `archive/archive-pagination-last-320x844-dark.png` retains pagination and consequential actions. Native overflow checks and touch measurements pass. |

All five craft gates pass: accessibility, responsive layout, theme parity, no placeholder controls and screenshot verification. The design verdict is **SHIP**. No unresolved design finding remains from this pass.

## Limitations and launch handoff

Drafts remain in memory until saved. Reloading does not recover unsaved changes. Repeat-setup receipts last 48 hours and recheck permissions; the browser retains their retry identity only while the setup remains mounted. These are existing product boundaries, not failed acceptance checks.

Verification fixtures were reset, authentication files were removed, and the local stack and owned acceptance containers/volumes were stopped and cleaned. No new migration, template model, autosave or reload-recovery mechanism was introduced. The unrelated daily-planning defect remains outside this delivery. Independent code review found no actionable blocker. Integration, hosted checks, deployment and deployed smoke verification have not run and are not presented as passes.
