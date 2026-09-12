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
| Placeholder elements | 244 |
| Files containing one | 103 |
| Annotated | 238 |
| Unannotated | 6 |
| Inside the enforced scope | 238 |
| Unannotated inside the enforced scope | 0 |

## Remaining unannotated, by file

| File | Unannotated placeholders |
| --- | --- |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx` | 3 |
| `apps/web/src/components/calendar/item-drawer/event-arc.tsx` | 2 |
| `apps/web/src/app/(app)/calendar/calendar-comparison-controls.tsx` | 1 |

## Every placeholder

| Location | Component | Kind | Stands in for |
| --- | --- | --- | --- |
| `apps/web/src/app/(app)/billing/start/page.tsx:26` | `StartBillingPage` | status-loader | which of the reader's workspaces are eligible to start a trial. |
| `apps/web/src/app/(app)/calendar/calendar-comparison-controls.tsx:167` | `CalendarComparisonControls` | status-loader | **unannotated** |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx:284` | `FeedSkeleton` | skeleton | the inbox items themselves — how many are waiting, each one's source icon, actor, headline and age. Nothing about a feed row is known before the read resolves; the surrounding tabs, counts-free headings and empty-state copy render from static strings. |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx:286` | `FeedSkeleton` | skeleton | the inbox items themselves — how many are waiting, each one's source icon, actor, headline and age. Nothing about a feed row is known before the read resolves; the surrounding tabs, counts-free headings and empty-state copy render from static strings. |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx:287` | `FeedSkeleton` | skeleton | the inbox items themselves — how many are waiting, each one's source icon, actor, headline and age. Nothing about a feed row is known before the read resolves; the surrounding tabs, counts-free headings and empty-state copy render from static strings. |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx:288` | `FeedSkeleton` | skeleton | the inbox items themselves — how many are waiting, each one's source icon, actor, headline and age. Nothing about a feed row is known before the read resolves; the surrounding tabs, counts-free headings and empty-state copy render from static strings. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:277` | `CycleDetailPage` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:278` | `CycleDetailPage` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:279` | `CycleDetailPage` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:280` | `CycleDetailPage` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:281` | `CycleDetailPage` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/[cycleId]/page.tsx:282` | `CycleDetailPage` | skeleton | everything on a cycle detail screen is the cycle's own record — its name, its date range, the progress summary, the grouping axis its board was last left on, and the tasks in it. The route only carries an opaque cycle id, so none of it can be named earlier. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/cycles-client.tsx:315` | `ListSkeleton` | skeleton | the workspace's cycles — which cadence segments exist (past / current / upcoming), how many cycles sit in each, and every row's name, dates and progress. Cycles auto-roll on a configurable cadence, so even the segment labels depend on the fetched set. |
| `apps/web/src/app/(app)/orgs/[orgId]/cycles/cycles-client.tsx:318` | `ListSkeleton` | skeleton | the workspace's cycles — which cadence segments exist (past / current / upcoming), how many cycles sit in each, and every row's name, dates and progress. Cycles auto-roll on a configurable cadence, so even the segment labels depend on the fetched set. |
| `apps/web/src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx:187` | `MyWorkClient` | skeleton | the rows for the selected tab — which items are assigned to, created by or |
| `apps/web/src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx:188` | `MyWorkClient` | skeleton | the rows for the selected tab — which items are assigned to, created by or |
| `apps/web/src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx:189` | `MyWorkClient` | skeleton | the rows for the selected tab — which items are assigned to, created by or |
| `apps/web/src/app/(app)/orgs/[orgId]/recurrence-series/[seriesId]/page.tsx:192` | `RecurrenceSeriesPage` | skeleton | the series' name, its schedule summary, and its occurrences. |
| `apps/web/src/app/(app)/orgs/[orgId]/recurrence-series/[seriesId]/page.tsx:193` | `RecurrenceSeriesPage` | skeleton | the series' name, its schedule summary, and its occurrences. |
| `apps/web/src/app/(app)/orgs/[orgId]/recurrence-series/[seriesId]/page.tsx:194` | `RecurrenceSeriesPage` | skeleton | the series' name, its schedule summary, and its occurrences. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:53` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:54` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:57` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:58` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:59` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/sessions/[sessionId]/page.tsx:61` | `SessionViewPage` | skeleton | the agent session's own record — which agent ran, against which work item, the transcript of what it did, and the proposals awaiting a decision. The route carries only a session id, so nothing on this screen has a value before the read resolves. |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/labels/page.tsx:232` | `LabelsSettingsPage` | skeleton | the workspace's labels. |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/statuses/page.tsx:253` | `StatusesSettingsPage` | skeleton | the workspace's own status sets, per kind of work. |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/templates/page.tsx:120` | `TemplatesSettingsPage` | skeleton | the workspace's templates. |
| `apps/web/src/app/(app)/orgs/[orgId]/settings/work-structure/page.tsx:154` | `WorkStructureSettingsPage` | skeleton | the workspace's configured initiative-nesting depth and estimation scale, |
| `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx:283` | `TaskDetailPage` | skeleton | the task's own record — its title, the state/priority/assignee controls whose current values are the whole point of rendering them, its description, and its subtasks, comments and relations. The route carries only a task id. |
| `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx:284` | `TaskDetailPage` | skeleton | the task's own record — its title, the state/priority/assignee controls whose current values are the whole point of rendering them, its description, and its subtasks, comments and relations. The route carries only a task id. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:262` | `TeamDetailClient` | skeleton | the team's open work by state, and its 30-day open/completed trend. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:371` | `TeamDetailSkeleton` | skeleton | the team's identity, its tagline, and the counts behind each section tab. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:372` | `TeamDetailSkeleton` | skeleton | the team's identity, its tagline, and the counts behind each section tab. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:373` | `TeamDetailSkeleton` | skeleton | the team's identity, its tagline, and the counts behind each section tab. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:374` | `TeamDetailSkeleton` | skeleton | the team's identity, its tagline, and the counts behind each section tab. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:375` | `TeamDetailSkeleton` | skeleton | the team's identity, its tagline, and the counts behind each section tab. |
| `apps/web/src/app/(app)/orgs/[orgId]/teams/[teamId]/team-detail-client.tsx:376` | `TeamDetailSkeleton` | skeleton | the team's identity, its tagline, and the counts behind each section tab. |
| `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx:129` | `TriagePage` | skeleton | the triage queue's rows — what has arrived unsorted, and each item's |
| `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx:130` | `TriagePage` | skeleton | the triage queue's rows — what has arrived unsorted, and each item's |
| `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx:131` | `TriagePage` | skeleton | the triage queue's rows — what has arrived unsorted, and each item's |
| `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx:132` | `TriagePage` | skeleton | the triage queue's rows — what has arrived unsorted, and each item's |
| `apps/web/src/app/(app)/orgs/[orgId]/views/page.tsx:84` | `ViewsPage` | skeleton | the saved views themselves — how many exist and each one's name, the filter |
| `apps/web/src/app/(app)/orgs/[orgId]/views/page.tsx:85` | `ViewsPage` | skeleton | the saved views themselves — how many exist and each one's name, the filter |
| `apps/web/src/app/(app)/orgs/[orgId]/views/page.tsx:86` | `ViewsPage` | skeleton | the saved views themselves — how many exist and each one's name, the filter |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:234` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:235` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:236` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:237` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:238` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:243` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:246` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/portfolio/portfolio-client.tsx:247` | `TimelineSkeleton` | skeleton | the roadmap's contents — which time buckets the axis spans (derived from the work's own dates, not the calendar), which organizations and projects become swimlanes, and where each bar starts and ends. The page heading and range controls above are static copy. |
| `apps/web/src/app/(app)/settings/athena/lattice-section.tsx:479` | `LatticeSection` | skeleton | whether this person has authorized Lovelace and which of their computers is chosen — both are per-account facts only the stored record knows. |
| `apps/web/src/app/(app)/settings/athena/lattice-section.tsx:561` | `LatticeSection` | skeleton | whether this person has authorized Lovelace and which of their computers is chosen — both are per-account facts only the stored record knows. |
| `apps/web/src/app/(app)/settings/notifications/page.tsx:130` | `NotificationsSettingsPage` | skeleton | the caller's saved notification preferences and their verified contact |
| `apps/web/src/app/(app)/settings/notifications/page.tsx:131` | `NotificationsSettingsPage` | skeleton | the caller's saved notification preferences and their verified contact |
| `apps/web/src/app/(app)/tasks/all-tasks-client.tsx:156` | `AllTasksClient` | skeleton | the caller's task rows — how many they have and each one's title, state, |
| `apps/web/src/components/activity/day-highlights.tsx:90` | `DayHighlights` | skeleton | the day's highlights, which are summarised from that day's activity. |
| `apps/web/src/components/agents/session-status.tsx:119` | `SessionStatusPill` | animate-pulse | not a loading stand-in at all — the pulse is the live state of a session |
| `apps/web/src/components/app-shell-frame.tsx:450` | `AppShellAccountSkeleton` | skeleton | the signed-in account's name, email and avatar — unknown until a session resolves |
| `apps/web/src/components/app-shell-frame.tsx:452` | `AppShellAccountSkeleton` | skeleton | the signed-in account's name, email and avatar — unknown until a session resolves |
| `apps/web/src/components/app-shell-frame.tsx:453` | `AppShellAccountSkeleton` | skeleton | the signed-in account's name, email and avatar — unknown until a session resolves |
| `apps/web/src/components/app-shell-frame.tsx:471` | `AppShellAgendaSkeleton` | skeleton | the signed-in person's agenda and day plan — per-user reads with no viewer yet |
| `apps/web/src/components/app-shell-frame.tsx:472` | `AppShellAgendaSkeleton` | skeleton | the signed-in person's agenda and day plan — per-user reads with no viewer yet |
| `apps/web/src/components/app-shell-frame.tsx:473` | `AppShellAgendaSkeleton` | skeleton | the signed-in person's agenda and day plan — per-user reads with no viewer yet |
| `apps/web/src/components/athena/athena-conversation.tsx:150` | `AthenaConversation` | skeleton | the conversation's own history — how many turns exist, who said what, and |
| `apps/web/src/components/athena/athena-conversation.tsx:151` | `AthenaConversation` | skeleton | the conversation's own history — how many turns exist, who said what, and |
| `apps/web/src/components/athena/athena-conversation.tsx:152` | `AthenaConversation` | skeleton | the conversation's own history — how many turns exist, who said what, and |
| `apps/web/src/components/athena/athena-panel-provider.tsx:342` | `AthenaRailPanel` | skeleton | Athena's work queue, or the detail of the item selected in it. |
| `apps/web/src/components/athena/athena-panel-provider.tsx:343` | `AthenaRailPanel` | skeleton | Athena's work queue, or the detail of the item selected in it. |
| `apps/web/src/components/athena/athena-panel-provider.tsx:344` | `AthenaRailPanel` | skeleton | Athena's work queue, or the detail of the item selected in it. |
| `apps/web/src/components/athena/athena-workspace.tsx:330` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:331` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:332` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:334` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:431` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/athena-workspace.tsx:432` | `AthenaWorkspace` | skeleton | the session list and the pane beside it — which Athena sessions exist, how |
| `apps/web/src/components/athena/elicitation-queue.tsx:88` | `ElicitationQueue` | skeleton | how many questions are open and how tall each card is. The surface around |
| `apps/web/src/components/athena/mail-inbox.tsx:79` | `AddressCard` | skeleton | the reader's own Athena inbox address. |
| `apps/web/src/components/athena/mail-inbox.tsx:276` | `MailInbox` | skeleton | the messages waiting in the reader's Athena inbox. |
| `apps/web/src/components/athena/mail-inbox.tsx:277` | `MailInbox` | skeleton | the messages waiting in the reader's Athena inbox. |
| `apps/web/src/components/athena/mail-message-view.tsx:76` | `MailMessageView` | skeleton | the message's subject line and its body. |
| `apps/web/src/components/athena/mail-message-view.tsx:77` | `MailMessageView` | skeleton | the message's subject line and its body. |
| `apps/web/src/components/athena/phone-call-summary-sheet.tsx:103` | `PhoneCallSummarySheet` | skeleton | what the call covered, which is summarised after it ends. |
| `apps/web/src/components/athena/phone-call-summary-sheet.tsx:104` | `PhoneCallSummarySheet` | skeleton | what the call covered, which is summarised after it ends. |
| `apps/web/src/components/athena/voice-phone-numbers.tsx:830` | `VoicePhoneNumbers` | skeleton | the phone numbers this workspace has provisioned for Athena. |
| `apps/web/src/components/athena/voice-phone-numbers.tsx:831` | `VoicePhoneNumbers` | skeleton | the phone numbers this workspace has provisioned for Athena. |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx:137` | `CalendarItemDrawerContent` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx:138` | `CalendarItemDrawerContent` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/calendar-item-drawer.tsx:139` | `CalendarItemDrawerContent` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/item-drawer/event-arc.tsx:52` | `EventArc` | skeleton | **unannotated** |
| `apps/web/src/components/calendar/item-drawer/event-arc.tsx:53` | `EventArc` | skeleton | **unannotated** |
| `apps/web/src/components/canvas/task-graph-panel.tsx:605` | `TaskGraphPanel` | skeleton | the graph itself — which tasks and dependencies exist, and therefore the shape of the layout. There is no meaningful partial rendering of a node-link diagram, so the canvas area is covered while its toolbar and controls stay live. |
| `apps/web/src/components/command-palette/command-palette.tsx:356` | `CommandPalette` | skeleton | the search results for what has been typed — how many match and what |
| `apps/web/src/components/command-palette/command-palette.tsx:357` | `CommandPalette` | skeleton | the search results for what has been typed — how many match and what |
| `apps/web/src/components/command-palette/command-palette.tsx:358` | `CommandPalette` | skeleton | the search results for what has been typed — how many match and what |
| `apps/web/src/components/cycles/active-cycle-overview.tsx:238` | `ActiveCycleOverview` | skeleton | this cycle's committed/completed counts, which arrive with the roster. |
| `apps/web/src/components/cycles/active-cycle-overview.tsx:250` | `ActiveCycleOverview` | skeleton | this cycle's committed/completed counts, which arrive with the roster. |
| `apps/web/src/components/cycles/cycle-row.tsx:118` | `CycleProgress` | skeleton | this Cycle's completed-versus-committed counts, read per Cycle. |
| `apps/web/src/components/cycles/cycle-row.tsx:119` | `CycleProgress` | skeleton | this Cycle's completed-versus-committed counts, read per Cycle. |
| `apps/web/src/components/cycles/cycle-row.tsx:143` | `CyclePoints` | skeleton | this Cycle's capacity or carryover, which comes from the same per-Cycle read. |
| `apps/web/src/components/editor/document-figure-node-view.tsx:176` | `FigureMedia` | status-loader | the image itself, which exists only once its upload completes. |
| `apps/web/src/components/entity-detail/latest-update-summary.tsx:39` | `LatestUpdateSummary` | animate-pulse | the most recent update written about this record. |
| `apps/web/src/components/entity-detail/mentioned-resources.tsx:64` | `MentionedResources` | animate-pulse | the resources this document mentions, resolved from its prose. |
| `apps/web/src/components/entity-detail/updates-panel.tsx:230` | `submit` | skeleton | the posted updates — how many there are, who wrote each one, when, and what |
| `apps/web/src/components/entity-detail/updates-panel.tsx:232` | `submit` | skeleton | the posted updates — how many there are, who wrote each one, when, and what |
| `apps/web/src/components/entity-detail/updates-panel.tsx:233` | `submit` | skeleton | the posted updates — how many there are, who wrote each one, when, and what |
| `apps/web/src/components/initiatives/initiative-hierarchy-picker-overlay.tsx:351` | `InitiativeHierarchyPickerOverlay` | skeleton | the initiatives this one may be filed under. |
| `apps/web/src/components/initiatives/initiative-hierarchy-picker-overlay.tsx:352` | `InitiativeHierarchyPickerOverlay` | skeleton | the initiatives this one may be filed under. |
| `apps/web/src/components/initiatives/initiative-hierarchy-picker-overlay.tsx:353` | `InitiativeHierarchyPickerOverlay` | skeleton | the initiatives this one may be filed under. |
| `apps/web/src/components/library/library-client.tsx:392` | `LibraryClient` | skeleton | the library's resources, which the current filters decide, and the fields of whichever entry is opened beside them. |
| `apps/web/src/components/library/library-client.tsx:521` | `LibraryClient` | skeleton | the library's resources, which the current filters decide, and the fields of whichever entry is opened beside them. |
| `apps/web/src/components/library/resource-detail-panel.tsx:193` | `ResourceDetailPanel` | skeleton | the records that reference this resource. |
| `apps/web/src/components/mentions/mention-hovercard.tsx:154` | `MentionHoverCard` | skeleton | what kind of record this mention points at, and its own summary. |
| `apps/web/src/components/mentions/mention-hovercard.tsx:173` | `MentionHoverCard` | skeleton | what kind of record this mention points at, and its own summary. |
| `apps/web/src/components/mentions/mention-menu.tsx:142` | `MentionMenu` | skeleton | files matching the query, searched in connected providers. |
| `apps/web/src/components/mentions/mention-menu.tsx:143` | `MentionMenu` | skeleton | files matching the query, searched in connected providers. |
| `apps/web/src/components/mentions/mention-menu.tsx:164` | `MentionMenu` | skeleton | files matching the query, searched in connected providers. |
| `apps/web/src/components/mentions/mention-menu.tsx:165` | `MentionMenu` | skeleton | files matching the query, searched in connected providers. |
| `apps/web/src/components/mentions/mention-menu.tsx:166` | `MentionMenu` | skeleton | files matching the query, searched in connected providers. |
| `apps/web/src/components/my-work/live-session-pill.tsx:128` | `LiveSessionPill` | animate-pulse | not a loading stand-in — the pulse reports a session that is genuinely |
| `apps/web/src/components/onboarding/step-connect-provider-row.tsx:118` | `ProviderRow` | animate-pulse | whether this provider connects — the outcome of an OAuth round trip |
| `apps/web/src/components/people/people-list.tsx:140` | `PeopleList` | skeleton | the roster itself. Its length and its names are the only unknowns; the heading, the copy and the actions above are all static and already painted. |
| `apps/web/src/components/people/person-profile.tsx:140` | `PersonProfileView` | skeleton | the person's identity and their three work lists — none of it knowable before the read resolves. The page frame around it is static and already painted. |
| `apps/web/src/components/people/person-profile.tsx:141` | `PersonProfileView` | skeleton | the person's identity and their three work lists — none of it knowable before the read resolves. The page frame around it is static and already painted. |
| `apps/web/src/components/people/person-profile.tsx:143` | `PersonProfileView` | skeleton | the person's identity and their three work lists — none of it knowable before the read resolves. The page frame around it is static and already painted. |
| `apps/web/src/components/pickers/label-picker-overlay.tsx:259` | `LabelPickerOverlay` | skeleton | the workspace's labels, and which of them this record carries. |
| `apps/web/src/components/pickers/label-picker-overlay.tsx:260` | `LabelPickerOverlay` | skeleton | the workspace's labels, and which of them this record carries. |
| `apps/web/src/components/pickers/label-picker-overlay.tsx:261` | `LabelPickerOverlay` | skeleton | the workspace's labels, and which of them this record carries. |
| `apps/web/src/components/pickers/relation-target-picker-overlay.tsx:230` | `RelationTargetPickerOverlay` | skeleton | the records of this kind that the relation may point at. |
| `apps/web/src/components/pickers/relation-target-picker-overlay.tsx:231` | `RelationTargetPickerOverlay` | skeleton | the records of this kind that the relation may point at. |
| `apps/web/src/components/pickers/relation-target-picker-overlay.tsx:232` | `RelationTargetPickerOverlay` | skeleton | the records of this kind that the relation may point at. |
| `apps/web/src/components/programs/program-projects-panel.tsx:114` | `ProgramProjectsPanel` | skeleton | the projects filed under this program. |
| `apps/web/src/components/programs/program-projects-panel.tsx:115` | `ProgramProjectsPanel` | skeleton | the projects filed under this program. |
| `apps/web/src/components/programs/program-work-view.tsx:220` | `ProgramWorkView` | skeleton | the tasks belonging to this program's projects. |
| `apps/web/src/components/project-detail/project-dependencies.tsx:47` | `ProjectDependenciesPanel` | skeleton | what this project blocks and is blocked by — the linked items and their |
| `apps/web/src/components/project-detail/project-dependencies.tsx:48` | `ProjectDependenciesPanel` | skeleton | what this project blocks and is blocked by — the linked items and their |
| `apps/web/src/components/publishing/publishing-settings.tsx:74` | `PublishingSettings` | skeleton | this section's publishing controls, which depend on the reader's permission. |
| `apps/web/src/components/publishing/publishing-settings.tsx:179` | `PublishingSettings` | skeleton | this section's publishing controls, which depend on the reader's permission. |
| `apps/web/src/components/publishing/publishing-settings.tsx:196` | `PublishingSettings` | skeleton | this section's publishing controls, which depend on the reader's permission. |
| `apps/web/src/components/rail/day-tasks-panel.tsx:166` | `DayTasksPanel` | skeleton | today's planned tasks — how many there are and each one's title, time and |
| `apps/web/src/components/scheduling-plan/plan-surface.tsx:253` | `LensBody` | skeleton | this lens's own heading and body, both read per lens. |
| `apps/web/src/components/scheduling-plan/plan-surface.tsx:254` | `LensBody` | skeleton | this lens's own heading and body, both read per lens. |
| `apps/web/src/components/search/search-client.tsx:480` | `SearchClient` | skeleton | the matches for what has been typed — how many, and what each one is. |
| `apps/web/src/components/service-worker-provider.tsx:313` | `UpdateCard` | status-loader | none of this is unknown-until-fetch. The busy region reports the progress of an update the reader just accepted, so the live status is the content rather than a stand-in. |
| `apps/web/src/components/settings/automations-tab.tsx:322` | `submitRule` | skeleton | the automation rules this workspace has defined. |
| `apps/web/src/components/settings/billing-discounts-section.tsx:174` | `BillingDiscountsSection` | skeleton | the discounts applied to this workspace's subscription. |
| `apps/web/src/components/settings/billing-settings.tsx:138` | `BillingSettings` | skeleton | this workspace's plan, seat count and renewal, all read from the provider. |
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
| `apps/web/src/components/settings/google-calendar-settings.tsx:545` | `GoogleCalendarSettings` | animate-pulse | the connected Google accounts and their calendars — which exist, which are synced, and what each is named. Nothing about a connection roster is knowable in advance. |
| `apps/web/src/components/settings/gtasks-accounts-section.tsx:85` | `GtasksAccountsSection` | skeleton | the Google Tasks connections on this workspace — which accounts are |
| `apps/web/src/components/settings/gtasks-identity-picker.tsx:28` | `GtasksIdentityPicker` | skeleton | which linked Google identities are still available to connect — a set that depends on both the account's linked identities and what is already connected here. |
| `apps/web/src/components/settings/integration-config-panel.tsx:351` | `IntegrationConfigPanel` | skeleton | the containers (lists / projects / boards) this integration exposes, which |
| `apps/web/src/components/settings/integrations-status.tsx:29` | `IntegrationsStatus` | skeleton | which integrations this workspace has connected and the state of each. The first bar stands in for a connected provider's *name*, not a static section heading — the surrounding page renders its own headings before this component is reached. |
| `apps/web/src/components/settings/integrations-status.tsx:30` | `IntegrationsStatus` | skeleton | which integrations this workspace has connected and the state of each. The first bar stands in for a connected provider's *name*, not a static section heading — the surrounding page renders its own headings before this component is reached. |
| `apps/web/src/components/settings/integrations-status.tsx:31` | `IntegrationsStatus` | skeleton | which integrations this workspace has connected and the state of each. The first bar stands in for a connected provider's *name*, not a static section heading — the surrounding page renders its own headings before this component is reached. |
| `apps/web/src/components/settings/mail-ingest-section.tsx:41` | `MailIngestSection` | skeleton | which inboxes are connected and whether mail ingest is switched on for |
| `apps/web/src/components/settings/mcp-connectors-section.tsx:111` | `McpConnectorsSection` | skeleton | the MCP tools connected to this workspace — how many and what each one is. |
| `apps/web/src/components/settings/mcp-connectors-section.tsx:112` | `McpConnectorsSection` | skeleton | the MCP tools connected to this workspace — how many and what each one is. |
| `apps/web/src/components/settings/members-tab.tsx:172` | `MembersTab` | skeleton | the workspace roster and role catalog — who is a member, what role each holds, and whether the caller is permitted to change any of it. That last answer decides which controls exist at all, so rendering the panel before it arrives would show the wrong one. |
| `apps/web/src/components/settings/members-tab.tsx:173` | `MembersTab` | skeleton | the workspace roster and role catalog — who is a member, what role each holds, and whether the caller is permitted to change any of it. That last answer decides which controls exist at all, so rendering the panel before it arrives would show the wrong one. |
| `apps/web/src/components/settings/notion/notion-mirror-panel.tsx:143` | `NotionMirrorPanel` | skeleton | the connection's own state and the databases designed against it, both |
| `apps/web/src/components/settings/notion/notion-mirror-panel.tsx:144` | `NotionMirrorPanel` | skeleton | the connection's own state and the databases designed against it, both |
| `apps/web/src/components/settings/notion/notion-people-panel.tsx:72` | `NotionPeoplePanel` | skeleton | the external_actor mappings, which only the server has. |
| `apps/web/src/components/settings/notion/notion-people-panel.tsx:73` | `NotionPeoplePanel` | skeleton | the external_actor mappings, which only the server has. |
| `apps/web/src/components/settings/notion/notion-table-designer.tsx:124` | `NotionTableDesigner` | skeleton | the designed columns and a page of the workspace's own rows, both of |
| `apps/web/src/components/settings/notion/notion-table-designer.tsx:125` | `NotionTableDesigner` | skeleton | the designed columns and a page of the workspace's own rows, both of |
| `apps/web/src/components/settings/passkeys-section.tsx:124` | `PasskeysSection` | skeleton | the passkeys enrolled on this account, and when each was last used. |
| `apps/web/src/components/settings/security-tab.tsx:72` | `RecoveryCodesSection` | skeleton | whether recovery codes have been generated and how many remain unused. The panel is either "generate codes" or "you have N left" — opposite copy, so neither can be shown early without risking telling someone the wrong thing about their account recovery. |
| `apps/web/src/components/settings/sessions-section.tsx:136` | `SessionsSection` | skeleton | the account's active sessions — which devices are signed in, from where, and when they were last seen. Nothing about another device's session is knowable locally. |
| `apps/web/src/components/settings/settings-section-page.tsx:121` | `SettingsSectionPage` | status-loader | the section's body, whatever that section reads. One pending shape for every section. The header is already painted, so this stands in only for the body — two group-sized blocks, which is what most sections resolve into. |
| `apps/web/src/components/settings/settings-section-page.tsx:122` | `SettingsSectionPage` | skeleton | the section's body, whatever that section reads. One pending shape for every section. The header is already painted, so this stands in only for the body — two group-sized blocks, which is what most sections resolve into. |
| `apps/web/src/components/settings/settings-section-page.tsx:123` | `SettingsSectionPage` | skeleton | the section's body, whatever that section reads. One pending shape for every section. The header is already painted, so this stands in only for the body — two group-sized blocks, which is what most sections resolve into. |
| `apps/web/src/components/settings/team-mapping-picker.tsx:53` | `TeamMappingPicker` | skeleton | the external provider's own teams/containers, which only that provider can enumerate — the left-hand side of every mapping row. |
| `apps/web/src/components/settings/workspace-general-settings.tsx:145` | `update` | skeleton | this workspace's saved name, purpose and work-vocabulary overrides — the values |
| `apps/web/src/components/stream/stream-view.tsx:78` | `TimelineSkeleton` | animate-pulse | the stream's activity entries, each with its actor and its summary. |
| `apps/web/src/components/stream/stream-view.tsx:80` | `TimelineSkeleton` | animate-pulse | the stream's activity entries, each with its actor and its summary. |
| `apps/web/src/components/stream/stream-view.tsx:81` | `TimelineSkeleton` | animate-pulse | the stream's activity entries, each with its actor and its summary. |
| `apps/web/src/components/stream/stream-view.tsx:82` | `TimelineSkeleton` | animate-pulse | the stream's activity entries, each with its actor and its summary. |
| `apps/web/src/components/task-detail/task-activity-feed.tsx:177` | `post` | skeleton | this task's comments and activity, at the chosen filter. |
| `apps/web/src/components/task-detail/task-activity-feed.tsx:178` | `post` | skeleton | this task's comments and activity, at the chosen filter. |
| `apps/web/src/components/task-detail/task-detail-loading.tsx:61` | `TaskDetailLoading` | status-loader | the Task's assignee, its actions and its body — the parts of the record that only the detail read can answer. Its title, status and priority are not among them whenever a snapshot is in hand, which is why each of those is stated above rather than placeheld. |
| `apps/web/src/components/task-detail/task-detail-loading.tsx:92` | `TaskDetailLoading` | skeleton | the Task's assignee, its actions and its body — the parts of the record that only the detail read can answer. Its title, status and priority are not among them whenever a snapshot is in hand, which is why each of those is stated above rather than placeheld. |
| `apps/web/src/components/task-detail/task-detail-loading.tsx:97` | `TaskDetailLoading` | skeleton | the Task's assignee, its actions and its body — the parts of the record that only the detail read can answer. Its title, status and priority are not among them whenever a snapshot is in hand, which is why each of those is stated above rather than placeheld. |
| `apps/web/src/components/task-detail/task-detail-loading.tsx:98` | `TaskDetailLoading` | skeleton | the Task's assignee, its actions and its body — the parts of the record that only the detail read can answer. Its title, status and priority are not among them whenever a snapshot is in hand, which is why each of those is stated above rather than placeheld. |
| `apps/web/src/components/task-detail/task-detail-loading.tsx:100` | `TaskDetailLoading` | skeleton | the Task's assignee, its actions and its body — the parts of the record that only the detail read can answer. Its title, status and priority are not among them whenever a snapshot is in hand, which is why each of those is stated above rather than placeheld. |
| `apps/web/src/components/tasks/task-hierarchy-picker-overlay.tsx:129` | `TaskHierarchyPickerOverlay` | skeleton | the tasks this one may be filed under. |
| `apps/web/src/components/tasks/task-hierarchy-picker-overlay.tsx:130` | `TaskHierarchyPickerOverlay` | skeleton | the tasks this one may be filed under. |
| `apps/web/src/components/tasks/task-hierarchy-picker-overlay.tsx:131` | `TaskHierarchyPickerOverlay` | skeleton | the tasks this one may be filed under. |
| `apps/web/src/components/team-detail/team-people.tsx:121` | `TeamPeopleSkeleton` | skeleton | who is on this team, their titles, roles, and current load. |
| `apps/web/src/components/teams/team-card.tsx:181` | `TeamCardsSkeleton` | skeleton | how many teams the workspace has, and each one's cover, name, roster and counts. |
| `apps/web/src/components/teams/team-list-ui.tsx:219` | `ListSkeleton` | skeleton | the workspace's teams. |
| `apps/web/src/components/time-tracking/focus-immersive.tsx:105` | `FocusImmersive` | skeleton | the running timer, the task it is against, and that task's notes. |
| `apps/web/src/components/time-tracking/focus-immersive.tsx:106` | `FocusImmersive` | skeleton | the running timer, the task it is against, and that task's notes. |
| `apps/web/src/components/time-tracking/focus-immersive.tsx:107` | `FocusImmersive` | skeleton | the running timer, the task it is against, and that task's notes. |
| `apps/web/src/components/time-tracking/focus-immersive.tsx:132` | `FocusImmersive` | skeleton | the running timer, the task it is against, and that task's notes. |
| `apps/web/src/components/time-tracking/focus-immersive.tsx:133` | `FocusImmersive` | skeleton | the running timer, the task it is against, and that task's notes. |
| `apps/web/src/components/time-tracking/focus-immersive.tsx:134` | `FocusImmersive` | skeleton | the running timer, the task it is against, and that task's notes. |
| `apps/web/src/components/time-tracking/focus-panel.tsx:80` | `FocusPanel` | skeleton | whether a timer is running, and against which task. |
| `apps/web/src/components/time-tracking/focus-task-queue.tsx:155` | `FocusTaskQueue` | skeleton | the tasks matching what has been typed, searched as it is typed. |
| `apps/web/src/components/time-tracking/focus-task-queue.tsx:192` | `FocusTaskQueue` | skeleton | the tasks matching what has been typed, searched as it is typed. |
| `apps/web/src/components/time-tracking/focus-task-queue.tsx:193` | `FocusTaskQueue` | skeleton | the tasks matching what has been typed, searched as it is typed. |
| `apps/web/src/components/time-tracking/time-session-list.tsx:154` | `SessionSkeleton` | skeleton | the tracked sessions in the ledger, and the day each is grouped under. |
| `apps/web/src/components/today/day-plan.tsx:159` | `DayPlan` | skeleton | the tasks planned for today, across every workspace. |
| `apps/web/src/components/views/entity-detail-skeleton.tsx:106` | `EntityDetailSkeleton` | status-loader | one property whose value is part of the record being read. |
| `apps/web/src/components/views/entity-detail-skeleton.tsx:151` | `EntityDetailSkeleton` | skeleton | one property whose value is part of the record being read. |
| `apps/web/src/components/views/entity-detail-skeleton.tsx:180` | `EntityDetailBodySkeleton` | status-loader | the active tab's panel, still being assembled from the composite read. |
| `apps/web/src/components/work-views/project-dependency-lens.tsx:74` | `ProjectDependencyLens` | skeleton | the dependency graph — which projects block which, and in what order. |
| `apps/web/src/components/work-views/work-view-page.tsx:207` | `CardsSkeleton` | status-loader | the roster rows — how many there are, and each one's mark, name, and the two |
| `apps/web/src/components/work-views/work-view-page.tsx:218` | `CardsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two |
| `apps/web/src/components/work-views/work-view-page.tsx:220` | `CardsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two |
| `apps/web/src/components/work-views/work-view-page.tsx:221` | `CardsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two |
| `apps/web/src/components/work-views/work-view-page.tsx:226` | `CardsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two |
| `apps/web/src/components/work-views/work-view-page.tsx:227` | `CardsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two |
| `apps/web/src/components/work-views/work-view-page.tsx:230` | `CardsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two |
| `apps/web/src/components/work-views/work-view-page.tsx:231` | `CardsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two |
| `apps/web/src/components/work-views/work-view-page.tsx:234` | `CardsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two |
| `apps/web/src/components/work-views/work-view-page.tsx:235` | `CardsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two |
| `apps/web/src/components/work-views/work-view-page.tsx:241` | `CardsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two |
| `apps/web/src/components/work-views/work-view-page.tsx:242` | `CardsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two |
| `apps/web/src/components/work-views/work-view-page.tsx:263` | `RowsSkeleton` | status-loader | the roster rows — how many there are, and each one's mark, name, and the two metadata columns a wide viewport shows. |
| `apps/web/src/components/work-views/work-view-page.tsx:268` | `RowsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two metadata columns a wide viewport shows. |
| `apps/web/src/components/work-views/work-view-page.tsx:272` | `RowsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two metadata columns a wide viewport shows. |
| `apps/web/src/components/work-views/work-view-page.tsx:273` | `RowsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two metadata columns a wide viewport shows. |
| `apps/web/src/components/work-views/work-view-page.tsx:275` | `RowsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two metadata columns a wide viewport shows. |
| `apps/web/src/components/work-views/work-view-page.tsx:276` | `RowsSkeleton` | skeleton | the roster rows — how many there are, and each one's mark, name, and the two metadata columns a wide viewport shows. |
| `packages/ui/src/components/pickers/PickerList.tsx:434` | `PickerList` | skeleton | the options matching the current query, which only the caller's still-pending request can name. Placeholder rows, not "No matches": the request has not answered yet, and a search box that reports absence before it knows is the most reliable way to make someone stop typing a term that would have worked. |
| `packages/ui/src/components/pickers/PickerList.tsx:435` | `PickerList` | skeleton | the options matching the current query, which only the caller's still-pending request can name. Placeholder rows, not "No matches": the request has not answered yet, and a search box that reports absence before it knows is the most reliable way to make someone stop typing a term that would have worked. |
| `packages/ui/src/components/shell/ShellActivityBar.tsx:95` | `ShellActivityBar` | animate-pulse | none. This dot reports a panel's live status — its pulse is the `attention` tone, not a stand-in for something still being read. |
| `packages/ui/src/components/shell/WorkspaceSwitcher.tsx:234` | `WorkspaceSwitcher` | skeleton | the active workspace's name and avatar — the one value in the sidebar that cannot be known before `GET /v1/orgs` resolves. The trigger *button* itself is static chrome and is always rendered (disabled while the list is unknown); only its identity is stood in for. |
| `packages/ui/src/primitives/skeleton.tsx:31` | `Skeleton` | animate-pulse | nothing — this is the primitive itself, not a usage. Every real stand-in is a caller of this component, and each of those carries its own annotation naming the unknown-until-fetch data it covers. Inventoried because the scan matches on the markup. |
| `packages/ui/src/primitives/skeleton.tsx:70` | `SkeletonText` | skeleton | one line of text the caller names in its own annotation. `corner-xs`, not `rounded-lg`. Tailwind v4's bare `rounded` is a static 0.25rem utility rather than a step derived from `--radius`, so the two are 4px and 10px — a 10px corner on a 16px text placeholder is nearly a stadium, and stops it reading as the line of text it stands for. `corner-xs` is 4px exactly, so this keeps the shape and only changes the name. |
| `packages/ui/src/primitives/skeleton.tsx:116` | `SkeletonGlyph` | skeleton | the entity's icon, which is part of the record still being read. |
