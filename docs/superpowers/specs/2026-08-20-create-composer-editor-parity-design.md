# Create composer editor parity

This design is for the web maintainer who implements or reviews Docket's shared create composer.
After reading it, that maintainer should make every object-create flow use the same editor,
continuation, sizing, and scrolling contract.

## Decision

`ComposerShell` will own the interaction that every create dialog shares. It will open as a compact
42rem modal. A labelled control beside Close will expand body-bearing composers in place to 64rem
and at most 85dvh. The context, title, summary, properties, errors, and footer will remain fixed.
Only the body editor will scroll, and its overscroll will not chain into the modal or page.

The shell will pass an explicit destination workspace to the body editor. The editor will keep its
existing slash-command extension and enable mentions against that destination. Changing the
destination will retarget mention search without replacing the draft.

Task, Project, Initiative, Program, Team, and Cycle creation will expose one off-by-default
Create more switch. Standard submission will follow the switch. Command-or-Control+Shift+Enter
will create and continue without changing it. Continued creates will update destination caches and
valid same-workspace launchers, suppress navigation, reset only object-specific identity fields,
and return focus to the title after the mutation unlocks it.

## Continuation resets

| Object     | Clear                                                         | Retain                                                                                          |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Task       | Title and description                                         | Team, workflow, priority, assignee, relationships, dates, labels, estimate, and repeat settings |
| Project    | Name, summary, and description                                | Team, lead, program, status, health, dates, and initiatives                                     |
| Initiative | Name, summary, and description                                | Owner, status, health, priority, target date, and cadence                                       |
| Program    | Name, summary, and description                                | Owner, status, health, and visibility                                                           |
| Team       | Name, generated key, summary, description, and agent guidance | Triage setting                                                                                  |
| Cycle      | Name                                                          | Team, status, and duration; the next window starts one day after the created closed interval    |

Cycle continuation will keep a local sequence floor so a fast second submit cannot reuse the
number from a roster that has not refreshed yet.

## Mention menu defect

The current menu applies `menuSeparator()` to an entire `role="group"` element. That utility
includes `h-px`, which collapses the group to one pixel while its heading and rows overflow. Every
later group then paints over its neighbours. The separator must render as its own presentational
child inside the group. Local groups and all external pending, failure, and empty states must use
the same structure.

## Failure and accessibility behavior

A failed create keeps every field. A successful continued create announces that the next draft is
ready and focuses its title after `creating` returns to false. Task's existing committed-object
recovery remains intact when post-create work fails. The expand control reads Expand editor or
Collapse editor. Create more remains a switch, and suggestion menus keep focus in the editor.

## Rejected approaches

Duplicating expansion and continuation in each composer would recreate the drift this change fixes.
A single generic object-creation state machine would centralize more code, but it would also replace
working entity-specific mutations and defaults. This design keeps shared interaction in the shell
and entity semantics in each composer.

## Boundaries

Template editors receive editor parity, contained scrolling, and expansion. They do not receive
Create more. Cycle has no body, so it receives continuation without a useless expansion control.
No API, database, or stored-preference change is required. A new object kind or a body editor that
cannot name its workspace would require revisiting this boundary.
