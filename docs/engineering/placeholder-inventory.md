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
| Placeholder elements | 242 |
| Files containing one | 101 |
| Annotated | 151 |
| Unannotated | 91 |
| Inside the enforced scope | 236 |
| Unannotated inside the enforced scope | 85 |

## Remaining unannotated, by file

| File | Unannotated placeholders |
| --- | --- |
| `apps/web/src/components/time-tracking/focus-immersive.tsx` | 6 |
| `apps/web/src/components/mentions/mention-menu.tsx` | 5 |
| `apps/web/src/components/task-detail/task-detail-loading.tsx` | 5 |
| `apps/web/src/components/stream/stream-view.tsx` | 4 |
| `apps/web/src/app/(app)/orgs/[orgId]/recurrence-series/[seriesId]/page.tsx` | 3 |
| `apps/web/src/components/athena/athena-panel-provider.tsx` | 3 |
| `apps/web/src/components/athena/mail-inbox.tsx` | 3 |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx` | 3 |
| `apps/web/src/components/initiatives/initiative-hierarchy-picker-overlay.tsx` | 3 |
| `apps/web/src/components/pickers/label-picker-overlay.tsx` | 3 |
| `apps/web/src/components/pickers/relation-target-picker-overlay.tsx` | 3 |
| `apps/web/src/components/publishing/publishing-settings.tsx` | 3 |
| `apps/web/src/components/settings/settings-section-page.tsx` | 3 |
| `apps/web/src/components/tasks/task-hierarchy-picker-overlay.tsx` | 3 |
| `apps/web/src/components/time-tracking/focus-task-queue.tsx` | 3 |
| `apps/web/src/app/(app)/settings/work-locations/page.tsx` | 2 |
| `apps/web/src/app/(app)/today/page.tsx` | 2 |
| `apps/web/src/components/athena/mail-message-view.tsx` | 2 |
| `apps/web/src/components/calendar/item-drawer/relations-section.tsx` | 2 |
| `apps/web/src/components/library/library-client.tsx` | 2 |
| `apps/web/src/components/mentions/mention-hovercard.tsx` | 2 |
| `apps/web/src/components/programs/program-projects-panel.tsx` | 2 |
| `apps/web/src/components/scheduling-plan/plan-surface.tsx` | 2 |
| `apps/web/src/components/task-detail/task-activity-feed.tsx` | 2 |
| `packages/ui/src/components/pickers/PickerList.tsx` | 2 |
| `apps/web/src/app/(app)/billing/start/page.tsx` | 1 |
| `apps/web/src/app/(app)/calendar/calendar-comparison-controls.tsx` | 1 |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/labels/page.tsx` | 1 |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/statuses/page.tsx` | 1 |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/templates/page.tsx` | 1 |
| `apps/web/src/components/activity/day-highlights.tsx` | 1 |
| `apps/web/src/components/entity-detail/mentioned-resources.tsx` | 1 |
| `apps/web/src/components/library/resource-detail-panel.tsx` | 1 |
| `apps/web/src/components/programs/program-work-view.tsx` | 1 |
| `apps/web/src/components/service-worker-provider.tsx` | 1 |
| `apps/web/src/components/settings/automations-tab.tsx` | 1 |
| `apps/web/src/components/settings/billing-discounts-section.tsx` | 1 |
| `apps/web/src/components/settings/billing-settings.tsx` | 1 |
| `apps/web/src/components/time-tracking/focus-panel.tsx` | 1 |
| `apps/web/src/components/time-tracking/time-session-list.tsx` | 1 |
| `apps/web/src/components/today/todays-work.tsx` | 1 |
| `apps/web/src/components/work-views/project-dependency-lens.tsx` | 1 |
| `packages/ui/src/components/shell/ShellActivityBar.tsx` | 1 |

## Every placeholder

| Location | Component | Kind | Stands in for |
| --- | --- | --- | --- |
| `apps/web/src/app/(app)/billing/start/page.tsx:25` | `StartBillingPage` | status-loader | **unannotated** |
| `apps/web/src/app/(app)/calendar/calendar-comparison-controls.tsx:165` | `CalendarComparisonControls` | status-loader | **unannotated** |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx:261` | `FeedSkeleton` | skeleton | the inbox items themselves — how many are waiting, each one's source icon, actor, headline and age. Nothing about a feed row is known before the read resolves; the surrounding tabs, counts-free headings and empty-state copy render from static strings. |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx:263` | `FeedSkeleton` | skeleton | the inbox items themselves — how many are waiting, each one's source icon, actor, headline and age. Nothing about a feed row is known before the read resolves; the surrounding tabs, counts-free headings and empty-state copy render from static strings. |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx:264` | `FeedSkeleton` | skeleton | the inbox items themselves — how many are waiting, each one's source icon, actor, headline and age. Nothing about a feed row is known before the read resolves; the surrounding tabs, counts-free headings and empty-state copy render from static strings. |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx:265` | `FeedSkeleton` | skeleton | the inbox items themselves — how many are waiting, each one's source icon, actor, headline and age. Nothing about a feed row is known before the read resolves; the surrounding tabs, counts-free headings and empty-state copy render from static strings. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:266` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:267` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:268` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:269` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:270` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:271` | `NONE_ID` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/cycles-client.tsx:296` | `ListSkeleton` | skeleton | the workspace's cycles — which cadence segments exist (past / current / upcoming), how many cycles sit in each, and every row's name, dates and progress. Cycles auto-roll on a configurable cadence, so even the segment labels depend on the fetched set. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/cycles-client.tsx:299` | `ListSkeleton` | skeleton | the workspace's cycles — which cadence segments exist (past / current / upcoming), how many cycles sit in each, and every row's name, dates and progress. Cycles auto-roll on a configurable cadence, so even the segment labels depend on the fetched set. |
| `apps/web/src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx:187` | `MyWorkClient` | skeleton | the rows for the selected tab — which items are assigned to, created by or |
| `apps/web/src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx:188` | `MyWorkClient` | skeleton | the rows for the selected tab — which items are assigned to, created by or |
| `apps/web/src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx:189` | `MyWorkClient` | skeleton | the rows for the selected tab — which items are assigned to, created by or |
| `apps/web/src/app/(app)/orgs/[orgId]/recurrence-series/[seriesId]/page.tsx:190` | `RecurrenceSeriesPage` | skeleton | **unannotated** |
| `apps/web/src/app/(app)/orgs/[orgId]/recurrence-series/[seriesId]/page.tsx:191` | `RecurrenceSeriesPage` | skeleton | **unannotated** |
| `apps/web/src/app/(app)/orgs/[orgId]/recurrence-series/[seriesId]/page.tsx:192` | `RecurrenceSeriesPage` | skeleton | **unannotated** |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:53` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:54` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:57` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:58` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:59` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:61` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/labels/page.tsx:167` | `LabelsSettingsPage` | skeleton | **unannotated** |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/statuses/page.tsx:203` | `StatusesSettingsPage` | skeleton | **unannotated** |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/templates/page.tsx:120` | `TemplatesSettingsPage` | skeleton | **unannotated** |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/work-structure/page.tsx:147` | `WorkStructureSettingsPage` | skeleton | the workspace's configured initiative-nesting depth and estimation scale, |
| `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx:252` | `TaskDetailPage` | skeleton | the task's own record — its title, the state/priority/assignee controls whose current values are the whole point of rendering them, its description, and its subtasks, comments and relations. The route carries only a task id. |
| `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx:253` | `TaskDetailPage` | skeleton | the task's own record — its title, the state/priority/assignee controls whose current values are the whole point of rendering them, its description, and its subtasks, comments and relations. The route carries only a task id. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:309` | `TeamDetailClient` | skeleton | the team's open work by state, and its 30-day open/completed trend. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:418` | `TeamDetailSkeleton` | skeleton | the team's identity, its tagline, and the counts behind each section tab. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:419` | `TeamDetailSkeleton` | skeleton | the team's identity, its tagline, and the counts behind each section tab. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:420` | `TeamDetailSkeleton` | skeleton | the team's identity, its tagline, and the counts behind each section tab. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:421` | `TeamDetailSkeleton` | skeleton | the team's identity, its tagline, and the counts behind each section tab. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:422` | `TeamDetailSkeleton` | skeleton | the team's identity, its tagline, and the counts behind each section tab. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:423` | `TeamDetailSkeleton` | skeleton | the team's identity, its tagline, and the counts behind each section tab. |
| `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx:129` | `TriagePage` | skeleton | the triage queue's rows — what has arrived unsorted, and each item's |
| `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx:130` | `TriagePage` | skeleton | the triage queue's rows — what has arrived unsorted, and each item's |
| `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx:131` | `TriagePage` | skeleton | the triage queue's rows — what has arrived unsorted, and each item's |
| `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx:132` | `TriagePage` | skeleton | the triage queue's rows — what has arrived unsorted, and each item's |
| `apps/web/src/app/(app)/orgs/[orgId]/views/page.tsx:83` | `ViewsPage` | skeleton | the saved views themselves — how many exist and each one's name, the filter |
| `apps/web/src/app/(app)/orgs/[orgId]/views/page.tsx:84` | `ViewsPage` | skeleton | the saved views themselves — how many exist and each one's name, the filter |
| `apps/web/src/app/(app)/orgs/[orgId]/views/page.tsx:85` | `ViewsPage` | skeleton | the saved views themselves — how many exist and each one's name, the filter |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:234` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:235` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:236` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:237` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:238` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:243` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:246` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:247` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/settings/athena/lattice-section.tsx:163` | `LatticeSection` | skeleton | whether this person has authorized Lovelace and which of their computers is chosen — both are per-account facts only the stored record knows. |
| `apps/web/src/app/(app)/settings/athena/lattice-section.tsx:291` | `LatticeSection` | skeleton | whether this person has authorized Lovelace and which of their computers is chosen — both are per-account facts only the stored record knows. |
| `apps/web/src/app/(app)/settings/notifications/page.tsx:127` | `NotificationsSettingsPage` | skeleton | the caller's saved notification preferences and their verified contact |
| `apps/web/src/app/(app)/settings/notifications/page.tsx:128` | `NotificationsSettingsPage` | skeleton | the caller's saved notification preferences and their verified contact |
| `apps/web/src/app/(app)/settings/work-locations/page.tsx:421` | `WorkLocationsSettingsPage` | skeleton | **unannotated** |
| `apps/web/src/app/(app)/settings/work-locations/page.tsx:422` | `WorkLocationsSettingsPage` | skeleton | **unannotated** |
| `apps/web/src/app/(app)/tasks/all-tasks-client.tsx:155` | `AllTasksClient` | skeleton | the caller's task rows — how many they have and each one's title, state, |
| `apps/web/src/app/(app)/today/page.tsx:102` | `TodayPage` | animate-pulse | **unannotated** |
| `apps/web/src/app/(app)/today/page.tsx:103` | `TodayPage` | animate-pulse | **unannotated** |
| `apps/web/src/components/activity/day-highlights.tsx:89` | `DayHighlights` | skeleton | **unannotated** |
| `apps/web/src/components/agents/session-status.tsx:119` | `SessionStatusPill` | animate-pulse | not a loading stand-in at all — the pulse is the live state of a session |
| `apps/web/src/components/app-shell-frame.tsx:446` | `AppShellAccountSkeleton` | skeleton | the signed-in account's name, email and avatar — unknown until a session resolves |
| `apps/web/src/components/app-shell-frame.tsx:448` | `AppShellAccountSkeleton` | skeleton | the signed-in account's name, email and avatar — unknown until a session resolves |
| `apps/web/src/components/app-shell-frame.tsx:449` | `AppShellAccountSkeleton` | skeleton | the signed-in account's name, email and avatar — unknown until a session resolves |
| `apps/web/src/components/app-shell-frame.tsx:467` | `AppShellAgendaSkeleton` | skeleton | the signed-in person's agenda and day plan — per-user reads with no viewer yet |
| `apps/web/src/components/app-shell-frame.tsx:468` | `AppShellAgendaSkeleton` | skeleton | the signed-in person's agenda and day plan — per-user reads with no viewer yet |
| `apps/web/src/components/app-shell-frame.tsx:469` | `AppShellAgendaSkeleton` | skeleton | the signed-in person's agenda and day plan — per-user reads with no viewer yet |
| `apps/web/src/components/athena/athena-conversation.tsx:145` | `AthenaConversation` | skeleton | the conversation's own history — how many turns exist, who said what, and |
| `apps/web/src/components/athena/athena-conversation.tsx:146` | `AthenaConversation` | skeleton | the conversation's own history — how many turns exist, who said what, and |
| `apps/web/src/components/athena/athena-conversation.tsx:147` | `AthenaConversation` | skeleton | the conversation's own history — how many turns exist, who said what, and |
| `apps/web/src/components/athena/athena-panel-provider.tsx:332` | `AthenaRailPanel` | skeleton | **unannotated** |
| `apps/web/src/components/athena/athena-panel-provider.tsx:333` | `AthenaRailPanel` | skeleton | **unannotated** |
| `apps/web/src/components/athena/athena-panel-provider.tsx:334` | `AthenaRailPanel` | skeleton | **unannotated** |
| `apps/web/src/components/athena/athena-workspace.tsx:322` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:323` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:324` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:326` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:415` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:416` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/elicitation-queue.tsx:88` | `ElicitationQueue` | skeleton | how many questions are open and how tall each card is. The surface around |
| `apps/web/src/components/athena/mail-inbox.tsx:69` | `AddressCard` | skeleton | **unannotated** |
| `apps/web/src/components/athena/mail-inbox.tsx:265` | `MailInbox` | skeleton | **unannotated** |
| `apps/web/src/components/athena/mail-inbox.tsx:266` | `MailInbox` | skeleton | **unannotated** |
| `apps/web/src/components/athena/mail-message-view.tsx:67` | `MailMessageView` | skeleton | **unannotated** |
| `apps/web/src/components/athena/mail-message-view.tsx:68` | `MailMessageView` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx:150` | `CalendarItemDrawerContent` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx:151` | `CalendarItemDrawerContent` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx:152` | `CalendarItemDrawerContent` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/item-drawer/relations-section.tsx:35` | `CalendarItemRelationsSection` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/item-drawer/relations-section.tsx:36` | `CalendarItemRelationsSection` | skeleton | **unannotated** |
| `apps/web/src/components/canvas/task-graph-panel.tsx:576` | `TaskGraphPanel` | skeleton | the graph itself — which tasks and dependencies exist, and therefore the shape of the layout. There is no meaningful partial rendering of a node-link diagram, so the canvas area is covered while its toolbar and controls stay live. |
| `apps/web/src/components/command-palette/command-palette.tsx:369` | `CommandPalette` | skeleton | the search results for what has been typed — how many match and what |
| `apps/web/src/components/command-palette/command-palette.tsx:370` | `CommandPalette` | skeleton | the search results for what has been typed — how many match and what |
| `apps/web/src/components/command-palette/command-palette.tsx:371` | `CommandPalette` | skeleton | the search results for what has been typed — how many match and what |
| `apps/web/src/components/cycles/active-cycle-overview.tsx:233` | `ActiveCycleOverview` | skeleton | this cycle's committed/completed counts, which arrive with the roster. |
| `apps/web/src/components/cycles/active-cycle-overview.tsx:245` | `ActiveCycleOverview` | skeleton | this cycle's committed/completed counts, which arrive with the roster. |
| `apps/web/src/components/cycles/active-cycle-overview.tsx:264` | `ActiveCycleOverview` | skeleton | this cycle's committed/completed counts, which arrive with the roster. |
| `apps/web/src/components/cycles/active-cycle-overview.tsx:265` | `ActiveCycleOverview` | skeleton | this cycle's committed/completed counts, which arrive with the roster. |
| `apps/web/src/components/cycles/active-cycle-overview.tsx:266` | `ActiveCycleOverview` | skeleton | this cycle's committed/completed counts, which arrive with the roster. |
| `apps/web/src/components/cycles/cycle-row.tsx:167` | `CycleRow` | skeleton | this cycle's completion stats — the committed/completed counts behind the progress bar. They come from a separate per-cycle read, so the row's name, dates and status render immediately and only the numbers wait. |
| `apps/web/src/components/cycles/cycle-row.tsx:168` | `CycleRow` | skeleton | this cycle's completion stats — the committed/completed counts behind the progress bar. They come from a separate per-cycle read, so the row's name, dates and status render immediately and only the numbers wait. |
| `apps/web/src/components/cycles/cycle-row.tsx:182` | `CycleRow` | skeleton | this cycle's completion stats — the committed/completed counts behind the progress bar. They come from a separate per-cycle read, so the row's name, dates and status render immediately and only the numbers wait. |
| `apps/web/src/components/entity-detail/mentioned-resources.tsx:62` | `MentionedResources` | animate-pulse | **unannotated** |
| `apps/web/src/components/entity-detail/updates-panel.tsx:224` | `submit` | skeleton | the posted updates — how many there are, who wrote each one, when, and what |
| `apps/web/src/components/entity-detail/updates-panel.tsx:226` | `submit` | skeleton | the posted updates — how many there are, who wrote each one, when, and what |
| `apps/web/src/components/entity-detail/updates-panel.tsx:227` | `submit` | skeleton | the posted updates — how many there are, who wrote each one, when, and what |
| `apps/web/src/components/initiatives/initiative-hierarchy-picker-overlay.tsx:349` | `InitiativeHierarchyPickerOverlay` | skeleton | **unannotated** |
| `apps/web/src/components/initiatives/initiative-hierarchy-picker-overlay.tsx:350` | `InitiativeHierarchyPickerOverlay` | skeleton | **unannotated** |
| `apps/web/src/components/initiatives/initiative-hierarchy-picker-overlay.tsx:351` | `InitiativeHierarchyPickerOverlay` | skeleton | **unannotated** |
| `apps/web/src/components/library/library-client.tsx:394` | `Icon` | skeleton | **unannotated** |
| `apps/web/src/components/library/library-client.tsx:523` | `Icon` | skeleton | **unannotated** |
| `apps/web/src/components/library/resource-detail-panel.tsx:168` | `ResourceDetailPanel` | skeleton | **unannotated** |
| `apps/web/src/components/mentions/mention-hovercard.tsx:158` | `Glyph` | skeleton | **unannotated** |
| `apps/web/src/components/mentions/mention-hovercard.tsx:177` | `Glyph` | skeleton | **unannotated** |
| `apps/web/src/components/mentions/mention-menu.tsx:160` | `MentionMenu` | skeleton | **unannotated** |
| `apps/web/src/components/mentions/mention-menu.tsx:161` | `MentionMenu` | skeleton | **unannotated** |
| `apps/web/src/components/mentions/mention-menu.tsx:177` | `MentionMenu` | skeleton | **unannotated** |
| `apps/web/src/components/mentions/mention-menu.tsx:178` | `MentionMenu` | skeleton | **unannotated** |
| `apps/web/src/components/mentions/mention-menu.tsx:179` | `MentionMenu` | skeleton | **unannotated** |
| `apps/web/src/components/my-work/live-session-pill.tsx:128` | `LiveSessionPill` | animate-pulse | not a loading stand-in — the pulse reports a session that is genuinely |
| `apps/web/src/components/onboarding/step-connect-provider-row.tsx:117` | `ProviderRow` | animate-pulse | whether this provider connects — the outcome of an OAuth round trip |
| `apps/web/src/components/people/people-list.tsx:140` | `PeopleList` | skeleton | the roster itself. Its length and its names are the only unknowns; the heading, the copy and the actions above are all static and already painted. |
| `apps/web/src/components/people/person-profile.tsx:140` | `PersonProfileView` | skeleton | the person's identity and their three work lists — none of it knowable before the read resolves. The page frame around it is static and already painted. |
| `apps/web/src/components/people/person-profile.tsx:141` | `PersonProfileView` | skeleton | the person's identity and their three work lists — none of it knowable before the read resolves. The page frame around it is static and already painted. |
| `apps/web/src/components/people/person-profile.tsx:143` | `PersonProfileView` | skeleton | the person's identity and their three work lists — none of it knowable before the read resolves. The page frame around it is static and already painted. |
| `apps/web/src/components/pickers/label-picker-overlay.tsx:256` | `LabelPickerOverlay` | skeleton | **unannotated** |
| `apps/web/src/components/pickers/label-picker-overlay.tsx:257` | `LabelPickerOverlay` | skeleton | **unannotated** |
| `apps/web/src/components/pickers/label-picker-overlay.tsx:258` | `LabelPickerOverlay` | skeleton | **unannotated** |
| `apps/web/src/components/pickers/relation-target-picker-overlay.tsx:187` | `RelationTargetPickerOverlay` | skeleton | **unannotated** |
| `apps/web/src/components/pickers/relation-target-picker-overlay.tsx:188` | `RelationTargetPickerOverlay` | skeleton | **unannotated** |
| `apps/web/src/components/pickers/relation-target-picker-overlay.tsx:189` | `RelationTargetPickerOverlay` | skeleton | **unannotated** |
| `apps/web/src/components/programs/program-projects-panel.tsx:113` | `ProgramProjectsPanel` | skeleton | **unannotated** |
| `apps/web/src/components/programs/program-projects-panel.tsx:114` | `ProgramProjectsPanel` | skeleton | **unannotated** |
| `apps/web/src/components/programs/program-work-view.tsx:218` | `ProgramWorkView` | skeleton | **unannotated** |
| `apps/web/src/components/project-detail/project-dependencies.tsx:50` | `ProjectDependenciesPanel` | skeleton | what this project blocks and is blocked by — the linked items and their |
| `apps/web/src/components/project-detail/project-dependencies.tsx:51` | `ProjectDependenciesPanel` | skeleton | what this project blocks and is blocked by — the linked items and their |
| `apps/web/src/components/publishing/publishing-settings.tsx:73` | `PublishingSettings` | skeleton | **unannotated** |
| `apps/web/src/components/publishing/publishing-settings.tsx:178` | `PublishingSettings` | skeleton | **unannotated** |
| `apps/web/src/components/publishing/publishing-settings.tsx:195` | `PublishingSettings` | skeleton | **unannotated** |
| `apps/web/src/components/rail/day-tasks-panel.tsx:166` | `DayTasksPanel` | skeleton | today's planned tasks — how many there are and each one's title, time and |
| `apps/web/src/components/scheduling-plan/plan-surface.tsx:252` | `LensBody` | skeleton | **unannotated** |
| `apps/web/src/components/scheduling-plan/plan-surface.tsx:253` | `LensBody` | skeleton | **unannotated** |
| `apps/web/src/components/search/search-client.tsx:478` | `SearchClient` | skeleton | the matches for what has been typed — how many, and what each one is. |
| `apps/web/src/components/service-worker-provider.tsx:305` | `Icon` | status-loader | **unannotated** |
| `apps/web/src/components/settings/automations-tab.tsx:321` | `submitRule` | skeleton | **unannotated** |
| `apps/web/src/components/settings/billing-discounts-section.tsx:173` | `BillingDiscountsSection` | skeleton | **unannotated** |
| `apps/web/src/components/settings/billing-settings.tsx:137` | `BillingSettings` | skeleton | **unannotated** |
| `apps/web/src/components/settings/connected-accounts-tab.tsx:146` | `ConnectedAccountsTab` | skeleton | which identity providers the caller has actually linked, and under which |
| `apps/web/src/components/settings/connected-accounts-tab.tsx:148` | `ConnectedAccountsTab` | skeleton | which identity providers the caller has actually linked, and under which |
| `apps/web/src/components/settings/connected-accounts-tab.tsx:150` | `ConnectedAccountsTab` | skeleton | which identity providers the caller has actually linked, and under which |
| `apps/web/src/components/settings/connected-apps-tab.tsx:136` | `ConnectedAppsTab` | skeleton | the OAuth apps this person has authorized — how many, their names, icons, |
| `apps/web/src/components/settings/connected-apps-tab.tsx:138` | `ConnectedAppsTab` | skeleton | the OAuth apps this person has authorized — how many, their names, icons, |
| `apps/web/src/components/settings/connected-apps-tab.tsx:139` | `ConnectedAppsTab` | skeleton | the OAuth apps this person has authorized — how many, their names, icons, |
| `apps/web/src/components/settings/connected-apps-tab.tsx:141` | `ConnectedAppsTab` | skeleton | the OAuth apps this person has authorized — how many, their names, icons, |
| `apps/web/src/components/settings/danger-zone-tab.tsx:76` | `DangerZoneTab` | skeleton | the account's lifecycle state — whether a deletion is already scheduled and for when. The whole panel depends on it: the same region is either "schedule deletion" or "cancel the deletion you scheduled", so there is no correct static copy to show meanwhile. |
| `apps/web/src/components/settings/danger-zone-tab.tsx:77` | `DangerZoneTab` | skeleton | the account's lifecycle state — whether a deletion is already scheduled and for when. The whole panel depends on it: the same region is either "schedule deletion" or "cancel the deletion you scheduled", so there is no correct static copy to show meanwhile. |
| `apps/web/src/components/settings/export-data-tab.tsx:89` | `ExportDataTab` | skeleton | which data categories and workspaces this account can export, plus its export history and the status of any export already running. The whole panel is one form built from those options, so there is no static subset of it that could be shown first. |
| `apps/web/src/components/settings/google-calendar-settings.tsx:208` | `GoogleCalendarSettings` | animate-pulse | the connected Google accounts and their calendars — which exist, which are synced, and what each is named. Nothing about a connection roster is knowable in advance. |
| `apps/web/src/components/settings/gtasks-accounts-section.tsx:81` | `GtasksAccountsSection` | skeleton | the Google Tasks connections on this workspace — which accounts are |
| `apps/web/src/components/settings/gtasks-identity-picker.tsx:28` | `GtasksIdentityPicker` | skeleton | which linked Google identities are still available to connect — a set that depends on both the account's linked identities and what is already connected here. |
| `apps/web/src/components/settings/integration-config-panel.tsx:347` | `IntegrationConfigPanel` | skeleton | the containers (lists / projects / boards) this integration exposes, which |
| `apps/web/src/components/settings/integrations-status.tsx:29` | `IntegrationsStatus` | skeleton | which integrations this workspace has connected and the state of each. The first bar stands in for a connected provider's *name*, not a static section heading — the surrounding page renders its own headings before this component is reached. |
| `apps/web/src/components/settings/integrations-status.tsx:30` | `IntegrationsStatus` | skeleton | which integrations this workspace has connected and the state of each. The first bar stands in for a connected provider's *name*, not a static section heading — the surrounding page renders its own headings before this component is reached. |
| `apps/web/src/components/settings/integrations-status.tsx:31` | `IntegrationsStatus` | skeleton | which integrations this workspace has connected and the state of each. The first bar stands in for a connected provider's *name*, not a static section heading — the surrounding page renders its own headings before this component is reached. |
| `apps/web/src/components/settings/mail-ingest-section.tsx:41` | `MailIngestSection` | skeleton | which inboxes are connected and whether mail ingest is switched on for |
| `apps/web/src/components/settings/mcp-connectors-section.tsx:111` | `McpConnectorsSection` | skeleton | the MCP tools connected to this workspace — how many and what each one is. |
| `apps/web/src/components/settings/mcp-connectors-section.tsx:112` | `McpConnectorsSection` | skeleton | the MCP tools connected to this workspace — how many and what each one is. |
| `apps/web/src/components/settings/members-tab.tsx:171` | `MembersTab` | skeleton | the workspace roster and role catalog — who is a member, what role each holds, and whether the caller is permitted to change any of it. That last answer decides which controls exist at all, so rendering the panel before it arrives would show the wrong one. |
| `apps/web/src/components/settings/members-tab.tsx:172` | `MembersTab` | skeleton | the workspace roster and role catalog — who is a member, what role each holds, and whether the caller is permitted to change any of it. That last answer decides which controls exist at all, so rendering the panel before it arrives would show the wrong one. |
| `apps/web/src/components/settings/notion/notion-mirror-panel.tsx:143` | `NotionMirrorPanel` | skeleton | the connection's own state and the databases designed against it, both |
| `apps/web/src/components/settings/notion/notion-mirror-panel.tsx:144` | `NotionMirrorPanel` | skeleton | the connection's own state and the databases designed against it, both |
| `apps/web/src/components/settings/notion/notion-people-panel.tsx:72` | `NotionPeoplePanel` | skeleton | the external_actor mappings, which only the server has. |
| `apps/web/src/components/settings/notion/notion-people-panel.tsx:73` | `NotionPeoplePanel` | skeleton | the external_actor mappings, which only the server has. |
| `apps/web/src/components/settings/notion/notion-table-designer.tsx:124` | `NotionTableDesigner` | skeleton | the designed columns and a page of the workspace's own rows, both of |
| `apps/web/src/components/settings/notion/notion-table-designer.tsx:125` | `NotionTableDesigner` | skeleton | the designed columns and a page of the workspace's own rows, both of |
| `apps/web/src/components/settings/passkeys-section.tsx:96` | `PasskeysSection` | skeleton | the passkeys registered to this account — how many, what each is named, and when it was last used. This is the sign-in method itself, so the list is the whole panel. |
| `apps/web/src/components/settings/security-tab.tsx:72` | `RecoveryCodesSection` | skeleton | whether recovery codes have been generated and how many remain unused. The panel is either "generate codes" or "you have N left" — opposite copy, so neither can be shown early without risking telling someone the wrong thing about their account recovery. |
| `apps/web/src/components/settings/sessions-section.tsx:136` | `SessionsSection` | skeleton | the account's active sessions — which devices are signed in, from where, and when they were last seen. Nothing about another device's session is knowable locally. |
| `apps/web/src/components/settings/settings-section-page.tsx:120` | `SettingsSectionPage` | status-loader | **unannotated** |
| `apps/web/src/components/settings/settings-section-page.tsx:121` | `SettingsSectionPage` | skeleton | **unannotated** |
| `apps/web/src/components/settings/settings-section-page.tsx:122` | `SettingsSectionPage` | skeleton | **unannotated** |
| `apps/web/src/components/settings/team-mapping-picker.tsx:52` | `TeamMappingPicker` | skeleton | the external provider's own teams/containers, which only that provider can enumerate — the left-hand side of every mapping row. |
| `apps/web/src/components/settings/workspace-general-settings.tsx:145` | `update` | skeleton | this workspace's saved name, purpose and work-vocabulary overrides — the values |
| `apps/web/src/components/stream/stream-view.tsx:56` | `TimelineSkeleton` | animate-pulse | **unannotated** |
| `apps/web/src/components/stream/stream-view.tsx:58` | `TimelineSkeleton` | animate-pulse | **unannotated** |
| `apps/web/src/components/stream/stream-view.tsx:59` | `TimelineSkeleton` | animate-pulse | **unannotated** |
| `apps/web/src/components/stream/stream-view.tsx:60` | `TimelineSkeleton` | animate-pulse | **unannotated** |
| `apps/web/src/components/task-detail/task-activity-feed.tsx:176` | `post` | skeleton | **unannotated** |
| `apps/web/src/components/task-detail/task-activity-feed.tsx:177` | `post` | skeleton | **unannotated** |
| `apps/web/src/components/task-detail/task-detail-loading.tsx:23` | `TaskDetailLoading` | status-loader | **unannotated** |
| `apps/web/src/components/task-detail/task-detail-loading.tsx:55` | `TaskDetailLoading` | skeleton | **unannotated** |
| `apps/web/src/components/task-detail/task-detail-loading.tsx:60` | `TaskDetailLoading` | skeleton | **unannotated** |
| `apps/web/src/components/task-detail/task-detail-loading.tsx:61` | `TaskDetailLoading` | skeleton | **unannotated** |
| `apps/web/src/components/task-detail/task-detail-loading.tsx:63` | `TaskDetailLoading` | skeleton | **unannotated** |
| `apps/web/src/components/tasks/task-hierarchy-picker-overlay.tsx:127` | `TaskHierarchyPickerOverlay` | skeleton | **unannotated** |
| `apps/web/src/components/tasks/task-hierarchy-picker-overlay.tsx:128` | `TaskHierarchyPickerOverlay` | skeleton | **unannotated** |
| `apps/web/src/components/tasks/task-hierarchy-picker-overlay.tsx:129` | `TaskHierarchyPickerOverlay` | skeleton | **unannotated** |
| `apps/web/src/components/team-detail/team-people.tsx:121` | `TeamPeopleSkeleton` | skeleton | who is on this team, their titles, roles, and current load. |
| `apps/web/src/components/teams/team-card.tsx:179` | `TeamCardsSkeleton` | skeleton | how many teams the workspace has, and each one's cover, name, roster and counts. |
| `apps/web/src/components/teams/team-list-ui.tsx:204` | `ListSkeleton` | skeleton | the team rows — how many teams the workspace has and each one's name, key and member count. The roster's heading and "New team" action are static copy. |
| `apps/web/src/components/time-tracking/focus-immersive.tsx:89` | `FocusImmersive` | skeleton | **unannotated** |
| `apps/web/src/components/time-tracking/focus-immersive.tsx:90` | `FocusImmersive` | skeleton | **unannotated** |
| `apps/web/src/components/time-tracking/focus-immersive.tsx:91` | `FocusImmersive` | skeleton | **unannotated** |
| `apps/web/src/components/time-tracking/focus-immersive.tsx:116` | `FocusImmersive` | skeleton | **unannotated** |
| `apps/web/src/components/time-tracking/focus-immersive.tsx:117` | `FocusImmersive` | skeleton | **unannotated** |
| `apps/web/src/components/time-tracking/focus-immersive.tsx:118` | `FocusImmersive` | skeleton | **unannotated** |
| `apps/web/src/components/time-tracking/focus-panel.tsx:75` | `FocusPanel` | skeleton | **unannotated** |
| `apps/web/src/components/time-tracking/focus-task-queue.tsx:153` | `FocusTaskQueue` | skeleton | **unannotated** |
| `apps/web/src/components/time-tracking/focus-task-queue.tsx:190` | `FocusTaskQueue` | skeleton | **unannotated** |
| `apps/web/src/components/time-tracking/focus-task-queue.tsx:191` | `FocusTaskQueue` | skeleton | **unannotated** |
| `apps/web/src/components/time-tracking/time-session-list.tsx:148` | `SessionSkeleton` | skeleton | **unannotated** |
| `apps/web/src/components/today/todays-work.tsx:74` | `TodaysWork` | skeleton | **unannotated** |
| `apps/web/src/components/views/entity-detail-skeleton.tsx:75` | `EntityDetailSkeleton` | status-loader | the breadcrumb trail, which names containers the record has not been read from yet. |
| `apps/web/src/components/views/entity-detail-skeleton.tsx:114` | `EntityDetailSkeleton` | skeleton | the breadcrumb trail, which names containers the record has not been read from yet. |
| `apps/web/src/components/views/entity-detail-skeleton.tsx:143` | `EntityDetailBodySkeleton` | status-loader | the active tab's panel, still being assembled from the composite read. |
| `apps/web/src/components/work-views/project-dependency-lens.tsx:62` | `ProjectDependencyLens` | skeleton | **unannotated** |
| `apps/web/src/components/work-views/work-view-page.tsx:354` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:356` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:357` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:360` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:361` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:364` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:365` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:368` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:369` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:383` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:387` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:388` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:390` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `apps/web/src/components/work-views/work-view-page.tsx:391` | `WorkViewPage` | skeleton | the cards themselves — how many there are, and each one's name, summary, verdict, owner and rolled-up counts. Shaped like the loaded card, on the loaded card's own grid, because a list-shaped stand-in under a card lens does not fill in so much as rearrange itself. |
| `packages/ui/src/components/pickers/PickerList.tsx:404` | `PickerList` | skeleton | **unannotated** |
| `packages/ui/src/components/pickers/PickerList.tsx:405` | `PickerList` | skeleton | **unannotated** |
| `packages/ui/src/components/shell/ShellActivityBar.tsx:91` | `ShellActivityBar` | animate-pulse | **unannotated** |
| `packages/ui/src/components/shell/WorkspaceSwitcher.tsx:234` | `WorkspaceSwitcher` | skeleton | the active workspace's name and avatar — the one value in the sidebar that cannot be known before `GET /v1/orgs` resolves. The trigger *button* itself is static chrome and is always rendered (disabled while the list is unknown); only its identity is stood in for. |
| `packages/ui/src/primitives/skeleton.tsx:30` | `Skeleton` | animate-pulse | nothing — this is the primitive itself, not a usage. Every real stand-in is a caller of this component, and each of those carries its own annotation naming the unknown-until-fetch data it covers. Inventoried because the scan matches on the markup. |
| `packages/ui/src/primitives/skeleton.tsx:64` | `SkeletonText` | skeleton | one line of text the caller names in its own annotation. |
| `packages/ui/src/primitives/skeleton.tsx:82` | `SkeletonChip` | skeleton | one property picker whose value is unknown until the entity loads. |
| `packages/ui/src/primitives/skeleton.tsx:96` | `SkeletonGlyph` | skeleton | the entity's icon, which is part of the record still being read. |
