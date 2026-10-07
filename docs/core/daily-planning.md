# Daily planning

This is for product designers and engineers changing the daily flow. They should preserve the existing daily planner and its saved stages. Today remains the default home after planning.

Docket automatically opens the daily planner once per eligible local workday. The authenticated application shell shows “It’s time to plan your day.” and “Opening planner in 5 seconds.” Plan now opens the planner immediately. Escape also proceeds immediately. The dialog has no Later, close, skip, or dismissal action. Outside clicks leave it open.

Eligibility uses the scheduling timezone and the outer bounds of today’s non-personal availability windows. The API supplies its existing defaults when preferences are unset. An accepted day suppresses entry even when an adjustment draft exists. A loading or failed read never counts as an unplanned day. A person already in the daily planner continues there.

The countdown runs only while the document is visible and the window has focus. Losing either cancels entry without navigation. Returning reloads eligibility and starts a fresh five-second countdown. An active editor, another dialog, or an authentication transition prevents entry. Confirmation arriving during the countdown cancels it.

Navigation uses `/plan?view=day&date=YYYY-MM-DD` and the existing controller resumes the saved stage. A browser marker scoped to the user, timezone, and date records the committed destination and prevents repeated entry across reloads and tabs. Unavailable browser storage falls back to an in-memory marker. Automatic entry does not accept a plan or start tracking. The planner keeps its existing exit behavior.

This state machine shows the automatic entry lifecycle. Eligibility and successful reads allow the announcement. Leaving the foreground cancels it. Navigation records entry when the daily route commits.

```mermaid
stateDiagram-v2
    [*] --> Waiting
    Waiting --> Announcement: Eligible foreground workday
    Announcement --> Waiting: Accepted plan or editing interlock
    Announcement --> Background: Visibility or focus lost
    Background --> Waiting: Foreground returns and reads refresh
    Announcement --> Opening: Countdown reaches zero, Plan now, or Escape
    Opening --> Entered: Daily route commits and marker persists
    Entered --> Waiting: New local workday
```

The standard path is Review yesterday → Plan today → Review plan → Confirmation. A new user with no recent work starts at Plan today. Docket proposes eligible work when it exists, and Add work opens the task browser. A returning user resumes the saved draft at its last stage. A person who starts late sees the time still available before their chosen finish time. Work already completed or tracked stays visible as recorded work and does not become a new planned session. Tomorrow uses the same flow with tomorrow's date shown throughout.

Plan today keeps work and the agenda on the same screen at desktop width. A phone shows the agenda first during final review and retains editable work below it. Add work opens a separate searchable view and can create a task through the normal composer. A person can leave work under Unscheduled and still confirm. Each row can edit its title and planned minutes directly. Each block has explicit controls for scheduling, moving, changing duration, pinning, and removing. A task may have two planned sessions, and a block may hold two tasks.

Review plan keeps the agenda and work editable. Athena may add a short qualitative assessment, but an unavailable assistant does not delay confirmation. Unscheduled work names the affected tasks and provides scheduling, date, and removal actions. Start, finish, buffer, and task minutes remain editable. An adjustment shows what changed before Apply. Confirmation has its own screen and offers an explicit Start or Continue action when a task is next today. A tomorrow plan does not offer to start today's timer. Confirming by itself never starts a timer.

Today uses accepted allocations to show Now and the following work. Recorded time can satisfy the day's planned budget without completing the task. An active session remains current. A missed block offers Done, Still working, and Not started. Done opens exact-time entry so the person can correct what happened; it does not complete the task. The other choices open a remaining-day proposal. Fixed events and pinned blocks stay in place. Applying an accepted adjustment appends a revision, and Undo appends a restoring revision. The original plan and recorded time remain intact as separate facts.

Review day opens a bulk review of today's unfinished work before planning tomorrow. Work already selected for tomorrow stays selected unless the person chooses another destination or Done. Returning after several missed days consolidates unresolved commitments into one review. The review decision applies to older occurrences of the same unresolved task without rewriting accepted snapshots.

Athena can assess the visible plan and suggest missing project work, but no step requires it. Each suggestion has Add and Dismiss actions. Labels name work or actions. Supporting copy states a condition or consequence, and it avoids claims about what the interface is doing on the person's behalf.

Plan today opens with an ordered proposed schedule. Docket places existing commitments first, then suggests eligible work when useful capacity remains. Every suggestion includes a reason. Incomplete dependencies can keep a task visible under Unscheduled. Minute estimates and recorded history inform Planned time; points never become minutes. Start and finish remain editable, and the default buffer reserves 15% of free work time.

Moving a work card changes today's sequence. Moving or resizing a calendar block changes its placement or allocation time. Neither action changes task priority. Changes to future flexible work appear on the agenda before Apply, with Undo afterward. Manual placements, pinned blocks, fixed events, protected time, and recorded work remain intact.

A retained block that extends past an edited finish time names its affected tasks and offers Move or shorten block. Docket never extends the workday silently. Moving an unscheduled task to tomorrow keeps the current day stable until the write succeeds, and prevents confirming or leaving during that write.
