# Focus Working Companion and Immersive Mode

> **Status:** Approved and implemented
> **Date:** 2026-08-09
> **Surfaces:** Focus rail, `/focus`, personal Athena work creation

## Product decision

Focus is a working companion, not a timer card stretched across a full-height rail and not a second
Athena conversation. The everyday rail keeps the live clock and immediate controls close to the
workspace while adding only the information that helps someone remain oriented: the tracked Task,
its workflow context, and truthful progress from today's Time Ledger.

Immersive Focus is additive. `/focus` is authenticated and query-hydrated like the application, but
it deliberately omits the application shell. The active Task receives the primary visual hierarchy;
timer controls, recent time, and the Athena interruption handoff live in a quieter supporting
column. Desktop entry prefers a stable named pop-out, while same-tab entry remains explicit and is
the automatic fallback for blocked pop-ups and mobile devices.

## Interaction contract

- An anchored timer title links directly to `/orgs/{organizationId}/tasks/{taskId}`. Renaming is a
  distinct control so navigation never depends on click timing or edit-mode knowledge.
- Task metadata is fetched, not inferred: workflow state, priority, due date, description, and
  subtask progress render only when the existing contracts provide them.
- Today shows the personal ledger's Human effort total and up to two recent real sessions. Anchored
  history rows link to their Task; unanchored history remains plain text.
- Pause and Finish stay prominent. Finishing leaves both surfaces in a useful idle state.
- “Return to workspace” focuses and closes a Docket-launched pop-out. In-tab Focus returns only to
  the validated same-origin route recorded at launch and falls back to `/today` when none exists.
- Timer mutations publish a storage signal so the rail and pop-out invalidate their independent
  query caches immediately instead of waiting for a foreground poll.

## Athena interruption handoff

The field label is **Hand something to Athena…**. Submission carries only the person's sentence—no
active Task, workspace, transcript, or Focus invocation context. Absent Athena context resolves to
the caller's Personal workspace; explicit context elsewhere remains authoritative.

Focus stores only the newest handoff id and shows only lifecycle copy:

- Pending or running: “Athena is handling it.”
- Completed: “Handled in Personal.”
- Waiting for input or approval: “Needs one detail.” with an Open link.
- Failed or canceled: concise application-owned copy with an Open link.

No agent reply, reasoning, activity, connector, provider message, or result summary is eligible for
rendering on a Focus surface.

## Visual direction

The design stays in Docket's calm Plex and Material 3 register. Tonal surfaces provide hierarchy;
hard borders are reserved for structural division. The rail has a purposeful bottom endpoint, and
the immersive layout collapses to one column without horizontal overflow at 320px. Focus rings,
touch targets, semantic links, reduced-motion behavior, and light/dark token parity are part of the
surface contract rather than follow-up polish.
