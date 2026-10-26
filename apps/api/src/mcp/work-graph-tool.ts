/** Read-only semantic dependency review, with a self-contained MCP App. */
import { z } from 'zod';
import { listWork, listWorkFilters } from './list-work';
import { GraphInput, GraphSnapshot } from '../work-graph/contract';
import { projectWorkGraph } from '../work-graph/projection';
import { readGraphData } from '../work-graph/source';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { WIDGET, widgetMeta } from './apps';
import { authorize, jsonResult, runTool, scopedActor } from './result';

/** Register dependency exploration for authorized human and agent callers. */
export function registerWorkGraphTool(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'view_work_graph',
    {
      title: 'View work graph',
      description:
        'See what remains, what blocks it, and what it unlocks. Read-only dependency graph for a task neighborhood, project, program or initiative, with expandable groups and completed work. Search finds authorized work across collapsed groups, completion filters and graph pages. Includes visible external dependency context; counts cover the selected scope, not just this scene.',
      inputSchema: {
        ...GraphInput.shape,
        focusFilter: z.object(listWorkFilters).strict().optional(),
      },
      outputSchema: GraphSnapshot.shape,
      _meta: widgetMeta(WIDGET.workGraph),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actor = await scopedActor(ctx, input.orgId, 'work:read');
        await authorize(actor, 'view', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const data = await readGraphData(input.orgId, actor.actorId);
        const matches = input.focusFilter
          ? new Set(
              (
                await listWork(
                  input.orgId,
                  actor.actorId,
                  'task',
                  input.focusFilter,
                  data.nodes.length + 1,
                  undefined,
                )
              ).map((n) => 'task:' + n.id),
            )
          : undefined;
        const snapshot = GraphSnapshot.parse(
          projectWorkGraph({ ...data, ...(matches ? { matches } : {}) }, input),
        );
        const result = jsonResult(snapshot);
        result.content = [
          {
            type: 'text',
            text: `${snapshot.scope.title}: ${snapshot.totals.remaining} remaining, ${snapshot.totals.completed} completed, ${snapshot.totals.canceled} canceled. Showing ${snapshot.nodes.length} work items${snapshot.omitted ? `; ${snapshot.omitted} more not shown` : ''}. Dependencies point from blocker to blocked work. Only recorded, visible relationships are shown.\n${JSON.stringify(snapshot, null, 2)}`,
          },
        ];
        return result;
      }),
  );
}
