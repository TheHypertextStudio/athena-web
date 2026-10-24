# Work-template authoring refinement

Reader: A Docket maintainer reviewing the authoring refinement before integration.

The refinement separates guided creation from direct editing and removes competing Review actions and nested section surfaces. This audit supersedes the presentation verdict in [the earlier release audit](2026-10-23-work-templates-release.md). Its unchanged backend evidence remains separate from this visual assessment.

The [implementation plan](../../engineering/plans/2026-10-23-work-template-authoring-refinement.md) defines the delivery boundary. The app retains the existing templates, versioning, blueprints, Program routines, gallery copies, recurrence behavior, and permissions. This change adds no migration or template model. Integration, push, and deployment remain outside this delivery.

## Current acceptance

Local acceptance passes. All feature checks and visual hard gates are closed within the agreed delivery boundary. The feature remains unintegrated and undeployed.

The source is on `codex/work-templates-ship-ready`, following planning commit `f5548aaf6`. The final evidence package records the checked commit and file hashes after validation.

## Design decisions and rendered evidence

The app retains the Plex/MD3 register. Creation shows all four named steps and uses the shared activity footer. Editing uses direct section navigation and offers Save changes only for unsaved values. Review keeps publication separate from saving. A first save retains the current step, open child or routine, focus, and scroll position.

The editor uses one readable column with one phone inset. The document has a shared field surface instead of resembling a fixed heading. Included-work rows no longer sit inside nested tinted containers. A collapsed outline keeps its count because the rows are hidden. Template purpose appears in the review introduction rather than among the values copied into new work.

The authenticated captures use API-created fixtures in the real app. Names and work examples are editable fixture data. Error, pending, and read-only presentation scenarios are explicitly simulated. The read-only capture does not replace actual authorization tests. Failed and superseded captures remain diagnostic records and do not supply final acceptance evidence.

The private evidence root is `.data/design-review/authoring-refinement/`. Its accepted-capture manifest selects 184 successful frames across 23 states, with no missing state/width/theme combination. Review, error, and read-only replays replace earlier frames after presentation refinements. The manifest excludes all failed and superseded frames. The standard widths are 1440×900, 390×844, 320×844, and 390×600. Every accepted frame also passes the capture tool's horizontal-overflow assertion.

| Dimension                        | Score | Specific evidence                                                                                                                                                                                                                                                                  |
| -------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice         | 3     | `new-purpose` and `create-work` use Docket's type and tokens. Template name and Name for new work distinguish library identity from copied values. No business scenario determines a product type.                                                                                 |
| Typographic craft                | 3     | `edit-work` gives the template title, section title, field label, and document distinct token-based roles. `long-name-document` wraps the full name on a 320px phone without clipping.                                                                                             |
| Spatial rhythm and density       | 3     | `edit-structure` removes the three nested surfaces in the baseline. Fields and section headings share an edge; rows use a deliberate inset within their group. `create-review` retains a usable scrolling area above its short-phone footer.                                       |
| Hierarchy and information design | 3     | `new-purpose` exposes four creation steps and one primary Continue action. `edit-review` shows a natural-width Publish action with its consequence. Routine editing has no Back/Continue wizard footer.                                                                            |
| Color discipline                 | 3     | Light and dark captures use shared neutral surfaces, selected controls, semantic errors, and the primary-action color. Read-only document text retains normal reading contrast.                                                                                                    |
| Motion and feedback              | 3     | Pending captures show Saving or Publishing and disable submission. Owning tests verify validation focus, menu focus, selected-row return, first-save continuity, and ignored late outcomes after unmount. No new animation system was added.                                       |
| State completeness               | 3     | Captures include empty and populated templates, all four work kinds, long content, expanded children and routines, privacy, read-only access, pending writes, and failed saves/publications with retained content.                                                                 |
| Detail craft                     | 3     | The 320px step labels wrap inside their controls. Shared select arrows remain inside field bounds. `collapsed-included-work` keeps context while hiding rows; `expanded-child-dates` preserves adjacent labels and inputs. No horizontal rules or underlined tabs were introduced. |

These scores describe a coherent Docket app surface. They do not claim a distinctive level-four visual identity or substitute for the user's review of the finished screens.

## Checks and evidence

| Check                                     | Current evidence                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring and template component behavior | 269 tests across 41 files pass with one worker.                                                                                                                                                                                                                                   |
| Web typecheck and lint                    | Both pass through Turbo with concurrency two.                                                                                                                                                                                                                                     |
| Complexity                                | The repository check passes; the debt ledger remains unchanged.                                                                                                                                                                                                                   |
| Production Workers build                  | Passed through the release harness against final product source.                                                                                                                                                                                                                  |
| Browser journeys                          | All 36 journeys across eight suites are validated with retries disabled. The final full run passed 35/36; its only failure expected creation-step ARIA on an editing tab. After correcting that assertion, the owning journey passed independently against the same product code. |
| Documentation                             | Passed the documentation build, link/accessibility checks, source checks, and policy tests. Product guide and audit are current.                                                                                                                                                  |
| Independent reviews                       | Spec and code-quality reviews closed the routine-validation, nested-return, pending-navigation, read-only-navigation, and unmounted-response defects.                                                                                                                             |

Browser verification uses `scripts/run-release-acceptance.sh` with `RELEASE_WEB_RUNTIME=workers` and all eight `work-template-*.spec.ts` targets through `RELEASE_BROWSER_TARGETS`. The harness uses disposable PostgreSQL. The new private-completion journey verifies that saving, finishing without publication, and reopening use the intended modes.

No API or database source changed. The prior PostgreSQL authorization, publication, copy, and schedule acceptance remains evidence for those unchanged paths. The current browser run checks persistence through the real production runtime. PGlite screenshots alone do not establish that result.

The first local resource check found no `agentctl` executable and a load average above 300. Heavy checks and captures use a separate validation checkout on WillieStudio. Its primary checkout is unchanged. The validation checkout uses the repository's existing dev stack, passkey session, screenshot tool, and release harness. A detached-HEAD hostname mismatch and an outdated copied environment were corrected by using a lowercase validation branch and this source's committed local defaults.

## Hard gates and remaining boundary

All five visual hard gates pass. Keyboard/focus and contrast checks cover the changed flow; component tests retain read-only and failure behavior. The responsive and theme gates use the complete accepted matrix. The content gate uses real persisted templates and functional controls. The screenshot gate uses the real authenticated app rather than a separate prototype. This remains browser evidence, not physical-device certification.

The development stack is stopped and its PGlite fixtures are reset. The release harness stops its direct processes and disposable PostgreSQL container. Remaining Node, esbuild, and workerd descendants require explicit cleanup after checking that their working directories belong to this task’s temporary checkout. The final process receipt verifies that none remain. Task-owned anonymous PostgreSQL volumes are identified from their recorded mounts or matching fixture database names before removal. The handoff records the final cleanup receipts and checked commit.

Drafts remain in memory until saved. Autosave and reload recovery remain outside the feature. Simulated error/read-only frames prove presentation; they do not prove a provider outage or replace permission enforcement. This delivery does not integrate into main, push, deploy, or establish deployed acceptance.
