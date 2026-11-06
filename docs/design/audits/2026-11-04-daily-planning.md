# Design review: Daily planning and Focus — 2026-11-04

Register: app — calm Plex/MD3. Boundary: planning, review, confirmation and immersive Focus. This is a local implementation review using clearly identified test accounts and synthetic task/calendar fixtures, not production or representative-user acceptance.

## Baseline

Source: `32fb1e15c`. Screenshots: `/Volumes/WillieDrive/CodexScratch/daily-planning-bf28/shots/` and `/Volumes/WillieDrive/CodexScratch/daily-planning-bf28-finalchecks/shots/` (1440×900 and 390×844, both themes).

| Dimension                         | Score | Evidence                                                                                                                                                                                       |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | Plex typography, neutral app surfaces, direct Work/Agenda labels and domain-specific task/calendar content.                                                                                    |
| 2. Typographic craft              | 2     | Phone Focus title occupies three large lines before the task document; selected-task minute input drops below its title and competes with metadata.                                            |
| 3. Spatial rhythm & density       | 2     | `planner-390x844-dark.png`: three individually outlined selected cards consume roughly 350px; discovery repeats the same three tasks below.                                                    |
| 4. Hierarchy & information design | 2     | Work has no explicit boundary between selected intent and discovery. `accepted-1440x900-dark.png`: Current session spans the whole workspace despite one short title and four compact actions. |
| 5. Color discipline               | 3     | Semantic neutral surfaces and primary action colors hold in both themes; priority and links carry meaning.                                                                                     |
| 6. Motion & feedback              | 3     | Shared icon controls, tooltips, inline editing, saved-block browser journeys and proposal Apply/Keep current preserve the action model.                                                        |
| 7. States completeness            | 2     | Recovery is functional, but active filters are described only inside their popover, and selected records add duplicate browsing noise.                                                         |
| 8. Detail craft                   | 2     | Phone selected time controls and metadata lack a shared horizontal rhythm. Inline title field suppresses native outline without an explicit local focus ring.                                  |

Baseline verdict: BELOW BAR — dimensions 2, 3, 4, 7 and 8 need refinement. Final hard-gate evidence is pending below.

## Findings and corrections

1. **P1: Phone work density obscures task discovery.** Compact the selected list, keep title and duration on the same row, and label chosen work separately. Keep direct title/time editing and drag/menu alternatives.
2. **P2: Selected work repeats in the default browser.** Exclude selected tasks from ordinary discovery while retaining In plan results during explicit search. Account for a page whose tasks are all already selected.
3. **P2: Active result scope is hidden.** Show selected responsibility/workspace/due filters outside the popover with one clear action. Avoid another persistent filter toolbar.
4. **P2: Confirmation overweights its short current-session summary.** Keep that summary beside the upcoming agenda and above selected work; emphasize the actual task title over its structural label.
5. **P2: Focus title dominates the phone viewport.** Use a smaller canonical heading role on phones, tighten document spacing, and align the desktop content width with the planning workspace.
6. **P1: Inline title editing needs visible keyboard focus.** Use the shared inset focus convention and exercise it in the narrow long-title journey.
7. **P2: Capacity and task estimates expose internal minute counts.** Format read-only totals and estimates as hours and minutes so a full day reads naturally; retain minute precision in the editable numeric field.
8. **P2: Task discovery reads as a separate subsection.** Remove the standalone heading and hard divider; let search and existing tasks follow selected work with quiet spacing.
9. **P2: Repeated footer buttons compete with the numbered stage navigation.** Keep one forward action in each footer and leave backward navigation to the visible stages.
10. **P2: Workday hours sit outside the concept they control.** Put a compact clock-and-range control in the Agenda header and tint the corresponding interval on the time grid; keep the exact start, finish and buffer edits in that anchored control.
11. **P1: A first-use proposal can miss the person's existing work.** The proposal candidate query used assigned tasks, while the visible task browser used both assigned and created tasks. That mismatch left a first day blank even when the browser could find tasks. Initial proposals must use the same responsibility scope before considering priority, duration, dependencies and available time.

## Intent and tradeoffs

A person with hundreds of tasks needs to choose work, assign realistic time and see its relationship to calendar commitments. Compact list rows retain inline editing and 40px touch controls; individual task cards were rejected because their repeated boundaries and wrapped controls hid useful work on phones. Selected tasks stay searchable, so reducing duplicate default rows does not make existing selections hard to locate. The workday appears as a shaded interval on the agenda; a small clock-and-range control at the Agenda heading edits the same interval and its scheduling buffer. Active task scope stays visible. The confirmation layout continues the same work/agenda relationship. Focus gives the task document priority while retaining the timer before it on phones.

## Final verification

Source: `89e20877a` on top of `f0860415f`. Final local captures: `/Volumes/WillieDrive/CodexScratch/daily-planning-final-review-20261105-bf28/` — Agenda at 1440×900 and 390×844, Work at 390×844, and Focus at 1440×900, 390×844, 390×600 and 320×844, in light and dark themes where the route supports both. The planner uses one planned task, two discoverable tasks and one calendar commitment so the composition is visible without fixture duplication.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                             |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity & voice         | 3     | The planning stages, Work, Agenda, existing task names and calendar commitment read in the established Plex/MD3 visual language.                                                                                                     |
| 2. Typographic craft              | 3     | `focus/focus-task-context-390x844-light.png`: task title and document sections fit a narrow phone without the former oversized heading.                                                                                              |
| 3. Spatial rhythm & density       | 3     | `work-picker/planner-work-picker-390x844-light.png`: two existing tasks appear as compact rows with owner and human-readable estimate; selected work is not duplicated.                                                              |
| 4. Hierarchy & information design | 3     | `planner-desktop/planner-agenda-1440x900-light.png`: one stage indicator, adjacent Work and Agenda panels, and a single forward action. The agenda shows its work window and calendar item in the same timeline.                     |
| 5. Color discipline               | 3     | Desktop and phone light/dark captures preserve semantic surface and action colors without adding decorative status colors.                                                                                                           |
| 6. Motion & feedback              | 3     | Browser journeys verify task selection, time editing, agenda scheduling/moving, calendar detail, empty-plan acknowledgement, Focus timer controls and recovery.                                                                      |
| 7. States completeness            | 3     | The browser exposes live unfinished work across active workspaces, with keyset pagination; the API regression covers 125 tasks without omissions and searches beyond the first page. Empty and failed-edit states remain actionable. |
| 8. Detail craft                   | 2     | Inline task editing retains visible focus and touch controls. The open Workday editor is anchored to Agenda; at phone width it temporarily covers part of the timeline while editing.                                                |

**Rendered review: PASS WITH A LOCALIZED TRADEOFF.** The empty planner, noninteractive agenda, hidden work hours, repeated task list and minute-heavy summaries in the baseline are replaced by an existing-work browser, operable schedule grid, visible work window, concise estimates and task-centered Focus context. The proposal review also found that creator-owned tasks were omitted from the first-day candidate query; the proposal now follows the same assigned-or-created scope as the task browser and puts fitting work directly into the editable draft. The open Workday editor covers some timeline content until dismissed; the closed state leaves the schedule unobstructed. Local screenshots establish rendering only, not production or representative-user acceptance.

The core and design browser suites passed locally (14 browser cases); post-rebase component/API, lint, type, complexity and production Worker build results are recorded in the work log before integration. Staging and production acceptance remain separate from these captures.
