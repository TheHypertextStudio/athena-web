# Task Header Responsive Overflow

## Objective

Keep the task-detail metadata and action controls on exactly one line at every container width.
Controls that no longer fit must remain available through the existing task-actions overflow menu;
the header must never wrap or introduce horizontal scrolling.

## Responsive contract

The row has a fixed visibility priority:

1. Status remains inline at every width.
2. Priority and assignee remain inline while the container has room.
3. Tracking and `Have Athena handle this` remain inline only at the widest tier.
4. The task-actions ellipsis remains inline at every width and contains every control omitted from
   the current tier, plus `Delete task` when the viewer can manage the workspace.

At the compact tier the visible row is therefore Status plus the ellipsis. At the middle tier it is
Status, Priority, Assignee, and the ellipsis. At the wide tier all controls are inline, with the
ellipsis retaining the same action set. Delegate information is read-only context rather than an
action; it appears only at the wide tier and may leave the row without a menu equivalent.

Container queries, rather than viewport media queries or JavaScript measurement, choose the tier.
The task surface can be narrowed by shell rails and panels without changing the window width, so
the available page container is the only truthful responsive input.

## Components and behavior

Extract the header controls from the route component into a focused task-header control component.
It owns the one-row structure, breakpoint visibility, and overflow menu. The route continues to own
task data and mutations and passes typed callbacks into the control component.

The overflow menu uses native menu items and submenus:

- Tracking invokes the same start, pause, or resume behavior and exposes the same disabled state as
  the inline timer control.
- Athena opens the same personal dock with the same task context.
- Priority and assignee submenus show the current selection and call the existing patch mutations.
- Delete opens the existing confirmation dialog and appears only for workspace managers.

CSS-hidden inline controls use `display: none`, while their menu equivalents remain available
through the ellipsis. The menu intentionally retains those actions at wider tiers too: opening a
single predictable action menu is preferable to changing its contents at each CSS tier, especially
because its portalled content cannot inherit the header's named container. The menu trigger exists
for every viewer, not only workspace managers.

## Failure and pending states

Existing pending behavior remains authoritative. Priority and assignee choices are disabled while
their mutation is in flight. Tracking uses its existing timer transition state. Task mutation
errors continue to render in the route-owned alert below the header row. Opening Athena is a local
panel action and keeps its existing error behavior.

## Testing

Component regression coverage will prove that:

- neither the control row nor its nested clusters can wrap;
- the ellipsis is available to non-managers as well as managers;
- the compact overflow exposes Tracking, Athena, Priority, and Assignee;
- the management-only Delete action keeps its permission boundary;
- selecting overflow actions calls the same callbacks as their inline counterparts.

The focused component suite runs first through a red-green cycle. The repository typecheck, lint,
test, and build gates run before the implementation commit.
