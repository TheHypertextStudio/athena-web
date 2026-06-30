/** `@docket/api` — task dependency-graph router (mounted at `/v1/orgs/:orgId/graph`). */
import { db, task, taskDependency } from '@docket/db';
import { GraphOut, type TaskGraphNode } from '@docket/types';
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
  projectId: z.string().optional(),
  rootTaskId: z.string().optional(),
  depth: z.coerce.number().int().min(1).max(5).optional(),
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
  };
}

/**
 * Graph router. One read returns the viewable node set for a scope plus the dependency
 * and subtask edges among those nodes (edges with an endpoint outside the set are pruned).
 * Membership is enforced by `orgContextMiddleware`; per-task visibility by the view filter.
 */
const graph = new Hono<AppEnv>().get(
  '/',
  apiDoc({ tag: 'Tasks', summary: 'Get the dependency graph', response: GraphOut }),
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
          id: `dep:${d.blocking}:${d.blocked}`,
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
          id: `sub:${t.parentTaskId}:${t.id}`,
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
