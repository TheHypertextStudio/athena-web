# Design review: Project management and cross-org portfolio — 2026-07-10

Verdict: **BELOW BAR**. Docket has a stronger multi-workspace foundation than Linear, but it does
not yet turn that foundation into the calm executive control system its target user needs.

This review is centered on a user responsible for two companies, two nonprofits, another emerging
organization, and a personal life. Those domains must stay isolated as workspaces while still
forming one trustworthy personal operating view.

## Evidence and review boundary

The local stack responded at `https://docket.localhost:1355`, but no controllable browser session
was available. The current source, contracts, and tests were audited. Existing desktop screenshots
were inspected for visual-system evidence:

- `.screenshots/all-routes/portfolio-{light,dark}.png`
- `.screenshots/all-routes/today-{light,dark}.png`
- `.screenshots/all-routes/projects-{light,dark}.png`
- `.screenshots/all-routes/initiatives-{light,dark}.png`

Those screenshots are older than the current navigation and are all 1440×900. They support claims
about the neutral visual register and light/dark treatment, but they do not prove current behavior,
mobile behavior, or populated-state craft. The screenshot gate therefore fails.

Two independent passes informed the review: a UI/UX pass against the Docket Craft Rubric and a raw
feature pass against the current repository and official Linear documentation. The feature pass
also ran the API suite (132 files, 1,198 tests) and web suite (51 files, 301 tests); both passed.

## Executive assessment

Docket already has the right product thesis: isolated workspaces below a personal, cross-org Hub.
That is more relevant to this user than Linear's multiple-workspace model, where workspaces retain
separate members and billing and the primary interaction is switching between them. Linear even
recommends separate accounts for work and personal contexts. See
[Linear workspaces](https://linear.app/docs/workspaces).

The gap is not aggregation. Docket already aggregates Tasks, Today, Calendar, Inbox, Stream,
Search, and Portfolio. The gap is judgment. The current experience does not consistently answer:

- What needs me now?
- Which workspace is being neglected?
- What is at risk, blocked, stale, or unscheduled?
- Which deadlines collide?
- What can I safely ignore today?
- Where was I when I changed workspace?

The current product can therefore look calm while hiding obligations. For this persona, that is
more frustrating than a visually busy system that is honest about workload.

## Craft scorecard

Scores are provisional where current visual proof was unavailable.

| Dimension                         | Score | Evidence                                                                                                                                                                                                                         |
| --------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         |     3 | “Every venture on one timeline,” org-separated work, vocabulary skins, and Programs as ongoing work are recognizably Docket.                                                                                                     |
| 2. Typographic craft              |     2 | Core PM surfaces use named type tokens, but Today introduces `text-[3rem]` and `text-2xl` outside the named app scale (`apps/web/src/app/(app)/today/page.tsx:47-54`); current populated hierarchy is unverified.                |
| 3. Spatial rhythm & density       |     2 | Existing desktop screenshots are calm and aligned, but the sidebar exposes about twenty equal-weight destinations and no current populated/mobile density proof exists (`packages/ui/src/components/shell/Sidebar.tsx:164-196`). |
| 4. Hierarchy & information design |     1 | Today computes but hides approvals, blockers, inbox load, plan groups, and total attention; workspace switches reset to My Work; Portfolio offers only a timeline lens.                                                          |
| 5. Color discipline               |     3 | Existing light/dark screenshots show restrained neutrals with earned health and org color. Current theme parity still needs recapture.                                                                                           |
| 6. Motion & feedback              |     2 | Tokened transitions, focus states, and responsive table priorities exist, but workspace switching loses orientation and the available workspace attention badge is not wired.                                                    |
| 7. States completeness            |     2 | Loading, error, empty, unscheduled, and no-match states are authored; stale, overloaded, waiting-on-me, and neglected-workspace states are absent or hidden.                                                                     |
| 8. Detail craft                   |     2 | Sticky timeline labels, milestone diamonds, focus rings, truncation, and aligned entity rows are thoughtful; current mobile, 320px overflow, long-title, and large-count proof is missing.                                       |

Gates: A11y **unverified** · Responsive **unverified** · Theme parity **partial** (older desktop
screenshots only) · No placeholder **pass in reviewed PM source** · Screenshot-verified **fail**.

## What is already strong

### A real cross-workspace foundation

The shared shell keeps global Home surfaces and workspace-specific destinations visible together.
Cross-org Tasks are org-chipped, Search spans the full entity graph, and Portfolio reads one
aggregated endpoint without merging tenant identity (`packages/ui/src/components/shell/Sidebar.tsx:164-195`,
`apps/web/src/app/(app)/tasks/all-tasks-client.tsx:62-125`,
`apps/web/src/components/command-palette/use-hub-search.ts:152-235`).

### A credible portfolio timeline

Portfolio already has separate org swimlanes, sticky organization labels, Program lanes, dated
Project bars, health tint, milestone diamonds, an adaptive time scale, and an unscheduled tray
(`apps/web/src/app/(app)/portfolio/portfolio-client.tsx:18-147`,
`apps/web/src/components/portfolio/roadmap-timeline.tsx:57-139`,
`apps/web/src/components/portfolio/swimlane.tsx:54-110`). This is a valuable collision-detection
lens and should be preserved.

### Solid Linear-grade project fundamentals

Project rosters have aligned responsive columns, URL-persisted filters, grouping, sorting, health,
lead, target date, and scope. Project detail includes weighted progress, milestone-grouped work,
editable properties, comments, structured updates, agent activity, and a task dependency graph
(`apps/web/src/app/(app)/orgs/[orgId]/projects/projects-client.tsx:4-27`,
`apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx:131-295`).

### Useful differentiation from Linear

Programs model ongoing operational responsibility without inventing a finish line. That is
especially valuable for nonprofit programs, retainers, fundraising, compliance, and personal areas
of responsibility. The model should remain; its navigation weight should become contextual.

## Priority findings

### P0 — Today hides the executive attention model it already has

The Hub contract and `useTodayData` already provide a daily plan, timeboxes, approvals, blocked
tasks, due-today tasks, inbox count, plan groups, and a combined attention count
(`packages/types/src/hub.ts:100-166`,
`apps/web/src/app/(app)/today/use-today-data.ts:64-107`).

The page renders the capture box, active-org proposals, and `NextUp`, passing only calendar blocks
and due-today tasks (`apps/web/src/app/(app)/today/page.tsx:57-90`). Approvals, blockers, unread
inbox, the assembled plan, and the total attention count are not visible.

This should be the first product correction because most of the data and contract already exist.
The landing page should show:

1. **Needs me** — approvals, blocked work, overdue/due work, stale project updates.
2. **My plan** — a finite, deliberate list across workspaces.
3. **Time** — calendar/agenda and deadline collisions.
4. **Load summary** — for example, “5 commitments across 3 workspaces · 4 need attention.”

Every row needs an org chip. Capture needs a real destination picker, not just the last active
workspace's name.

### P0 — Workspace switching destroys orientation and hides workspace health

Both switch paths send the user to the destination workspace's My Work page, regardless of the
current location (`apps/web/src/components/app-shell-frame.tsx:195-201`,
`apps/web/src/components/command-palette/use-command-actions.ts:166-176`). Comparing Company A
Projects with Company B Projects therefore requires switching and navigating again.

The shared workspace model already supports `attentionCount`, but `AppShellFrame` supplies only id,
name, and avatar (`packages/ui/src/components/shell/workspaces.ts:21-30`,
`apps/web/src/components/app-shell-frame.tsx:159-167`). A workspace can be on fire without changing
the switcher.

Preserve the current workspace-level destination when switching, remember the last location per
workspace, and wire a quiet attention/staleness indicator into the switcher.

### P0 — Global scope is visually ambiguous

The shell deliberately resolves a last-used workspace even on global routes, while Portfolio and
Today aggregate all workspaces (`apps/web/src/components/app-shell-frame.tsx:169-189`). That allows
the switcher to name one workspace while the main page shows all of them. The user must infer the
data boundary from the selected nav row.

Add an explicit **All work** altitude. On Hub routes the switcher/header should say “All work” or
“Across 6 workspaces,” while the remembered active workspace remains available for capture and
workspace-scoped navigation.

### P0 — Resource visibility needs a security review before Hub expansion

Search and the dependency graph have grant-aware visibility paths, but Project list/detail reads
and Hub Today/Portfolio select primarily by active organization membership
(`apps/api/src/routes/projects.ts:226-271`, `apps/api/src/routes/hub-helpers.ts:106-112`,
`apps/api/src/routes/hub-today.ts:53-156`, `apps/api/src/routes/hub-portfolio.ts:65-83`). Those reads
do not visibly apply the same per-resource grant cascade even though Project and Task rows carry
visibility fields.

This is a source-level security finding, not a demonstrated exploit. Before expanding the Hub,
prove guest/private-resource behavior with focused tests and reuse the grant-aware filter already
present in Search/Graph. Cross-workspace calm depends on users trusting that isolation is exact.

### P1 — Portfolio is a viewer, not yet an operating surface

The client requests Portfolio with an empty query and offers only time scale plus one-org focus
(`apps/web/src/app/(app)/portfolio/portfolio-client.tsx:41-76`). The focus chips dim other orgs
rather than selecting or hiding them, reset on navigation, and appear only for orgs with bars.
The API already supports date and initiative narrowing, but the UI does not expose it
(`apps/api/src/routes/hub.ts:184-203`).

Portfolio needs three lenses over one personal query model:

| Lens     | Primary question                | Required information                                                                       |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| Overview | Which world needs attention?    | Active/at-risk/stale counts, next milestone, overdue work, approvals, missing dates/health |
| Timeline | Where do commitments collide?   | Existing org swimlanes, Programs, Projects, milestones, dependencies, target windows       |
| Projects | What should I review or change? | Org, health, priority, lead, progress, next milestone, target, last update                 |

Filters should include multi-select workspace, health, status, lead, Program, Initiative, target
window, update freshness, and “needs review.” Personal saved views should include combinations such
as Companies, Nonprofits, Personal, At risk or stale, Landing this month, and Awaiting my decision.

### P1 — Cross-workspace Tasks is too shallow

Global Tasks contains only tasks assigned to the current user and provides Due/Priority sorting
(`apps/web/src/app/(app)/tasks/all-tasks-client.tsx:28-51,69-85`). It needs the shared view engine,
workspace/project/status/date filters, grouping, bulk actions, and durable personal views.

The default mental model should distinguish:

- **Mine** — work the user owns.
- **Delegated** — work the user assigned and is waiting on.
- **Blocked** — commitments unable to move.
- **Needs decision** — approvals or unanswered requests.

### P1 — Project and Initiative metadata trails Linear

Docket Projects have one team, one lead, fixed status, dates, and health but no project priority,
project labels, project members, multiple teams, project dependencies, templates, or attached
resources (`packages/types/src/project.ts:20-129`). Linear supports project priority, labels,
milestones, dependencies, templates, and rich project context. See
[project priority](https://linear.app/docs/project-priority),
[project labels](https://linear.app/docs/project-labels),
[project dependencies](https://linear.app/docs/project-dependencies), and
[project templates](https://linear.app/docs/project-templates).

Initiatives have only active/completed status and lack priority, labels, resources, and nested
hierarchy (`packages/types/src/initiative.ts:9-75`). Linear supports richer Initiative properties
and sub-initiatives up to five levels. See [Linear initiatives](https://linear.app/docs/initiatives)
and [sub-initiatives](https://linear.app/docs/sub-initiatives).

### P1 — Project health lacks freshness

Docket supports manual update text with optional health, but no update cadence, reminder, stale
state, or visible latest-update age (`apps/web/src/components/project-detail/updates-tab.tsx:52-94`).
For an executive, “On track” without “updated 18 days ago” is false reassurance.

Show latest update, update age, next milestone, target, lead, and a one-line risk summary in the
Project header. Add update cadence and stale-state rules before adding more analytics. Linear's
structured update reminders and overdue state are the relevant benchmark:
[Initiative and Project updates](https://linear.app/docs/initiative-and-project-updates).

### P1 — Saved Views stop at org-scoped task lists

Saved Views represent AND-only filters over one org's tasks, with personal/team/org sharing
(`packages/types/src/saved-view.ts:63-90`,
`apps/web/src/app/(app)/orgs/[orgId]/views/page.tsx:4-28`). Projects and Initiatives can be filtered
temporarily but not saved; cross-workspace personal views do not exist; views cannot be favorited,
made the default landing, subscribed to, or built with nested AND/OR logic.

Generalize Views by entity type and scope, then make them first-class personal navigation. Linear's
[custom views](https://linear.app/docs/custom-views) and display options are the quality baseline,
not the product ceiling.

### P1 — Navigation and command entry are catalogs, not prioritization tools

The sidebar exposes six Home routes plus Search and thirteen Workspace routes as peer rows
(`packages/ui/src/components/shell/Sidebar.tsx:164-196`). The command palette is good at search and
navigation, but its global actions are Add workspace, change density, and sign out
(`apps/web/src/components/command-palette/use-command-actions.ts:127-164`).

Add personal pinned workspaces/projects/views, collapse Plan and More sections, and make the palette
operational: Add task, Create project in…, Add to Today, Post update, Mark at risk, and Review
approvals.

### P2 — Processing and repetition features are thin

- Triage is a derived unfiled-task list, without accept/decline, snooze, merge/duplicate handling,
  responsibility, rules, or bulk processing.
- Inbox mainly changes read state; it lacks snooze, reminders, unsubscribe, and durable inline
  approval actions.
- No task/project template, recurring-work, or favorites model was found.
- Cycle burn-up and carryover are strong, but forecasting lacks Linear-like historical capacity and
  calendar subscription.
- Linear sync imports useful issue/project/cycle structure but not Initiatives, milestones, project
  dependencies, issue relations, project updates, or resources.

## Functionality comparison

| Capability                         | Docket today                                                                 | Linear baseline                                                   | Assessment                            |
| ---------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| Multiple isolated workspaces       | Yes, with one account and separate org data                                  | Yes, primarily switched contexts                                  | Docket advantage                      |
| Cross-workspace personal surfaces  | Today, Tasks, Calendar, Inbox, Stream, Search, Portfolio                     | Workspaces remain distinct                                        | Docket differentiator, under-surfaced |
| Project list filters/grouping/sort | Yes, URL-persisted                                                           | Rich display options and saved Project views                      | Good base; persistence gap            |
| Project detail                     | Progress, properties, milestones, tasks, discussion, updates, agent activity | Adds resources/docs, priority/labels/members, richer review flows | Partial parity                        |
| Project dependencies               | Task graph only                                                              | Native project dependency lines and filters                       | Missing                               |
| Initiatives                        | Health/status roll-up over Programs/Projects                                 | Priority, labels, resources, views, nested initiatives            | Behind                                |
| Programs/ongoing work              | First-class                                                                  | No exact equivalent                                               | Docket advantage                      |
| Cycles                             | Auto-roll, burn-up, capacity/scope, carryover                                | Mature capacity forecasting, settings, calendar feed              | Strong partial parity                 |
| Saved Views                        | One-org task lists                                                           | Issue, Project, Initiative views; favorites/defaults              | Behind                                |
| Triage                             | File or archive unfiled tasks                                                | Responsibility, rules, accept/decline/snooze/merge                | Behind                                |
| Keyboard operation                 | Search/navigation palette                                                    | Broad create/edit/action command system                           | Behind                                |
| Templates/recurrence               | Not found                                                                    | Project/issue templates and recurring work                        | Missing                               |

## Recommended product sequence

1. **Restore Today as the executive cockpit.** Surface the already-computed attention model and
   wire per-workspace attention badges.
2. **Close the grant/visibility inconsistency.** Prove guest/private-resource behavior across
   Projects, Hub Today, Portfolio, activity, and cross-workspace Tasks.
3. **Preserve context across workspace switches.** Add an explicit All work altitude and remember
   location per workspace.
4. **Build Portfolio Overview / Timeline / Projects.** Add filters, multi-org selection, stale
   update signals, saved personal views, and inline project edits.
5. **Add project priority, labels, dependencies, update cadence, and staleness.** These make the
   portfolio actionable instead of decorative.
6. **Create Mine / Delegated / Blocked / Needs decision.** Apply the shared view engine to global
   Tasks.
7. **Generalize Views across entity and workspace scope.** Add nested logic, favorites/defaults,
   and subscriptions.
8. **Upgrade Triage and Inbox into real processing queues.** Add snooze/reminders, actual approval
   actions, duplicate handling, and bulk operations.
9. **Finish high-value Linear structural sync.** Milestones and project dependencies first, then
   project updates and issue relations.
10. **Run the populated visual ship gate.** Seed six workspaces, 40–100 projects, overlap, stale
    updates, pending approvals, missing dates/health, and long names; capture both themes at
    1440×900 and 390×844 and check 320px overflow.
