# Task Hierarchy Interactions and Task Graph Design

## Goal

Let people turn existing tasks into subtasks from the context menu or by dragging one task onto
another, with the same behavior for a single task and a selection. Make that hierarchy immediately
legible in the graph without confusing decomposition with blocking dependencies.

## Product semantics

- The task being acted on becomes a child of the searched-for or drop-target task.
- Any active task in the same workspace can be a parent, even across projects or teams.
- Hierarchy and dependency are independent. Creating a parent-child relationship never creates,
  removes, or reverses a blocking edge.
- A multi-selection moves as one operation. If both an ancestor and one of its descendants are
  selected, only the selected root moves; its selected descendants keep their existing positions
  within that subtree.
- A direct drop commits immediately and offers Undo. The context-menu/picker path is the complete
  keyboard and touch alternative to dragging.

## Actions and parent picker

The existing action that creates a new placeholder child is named **Create subtask**. A new
multi-object **Make subtask of...** action opens a task-hierarchy picker. An already nested task, or
a compatible selection of nested roots, also offers **Move to top level**.

The picker follows the existing Initiative hierarchy overlay rather than introducing a dialog. It
searches active tasks in the current workspace and shows each candidate's project and team context.
The selected tasks, all of their descendants, archived tasks, and tasks outside the current
workspace are not candidates. Choosing a parent commits immediately, closes the picker, and shows
a six-second Undo offer. Errors use application-owned copy and never expose exception or Problem
text.

The same registered action owns picker selection, task-row drops, inline-subtask drops, and Task
graph drops. No surface performs a private `PATCH parentTaskId` mutation.

## Selection and drag behavior

Canonical task tables participate in Athena's existing selection model: a plain row click selects,
Shift/Command-click extends the selection, keyboard commands extend or select all, and a visible
checkbox provides the pointer alternative. The task title remains a real link and therefore opens
the task without conflicting with row selection.

When a drag begins on a selected task, its ordered selection becomes the drag subject. The drag
representation names the first task and adds “and N more” when necessary. Existing scheduling
targets continue to read the primary dragged task; only hierarchy-aware task targets consume the
full object set.

Core task surfaces are hierarchy drop targets:

- task tables;
- the inline subtask list on task detail;
- Task graph task nodes.

Calendar and planner surfaces remain scheduling-only. A valid table or detail target receives the
same primary inset ring used by Initiative hierarchy drops and shows a translucent indented preview
row beneath the prospective parent. Invalid targets do not reflow; they show a no-drop cursor and a
short application-owned reason.

## Task graph hierarchy

The focused surface is named **Task graph**, because it visualizes both hierarchy and dependencies.
Hierarchy is always visible and uses the same restrained grammar as the Initiative tree: ordinary
task cards, a 48px child indent, and curved tonal continuation rails. It does not use nested rounded
boxes or collapse controls.

xyflow containers are structural rather than visible. A task with children is represented by a
transparent `taskBranch` node whose fixed header is the ordinary task card. Descendant task nodes
use `parentId` and positions relative to that branch. The branch's measured bounds cover the whole
subtree, while `dragHandle` limits movement to the task header so empty branch space never becomes
a misleading control. Parent nodes precede descendants in the xyflow node array.

During an in-canvas drag, the smallest valid task under the pointer becomes the target. A ghost
branch appears at its next child position and the relevant hierarchy rail extends to it. The origin
branches fade without committing a layout change. On drop, the hierarchy action commits and the
controlled graph animates to the new structure. Moving a branch carries its descendants. Native
list-to-graph drags use Athena's drag payload; in-canvas drags use xyflow's node-drag lifecycle and
intersection/coordinate APIs.

Subtask relations are not rendered as arrows when structural hierarchy is active. Dependency edges
remain real, directed edges between the actual task headers, including edges that cross hierarchy
containers. Blocked, ready, bottleneck, and critical-path calculations continue to read dependency
edges only.

## Graph layout

The graph builds a hierarchy forest from `parentTaskId`, recursively calculates each subtree's
bounds, and positions children vertically with a 48px indent. It then projects cross-tree
dependencies onto top-level roots and runs Dagre over those compound bounds. The original
dependency edges render between their real nested endpoints. This avoids asking Dagre to lay out
sub-flows whose children connect outside their containers, a limitation documented by xyflow.

Project, Team, and Milestone lanes group whole trees by the top-level task. A descendant that owns a
different project or team remains truthful through the context shown on its card; the tree is never
split across lanes. Filtering retains every ancestor of a visible match, matching the Initiative
hierarchy behavior.

The graph response remains backward compatible. Existing subtask-edge records stay in `GraphOut`
for other consumers, while the Task graph uses `parentTaskId` as its structural layout source and
does not render those records as edges.

## Atomic hierarchy contract

Add `POST /v1/orgs/:orgId/tasks/reparent`:

```ts
interface TaskReparentBatchIn {
  moves: Array<{
    taskId: TaskId;
    parentTaskId: TaskId | null;
  }>;
  preserveSelectedSubtrees: boolean;
}

interface TaskReparentBatchOut {
  moves: Array<{
    taskId: TaskId;
    previousParentTaskId: TaskId | null;
    parentTaskId: TaskId | null;
  }>;
}
```

The initial action sends every selected task toward one parent with
`preserveSelectedSubtrees: true`; the service removes redundant selected descendants. Undo sends
the returned roots back to their individual previous parents with preservation disabled.

The operation runs in one serializable transaction. Before updating any row it validates the
caller capability, active same-workspace subjects and targets, unique task ids, and the complete
post-move parent graph. Self-parenting or any direct or combined cycle rejects the entire operation
with the existing `dependency_cycle` code. Successful roots receive the same audit, search-index,
and observation side effects as `PATCH parentTaskId`. The existing PATCH route delegates to the
same service for compatibility.

## Accessibility and failure behavior

- Context/overflow menus and the searchable picker provide full keyboard and touch access.
- Graph nodes and table rows retain focus-visible treatment and announce selection state.
- The drag preview is supplemental; the target ring, cursor, and live-region status communicate
  the same pending relationship.
- Server rejection rolls optimistic caches back as one unit.
- Concurrent hierarchy changes are resolved by the serializable server transaction; the client
  never treats its eligibility snapshot as authoritative.
- Undo is atomic even when moved roots previously had different parents.

## Acceptance criteria

1. A task or task selection can be moved beneath a searched workspace task from the shared menu.
2. The same relationship can be created by dropping on task tables, inline subtasks, or Task graph
   nodes, with a clear pre-drop preview.
3. Selected subtrees retain their shape and no partial bulk move can commit.
4. Task hierarchy is always visible in the graph as indented cards and curved rails, without
   subtask arrows, nested panels, or collapse controls.
5. Dependency edges and all dependency-derived insights remain unchanged by hierarchy moves.
6. Undo restores every committed root to its prior parent atomically.
7. Existing calendar scheduling drags and Initiative hierarchy behavior do not regress.

## References

- [React Flow sub-flows](https://reactflow.dev/learn/layouting/sub-flows)
- [React Flow parent-child relation](https://reactflow.dev/examples/grouping/parent-child-relation)
- [React Flow instance intersection APIs](https://reactflow.dev/api-reference/types/react-flow-instance)
- [React Flow layout guidance](https://reactflow.dev/learn/layouting/layouting)
