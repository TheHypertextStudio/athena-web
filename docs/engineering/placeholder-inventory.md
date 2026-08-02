# Placeholder inventory

<!-- GENERATED FILE — do not edit by hand. Regenerate with:
     pnpm exec tsx scripts/placeholder-inventory.ts
     Everything below the preamble is produced from source. -->

## The rule

A placeholder is legitimate **only where the content genuinely cannot be known before a fetch
resolves.** Statically-known labels, headings, toolbars, column headers and empty-state copy render
immediately. A grey bar in place of the word "Projects" is strictly less information than the word
"Projects", and it costs the reader the time the fetch takes.

Two corollaries the app is held to:

- **Never gate a whole screen on a fetch.** Each surface paints its own heading and toolbar from
  static copy and confines any loading treatment to the data region it belongs to.
- **Never animate over data you already have.** A cached or hydrated read renders its content; a
  loader over it is a lie about what is known.

## The annotation convention

Any component that renders a placeholder carries a one-line comment naming what the placeholder
stands in for:

```ts
// placeholder: the signed-in account's name, email and avatar — unknown until a session resolves
```

One annotation covers every placeholder element in that component: a five-bar card skeleton stands
in for one unknown thing, not five. Both `//` and JSX `{/* … */}` comment forms are read.

## How this file is produced

```bash
pnpm exec tsx scripts/placeholder-inventory.ts          # rewrite this document
pnpm exec tsx scripts/placeholder-inventory.ts --check  # fail on a missing annotation
```

`--check` fails when a component inside the **enforced scope** renders a placeholder with no
annotation, and when the repo-wide unannotated count rises above the ratchet recorded in the script.
The enforced scope is the whole product UI:

- `apps/web/src`
- `packages/ui/src`

with these paths measured but not yet gated, pending a rework of the calendar surfaces:

- `apps/web/src/app/(app)/calendar/`
- `apps/web/src/components/calendar/`

The exemption is written down rather than left as a narrow scope, so a *new* file that owes an
explanation fails the gate immediately and the list of what is outstanding can only shrink. The
tail below names exactly which files still owe one.

## Summary

| Metric | Count |
| --- | --- |
| Placeholder elements | 148 |
| Files containing one | 61 |
| Annotated | 142 |
| Unannotated | 6 |
| Inside the enforced scope | 142 |
| Unannotated inside the enforced scope | 0 |

## Remaining unannotated, by file

| File | Unannotated placeholders |
| --- | --- |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx` | 3 |
| `apps/web/src/components/calendar/item-drawer/relations-section.tsx` | 2 |
| `apps/web/src/app/(app)/calendar/calendar-comparison-controls.tsx` | 1 |

## Every placeholder

| Location | Component | Kind | Stands in for |
| --- | --- | --- | --- |
| `apps/web/src/app/(app)/calendar/calendar-comparison-controls.tsx:177` | `CalendarComparisonControls` | status-loader | **unannotated** |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx:266` | `FeedSkeleton` | skeleton | the inbox items themselves — how many are waiting, each one's source icon, actor, headline and age. Nothing about a feed row is known before the read resolves; the surrounding tabs, counts-free headings and empty-state copy render from static strings. |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx:268` | `FeedSkeleton` | skeleton | the inbox items themselves — how many are waiting, each one's source icon, actor, headline and age. Nothing about a feed row is known before the read resolves; the surrounding tabs, counts-free headings and empty-state copy render from static strings. |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx:269` | `FeedSkeleton` | skeleton | the inbox items themselves — how many are waiting, each one's source icon, actor, headline and age. Nothing about a feed row is known before the read resolves; the surrounding tabs, counts-free headings and empty-state copy render from static strings. |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx:270` | `FeedSkeleton` | skeleton | the inbox items themselves — how many are waiting, each one's source icon, actor, headline and age. Nothing about a feed row is known before the read resolves; the surrounding tabs, counts-free headings and empty-state copy render from static strings. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:178` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:179` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:180` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:181` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:183` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:184` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:185` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/cycles-client.tsx:269` | `ListSkeleton` | skeleton | the workspace's cycles — which cadence segments exist (past / current / upcoming), how many cycles sit in each, and every row's name, dates and progress. Cycles auto-roll on a configurable cadence, so even the segment labels depend on the fetched set. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/cycles-client.tsx:272` | `ListSkeleton` | skeleton | the workspace's cycles — which cadence segments exist (past / current / upcoming), how many cycles sit in each, and every row's name, dates and progress. Cycles auto-roll on a configurable cadence, so even the segment labels depend on the fetched set. |
| `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx:219` | `InitiativeDetailPage` | skeleton | the initiative's own record — its breadcrumb trail, its name, and the projects, health and timeline beneath it. The route carries only an id, so nothing here has a compile-time value to render instead. |
| `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx:220` | `InitiativeDetailPage` | skeleton | the initiative's own record — its breadcrumb trail, its name, and the projects, health and timeline beneath it. The route carries only an id, so nothing here has a compile-time value to render instead. |
| `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/page.tsx:221` | `InitiativeDetailPage` | skeleton | the initiative's own record — its breadcrumb trail, its name, and the projects, health and timeline beneath it. The route carries only an id, so nothing here has a compile-time value to render instead. |
| `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx:654` | `InitiativesListClient` | skeleton | the initiative rows — how many the workspace has and each one's name, |
| `apps/web/src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx:132` | `MyWorkClient` | skeleton | the rows for the selected tab — which items are assigned to, created by or |
| `apps/web/src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx:133` | `MyWorkClient` | skeleton | the rows for the selected tab — which items are assigned to, created by or |
| `apps/web/src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx:134` | `MyWorkClient` | skeleton | the rows for the selected tab — which items are assigned to, created by or |
| `apps/web/src/app/(app)/orgs/[orgId]/programs/[programId]/page.tsx:216` | `ProgramDetailPage` | skeleton | the program's own record — name, summary, the metric strip, which detail tabs have content (and their counts), and the projects under it. The route carries only a program id; even the tab row's counts come from the same read. |
| `apps/web/src/app/(app)/orgs/[orgId]/programs/[programId]/page.tsx:217` | `ProgramDetailPage` | skeleton | the program's own record — name, summary, the metric strip, which detail tabs have content (and their counts), and the projects under it. The route carries only a program id; even the tab row's counts come from the same read. |
| `apps/web/src/app/(app)/orgs/[orgId]/programs/[programId]/page.tsx:218` | `ProgramDetailPage` | skeleton | the program's own record — name, summary, the metric strip, which detail tabs have content (and their counts), and the projects under it. The route carries only a program id; even the tab row's counts come from the same read. |
| `apps/web/src/app/(app)/orgs/[orgId]/programs/[programId]/page.tsx:219` | `ProgramDetailPage` | skeleton | the program's own record — name, summary, the metric strip, which detail tabs have content (and their counts), and the projects under it. The route carries only a program id; even the tab row's counts come from the same read. |
| `apps/web/src/app/(app)/orgs/[orgId]/programs/[programId]/page.tsx:220` | `ProgramDetailPage` | skeleton | the program's own record — name, summary, the metric strip, which detail tabs have content (and their counts), and the projects under it. The route carries only a program id; even the tab row's counts come from the same read. |
| `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx:229` | `ProjectDetailPage` | skeleton | the project's own record — its breadcrumb trail, name, summary, and the milestone-grouped tasks, updates and resources beneath it (including the per-tab counts). The route carries only a project id, so none of this has a value to render before the read. |
| `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx:230` | `ProjectDetailPage` | skeleton | the project's own record — its breadcrumb trail, name, summary, and the milestone-grouped tasks, updates and resources beneath it (including the per-tab counts). The route carries only a project id, so none of this has a value to render before the read. |
| `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx:231` | `ProjectDetailPage` | skeleton | the project's own record — its breadcrumb trail, name, summary, and the milestone-grouped tasks, updates and resources beneath it (including the per-tab counts). The route carries only a project id, so none of this has a value to render before the read. |
| `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx:232` | `ProjectDetailPage` | skeleton | the project's own record — its breadcrumb trail, name, summary, and the milestone-grouped tasks, updates and resources beneath it (including the per-tab counts). The route carries only a project id, so none of this has a value to render before the read. |
| `apps/web/src/app/(app)/orgs/[orgId]/projects/projects-client.tsx:662` | `Icon` | skeleton | the project rows — how many projects the workspace has and each one's name, |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:53` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:54` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:57` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:58` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:59` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:61` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/notifications/page.tsx:143` | `NotificationsSettingsPage` | skeleton | the caller's saved notification preferences and their verified contact |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/notifications/page.tsx:144` | `NotificationsSettingsPage` | skeleton | the caller's saved notification preferences and their verified contact |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/work-structure/page.tsx:61` | `WorkStructureSettingsPage` | skeleton | the workspace's configured initiative-nesting depth, and whether the caller |
| `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/page.tsx:174` | `TaskDetailPage` | skeleton | the task's own record — its title, the state/priority/assignee controls whose current values are the whole point of rendering them, its description, and its subtasks, comments and relations. The route carries only a task id. |
| `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/page.tsx:176` | `TaskDetailPage` | skeleton | the task's own record — its title, the state/priority/assignee controls whose current values are the whole point of rendering them, its description, and its subtasks, comments and relations. The route carries only a task id. |
| `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/page.tsx:177` | `TaskDetailPage` | skeleton | the task's own record — its title, the state/priority/assignee controls whose current values are the whole point of rendering them, its description, and its subtasks, comments and relations. The route carries only a task id. |
| `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/page.tsx:178` | `TaskDetailPage` | skeleton | the task's own record — its title, the state/priority/assignee controls whose current values are the whole point of rendering them, its description, and its subtasks, comments and relations. The route carries only a task id. |
| `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/page.tsx:180` | `TaskDetailPage` | skeleton | the task's own record — its title, the state/priority/assignee controls whose current values are the whole point of rendering them, its description, and its subtasks, comments and relations. The route carries only a task id. |
| `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/page.tsx:181` | `TaskDetailPage` | skeleton | the task's own record — its title, the state/priority/assignee controls whose current values are the whole point of rendering them, its description, and its subtasks, comments and relations. The route carries only a task id. |
| `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx:76` | `TriagePage` | skeleton | the triage queue's rows — what has arrived unsorted, and each item's |
| `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx:77` | `TriagePage` | skeleton | the triage queue's rows — what has arrived unsorted, and each item's |
| `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx:78` | `TriagePage` | skeleton | the triage queue's rows — what has arrived unsorted, and each item's |
| `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx:79` | `TriagePage` | skeleton | the triage queue's rows — what has arrived unsorted, and each item's |
| `apps/web/src/app/(app)/orgs/[orgId]/views/page.tsx:87` | `ViewsPage` | skeleton | the saved views themselves — how many exist and each one's name, the filter |
| `apps/web/src/app/(app)/orgs/[orgId]/views/page.tsx:88` | `ViewsPage` | skeleton | the saved views themselves — how many exist and each one's name, the filter |
| `apps/web/src/app/(app)/orgs/[orgId]/views/page.tsx:89` | `ViewsPage` | skeleton | the saved views themselves — how many exist and each one's name, the filter |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:234` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:235` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:236` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:237` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:238` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:243` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:246` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:247` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/settings/athena/page.tsx:84` | `persist` | skeleton | the caller's saved Athena preferences — their standing instructions and the |
| `apps/web/src/app/(app)/settings/profile/page.tsx:75` | `commitImage` | status-loader | the signed-in account's name, email and avatar — unknown until the session |
| `apps/web/src/app/(app)/tasks/all-tasks-client.tsx:152` | `AllTasksClient` | skeleton | the caller's task rows — how many they have and each one's title, state, |
| `apps/web/src/components/agenda/agenda.tsx:76` | `AgendaLoadingNotice` | status-loader | the day's events and blocks, which arrive from the calendar read. Deliberately a single line of copy rather than skeleton rows: the agenda's own structure (its hours, its date, its column) is statically known and stays on screen, so only the enrichment is absent. |
| `apps/web/src/components/agents/session-status.tsx:119` | `SessionStatusPill` | animate-pulse | not a loading stand-in at all — the pulse is the live state of a session |
| `apps/web/src/components/app-shell-frame.tsx:343` | `AppShellAccountSkeleton` | skeleton | the signed-in account's name, email and avatar — unknown until a session resolves |
| `apps/web/src/components/app-shell-frame.tsx:345` | `AppShellAccountSkeleton` | skeleton | the signed-in account's name, email and avatar — unknown until a session resolves |
| `apps/web/src/components/app-shell-frame.tsx:346` | `AppShellAccountSkeleton` | skeleton | the signed-in account's name, email and avatar — unknown until a session resolves |
| `apps/web/src/components/app-shell-frame.tsx:364` | `AppShellAgendaSkeleton` | skeleton | the signed-in person's agenda and day plan — per-user reads with no viewer yet |
| `apps/web/src/components/app-shell-frame.tsx:365` | `AppShellAgendaSkeleton` | skeleton | the signed-in person's agenda and day plan — per-user reads with no viewer yet |
| `apps/web/src/components/app-shell-frame.tsx:366` | `AppShellAgendaSkeleton` | skeleton | the signed-in person's agenda and day plan — per-user reads with no viewer yet |
| `apps/web/src/components/athena/athena-conversation.tsx:156` | `AthenaConversation` | skeleton | the conversation's own history — how many turns exist, who said what, and |
| `apps/web/src/components/athena/athena-conversation.tsx:157` | `AthenaConversation` | skeleton | the conversation's own history — how many turns exist, who said what, and |
| `apps/web/src/components/athena/athena-conversation.tsx:158` | `AthenaConversation` | skeleton | the conversation's own history — how many turns exist, who said what, and |
| `apps/web/src/components/athena/athena-panel-provider.tsx:270` | `AthenaPanelProvider` | skeleton | Athena's work queue and the selected session's detail — which sessions |
| `apps/web/src/components/athena/athena-panel-provider.tsx:271` | `AthenaPanelProvider` | skeleton | Athena's work queue and the selected session's detail — which sessions |
| `apps/web/src/components/athena/athena-panel-provider.tsx:272` | `AthenaPanelProvider` | skeleton | Athena's work queue and the selected session's detail — which sessions |
| `apps/web/src/components/athena/athena-workspace.tsx:312` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:313` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:314` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:316` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:387` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:388` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx:127` | `CalendarItemDrawerContent` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx:128` | `CalendarItemDrawerContent` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx:129` | `CalendarItemDrawerContent` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/item-drawer/relations-section.tsx:35` | `CalendarItemRelationsSection` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/item-drawer/relations-section.tsx:36` | `CalendarItemRelationsSection` | skeleton | **unannotated** |
| `apps/web/src/components/canvas/task-graph-panel.tsx:328` | `TaskGraphPanel` | skeleton | the graph itself — which tasks and dependencies exist, and therefore the shape of the layout. There is no meaningful partial rendering of a node-link diagram, so the canvas area is covered while its toolbar and controls stay live. |
| `apps/web/src/components/command-palette/command-palette.tsx:229` | `CommandPalette` | skeleton | the search results for what has been typed — how many match and what |
| `apps/web/src/components/command-palette/command-palette.tsx:230` | `CommandPalette` | skeleton | the search results for what has been typed — how many match and what |
| `apps/web/src/components/command-palette/command-palette.tsx:231` | `CommandPalette` | skeleton | the search results for what has been typed — how many match and what |
| `apps/web/src/components/cycles/cycle-row.tsx:152` | `CycleRow` | skeleton | this cycle's completion stats — the committed/completed counts behind the progress bar. They come from a separate per-cycle read, so the row's name, dates and status render immediately and only the numbers wait. |
| `apps/web/src/components/cycles/cycle-row.tsx:153` | `CycleRow` | skeleton | this cycle's completion stats — the committed/completed counts behind the progress bar. They come from a separate per-cycle read, so the row's name, dates and status render immediately and only the numbers wait. |
| `apps/web/src/components/cycles/cycle-row.tsx:167` | `CycleRow` | skeleton | this cycle's completion stats — the committed/completed counts behind the progress bar. They come from a separate per-cycle read, so the row's name, dates and status render immediately and only the numbers wait. |
| `apps/web/src/components/entity-detail/updates-panel.tsx:221` | `submit` | skeleton | the posted updates — how many there are, who wrote each one, when, and what |
| `apps/web/src/components/entity-detail/updates-panel.tsx:223` | `submit` | skeleton | the posted updates — how many there are, who wrote each one, when, and what |
| `apps/web/src/components/entity-detail/updates-panel.tsx:224` | `submit` | skeleton | the posted updates — how many there are, who wrote each one, when, and what |
| `apps/web/src/components/my-work/live-session-pill.tsx:128` | `LiveSessionPill` | animate-pulse | not a loading stand-in — the pulse reports a session that is genuinely |
| `apps/web/src/components/onboarding/step-connect-provider-row.tsx:117` | `ProviderRow` | animate-pulse | whether this provider connects — the outcome of an OAuth round trip |
| `apps/web/src/components/programs/program-list-ui.tsx:471` | `ListSkeleton` | skeleton | the program rows — how many programs the workspace has and each one's name, status, health and rolled-up project counts. The list's heading and actions are static. |
| `apps/web/src/components/programs/work-board.tsx:86` | `WorkBoard` | skeleton | the board's own groups and their rows — which milestones or projects exist for this program and what work sits under each. The group headings are the *data's* names ("Milestone 2"), not static chrome, which is why the first bar stands in for one. |
| `apps/web/src/components/programs/work-board.tsx:87` | `WorkBoard` | skeleton | the board's own groups and their rows — which milestones or projects exist for this program and what work sits under each. The group headings are the *data's* names ("Milestone 2"), not static chrome, which is why the first bar stands in for one. |
| `apps/web/src/components/programs/work-board.tsx:88` | `WorkBoard` | skeleton | the board's own groups and their rows — which milestones or projects exist for this program and what work sits under each. The group headings are the *data's* names ("Milestone 2"), not static chrome, which is why the first bar stands in for one. |
| `apps/web/src/components/programs/work-board.tsx:89` | `WorkBoard` | skeleton | the board's own groups and their rows — which milestones or projects exist for this program and what work sits under each. The group headings are the *data's* names ("Milestone 2"), not static chrome, which is why the first bar stands in for one. |
| `apps/web/src/components/programs/work-board.tsx:90` | `WorkBoard` | skeleton | the board's own groups and their rows — which milestones or projects exist for this program and what work sits under each. The group headings are the *data's* names ("Milestone 2"), not static chrome, which is why the first bar stands in for one. |
| `apps/web/src/components/project-detail/project-dependencies.tsx:49` | `ProjectDependenciesPanel` | skeleton | what this project blocks and is blocked by — the linked items and their |
| `apps/web/src/components/project-detail/project-dependencies.tsx:50` | `ProjectDependenciesPanel` | skeleton | what this project blocks and is blocked by — the linked items and their |
| `apps/web/src/components/rail/day-tasks-panel.tsx:175` | `DayTasksPanel` | skeleton | today's planned tasks — how many there are and each one's title, time and |
| `apps/web/src/components/search/search-client.tsx:461` | `SearchClient` | skeleton | the matches for what has been typed — how many, and what each one is. |
| `apps/web/src/components/settings/connected-accounts-tab.tsx:151` | `ConnectedAccountsTab` | skeleton | which identity providers the caller has actually linked, and under which |
| `apps/web/src/components/settings/connected-accounts-tab.tsx:153` | `ConnectedAccountsTab` | skeleton | which identity providers the caller has actually linked, and under which |
| `apps/web/src/components/settings/connected-accounts-tab.tsx:155` | `ConnectedAccountsTab` | skeleton | which identity providers the caller has actually linked, and under which |
| `apps/web/src/components/settings/connected-apps-tab.tsx:141` | `ConnectedAppsTab` | skeleton | the OAuth apps this person has authorized — how many, their names, icons, |
| `apps/web/src/components/settings/connected-apps-tab.tsx:143` | `ConnectedAppsTab` | skeleton | the OAuth apps this person has authorized — how many, their names, icons, |
| `apps/web/src/components/settings/connected-apps-tab.tsx:144` | `ConnectedAppsTab` | skeleton | the OAuth apps this person has authorized — how many, their names, icons, |
| `apps/web/src/components/settings/connected-apps-tab.tsx:146` | `ConnectedAppsTab` | skeleton | the OAuth apps this person has authorized — how many, their names, icons, |
| `apps/web/src/components/settings/danger-zone-tab.tsx:72` | `DangerZoneTab` | skeleton | the account's lifecycle state — whether a deletion is already scheduled and for when. The whole panel depends on it: the same region is either "schedule deletion" or "cancel the deletion you scheduled", so there is no correct static copy to show meanwhile. |
| `apps/web/src/components/settings/danger-zone-tab.tsx:73` | `DangerZoneTab` | skeleton | the account's lifecycle state — whether a deletion is already scheduled and for when. The whole panel depends on it: the same region is either "schedule deletion" or "cancel the deletion you scheduled", so there is no correct static copy to show meanwhile. |
| `apps/web/src/components/settings/export-data-tab.tsx:88` | `ExportDataTab` | skeleton | which data categories and workspaces this account can export, plus its export history and the status of any export already running. The whole panel is one form built from those options, so there is no static subset of it that could be shown first. |
| `apps/web/src/components/settings/google-calendar-settings.tsx:179` | `GoogleCalendarSettings` | animate-pulse | the connected Google accounts and their calendars — which exist, which are synced, and what each is named. Nothing about a connection roster is knowable in advance. |
| `apps/web/src/components/settings/gtasks-accounts-section.tsx:76` | `GtasksAccountsSection` | skeleton | the Google Tasks connections on this workspace — which accounts are |
| `apps/web/src/components/settings/gtasks-identity-picker.tsx:29` | `GtasksIdentityPicker` | skeleton | which linked Google identities are still available to connect — a set that depends on both the account's linked identities and what is already connected here. |
| `apps/web/src/components/settings/integration-config-panel.tsx:344` | `IntegrationConfigPanel` | skeleton | the containers (lists / projects / boards) this integration exposes, which |
| `apps/web/src/components/settings/integrations-status.tsx:27` | `IntegrationsStatus` | skeleton | which integrations this workspace has connected and the state of each. The first bar stands in for a connected provider's *name*, not a static section heading — the surrounding page renders its own headings before this component is reached. |
| `apps/web/src/components/settings/integrations-status.tsx:28` | `IntegrationsStatus` | skeleton | which integrations this workspace has connected and the state of each. The first bar stands in for a connected provider's *name*, not a static section heading — the surrounding page renders its own headings before this component is reached. |
| `apps/web/src/components/settings/integrations-status.tsx:29` | `IntegrationsStatus` | skeleton | which integrations this workspace has connected and the state of each. The first bar stands in for a connected provider's *name*, not a static section heading — the surrounding page renders its own headings before this component is reached. |
| `apps/web/src/components/settings/mail-ingest-section.tsx:45` | `MailIngestSection` | skeleton | which inboxes are connected and whether mail ingest is switched on for |
| `apps/web/src/components/settings/mcp-connectors-section.tsx:111` | `McpConnectorsSection` | skeleton | the MCP tools connected to this workspace — how many and what each one is. |
| `apps/web/src/components/settings/mcp-connectors-section.tsx:112` | `McpConnectorsSection` | skeleton | the MCP tools connected to this workspace — how many and what each one is. |
| `apps/web/src/components/settings/members-tab.tsx:167` | `MembersTab` | skeleton | the workspace roster and role catalog — who is a member, what role each holds, and whether the caller is permitted to change any of it. That last answer decides which controls exist at all, so rendering the panel before it arrives would show the wrong one. |
| `apps/web/src/components/settings/members-tab.tsx:168` | `MembersTab` | skeleton | the workspace roster and role catalog — who is a member, what role each holds, and whether the caller is permitted to change any of it. That last answer decides which controls exist at all, so rendering the panel before it arrives would show the wrong one. |
| `apps/web/src/components/settings/passkeys-section.tsx:89` | `PasskeysSection` | skeleton | the passkeys registered to this account — how many, what each is named, and when it was last used. This is the sign-in method itself, so the list is the whole panel. |
| `apps/web/src/components/settings/security-tab.tsx:58` | `RecoveryCodesSection` | skeleton | whether recovery codes have been generated and how many remain unused. The panel is either "generate codes" or "you have N left" — opposite copy, so neither can be shown early without risking telling someone the wrong thing about their account recovery. |
| `apps/web/src/components/settings/sessions-section.tsx:94` | `SessionsSection` | skeleton | the account's active sessions — which devices are signed in, from where, and when they were last seen. Nothing about another device's session is knowable locally. |
| `apps/web/src/components/settings/team-mapping-picker.tsx:52` | `TeamMappingPicker` | skeleton | the external provider's own teams/containers, which only that provider can enumerate — the left-hand side of every mapping row. |
| `apps/web/src/components/settings/workspace-general-settings.tsx:187` | `updateAndCommit` | skeleton | this workspace's saved name, slug and work-vocabulary overrides — the values |
| `apps/web/src/components/stream/stream-view.tsx:92` | `FeedSkeleton` | animate-pulse | the stream's first page of activity — how many entries there are and, for each, who acted, on what and when. Only the first page: later pages append beneath the entries already on screen rather than replacing them with this. |
| `apps/web/src/components/stream/stream-view.tsx:94` | `FeedSkeleton` | animate-pulse | the stream's first page of activity — how many entries there are and, for each, who acted, on what and when. Only the first page: later pages append beneath the entries already on screen rather than replacing them with this. |
| `apps/web/src/components/stream/stream-view.tsx:95` | `FeedSkeleton` | animate-pulse | the stream's first page of activity — how many entries there are and, for each, who acted, on what and when. Only the first page: later pages append beneath the entries already on screen rather than replacing them with this. |
| `apps/web/src/components/teams/team-list-ui.tsx:191` | `ListSkeleton` | skeleton | the team rows — how many teams the workspace has and each one's name, key and member count. The roster's heading and "New team" action are static copy. |
| `apps/web/src/components/today/next-up.tsx:72` | `NextUpRowsPlaceholder` | skeleton | the day's next few timeboxed blocks (or tasks due today) — their count, titles, start times and owning workspace are all unknown until the Hub read resolves. |
| `apps/web/src/components/today/next-up.tsx:73` | `NextUpRowsPlaceholder` | skeleton | the day's next few timeboxed blocks (or tasks due today) — their count, titles, start times and owning workspace are all unknown until the Hub read resolves. |
| `apps/web/src/components/today/next-up.tsx:74` | `NextUpRowsPlaceholder` | skeleton | the day's next few timeboxed blocks (or tasks due today) — their count, titles, start times and owning workspace are all unknown until the Hub read resolves. |
| `packages/ui/src/components/shell/WorkspaceSwitcher.tsx:185` | `WorkspaceSwitcher` | skeleton | the active workspace's name and avatar — the one value in the sidebar that cannot be known before `GET /v1/orgs` resolves. The trigger *button* itself is static chrome and is always rendered (disabled while the list is unknown); only its identity is stood in for. |
| `packages/ui/src/components/shell/WorkspaceSwitcher.tsx:195` | `WorkspaceSwitcher` | skeleton | the active workspace's name and avatar — the one value in the sidebar that cannot be known before `GET /v1/orgs` resolves. The trigger *button* itself is static chrome and is always rendered (disabled while the list is unknown); only its identity is stood in for. |
| `packages/ui/src/primitives/skeleton.tsx:20` | `Skeleton` | animate-pulse | nothing — this is the primitive itself, not a usage. Every real stand-in is a caller of this component, and each of those carries its own annotation naming the unknown-until-fetch data it covers. Inventoried because the scan matches on the markup. |
