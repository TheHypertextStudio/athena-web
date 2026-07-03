/** `@docket/api` — task dependency-graph router (mounted at `/v1/orgs/:orgId/graph`). */
import { db, task, taskDependency } from '@docket/db';
import { dependencyEdgeId, GraphOut, subtaskEdgeId, type TaskGraphNode } from '@docket/types';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zQuery } from '../lib/validate';

import { buildTaskViewFilter, loadNeighborhood, type TaskRow } from './task-helpers';

/**
 * Scope selector for the graph read. All three are host-driven and mutually layerable:
 * `rootTaskId` (neighborhood) takes precedence; otherwise `projectId` narrows to one
 * project; otherwise the whole org. Every scope is permission-filtered identically.
 */
const GraphQuery = z.object({
  projectId: z
    .string()
    .optional()
    .describe(
      'Narrow the graph to one project (active tasks with this `projectId`). Ignored when `rootTaskId` is set, which takes precedence. Omitting both scopes the graph to the whole org.',
    ),
  rootTaskId: z
    .string()
    .optional()
    .describe(
      "Center the graph on this task's neighborhood instead of a project/org scope. Takes precedence over `projectId`. The reachable radius is bounded by `depth`.",
    ),
  depth: z.coerce
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe(
      'Neighborhood radius (in edge hops) around `rootTaskId`. Integer 1–5; defaults to 2. Only meaningful together with `rootTaskId`.',
    ),
});

/** Project a task row into the slim graph-node shape. */
function toGraphNode(t: TaskRow): z.input<typeof TaskGraphNode> {
  return {
    id: t.id,
    title: t.title,
    state: t.state,
    priority: t.priority,
    teamId: t.teamId,
    projectId: t.projectId,
    assigneeId: t.assigneeId,
    parentTaskId: t.parentTaskId,
    startDate: t.startDate?.toISOString() ?? null,
    dueDate: t.dueDate?.toISOString() ?? null,
    estimate: t.estimate,
    milestoneId: t.milestoneId,
    cycleId: t.cycleId,
  };
}

/**
 * Graph router. One read returns the viewable node set for a scope plus the dependency
 * and subtask edges among those nodes (edges with an endpoint outside the set are pruned).
 * Membership is enforced by `orgContextMiddleware`; per-task visibility by the view filter.
 */
const graph = new Hono<AppEnv>().get(
  '/',
  apiDoc({
    tag: 'Tasks',
    summary: 'Get the dependency graph',
    response: GraphOut,
    description: `Return the task dependency canvas for a scope in a single read: the viewable node set plus the dependency and subtask edges among those nodes. Nodes are slim {@link TaskGraphNode} projections (id/title/state/priority/team/project/assignee/parent — no provenance or timestamps), sized for a node card and the layout engine.

Scope is selected by query and is layered, most-specific first: \`rootTaskId\` returns a neighborhood around that task bounded by \`depth\` (1–5, default 2); otherwise \`projectId\` narrows to one project; otherwise the whole org's active tasks. Every scope is permission-filtered identically — the candidate set is reduced to what the caller may view, so the graph never reveals a task the caller couldn't open directly. Requires org membership (\`view\`).

Edges are pre-pruned to the viewable set so there are no dangling endpoints: a \`dependency\` edge (\`source\` blocks \`target\`) is included only when both endpoints are viewable, and a \`subtask\` edge (\`parent → child\`) only when the parent is in the set. Each edge carries a stable synthetic \`id\` (\`dep:<a>:<b>\` or \`sub:<a>:<b>\`). Archived tasks are excluded. Returns {@link GraphOut}, ready to render as-is.`,
  }),
  zQuery(GraphQuery),
  async (c) => {
    const { orgId, actorId, roleId } = c.get('actorCtx');
    const { projectId, rootTaskId, depth } = c.req.valid('query');

    const canView = await buildTaskViewFilter(orgId, actorId, roleId);

    // 1. Candidate node set by scope, before access filtering.
    const candidates =
      rootTaskId !== undefined
        ? await loadNeighborhood(orgId, rootTaskId, depth ?? 2)
        : await db
            .select()
            .from(task)
            .where(
              and(
                eq(task.organizationId, orgId),
                isNull(task.archivedAt),
                ...(projectId !== undefined ? [eq(task.projectId, projectId)] : []),
              ),
            );

    // 2. Keep only what the caller may view; edges live within this set.
    const viewable = candidates.filter(canView);
    const ids = new Set(viewable.map((t) => t.id));
    const idsArr = [...ids];

    const edges: z.input<typeof GraphOut>['edges'] = [];

    // Dependency edges: both endpoints must be viewable.
    if (idsArr.length > 0) {
      const depRows = await db
        .select({
          blocking: taskDependency.blockingTaskId,
          blocked: taskDependency.blockedTaskId,
        })
        .from(taskDependency)
        .where(
          and(
            eq(taskDependency.organizationId, orgId),
            inArray(taskDependency.blockingTaskId, idsArr),
            inArray(taskDependency.blockedTaskId, idsArr),
          ),
        );
      for (const d of depRows) {
        edges.push({
          id: dependencyEdgeId(d.blocking, d.blocked),
          source: d.blocking,
          target: d.blocked,
          kind: 'dependency',
        });
      }
    }

    // Subtask edges: derivable from the nodes themselves (parent → child), parent in-set.
    for (const t of viewable) {
      if (t.parentTaskId !== null && ids.has(t.parentTaskId)) {
        edges.push({
          id: subtaskEdgeId(t.parentTaskId, t.id),
          source: t.parentTaskId,
          target: t.id,
          kind: 'subtask',
        });
      }
    }

    return ok(c, GraphOut, { nodes: viewable.map(toGraphNode), edges });
  },
);

export default graph;
