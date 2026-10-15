import { taskDependency, projectDependency } from '@docket/db';
import { sql } from 'drizzle-orm';
import type { TemplateTransaction } from './templates/persistence';
import { rawResultRowCount } from './raw-result';
/** Inspect existing and proposed edges together, without reading any work prose. */
export async function closesWorkspaceDependencyCycle(
  tx: TemplateTransaction,
  orgId: string,
  kind: 'task' | 'project',
  selected: readonly { readonly from: string; readonly to: string }[],
  removed: readonly { readonly from: string; readonly to: string }[] = [],
): Promise<boolean> {
  const table = kind === 'task' ? taskDependency : projectDependency;
  const from =
    kind === 'task' ? taskDependency.blockingTaskId : projectDependency.blockingProjectId;
  const to = kind === 'task' ? taskDependency.blockedTaskId : projectDependency.blockedProjectId;
  const proposed = JSON.stringify(selected.map((edge) => ({ source: edge.from, target: edge.to })));
  const removals = JSON.stringify(removed.map((edge) => ({ source: edge.from, target: edge.to })));
  const result = await tx.execute(sql`
    WITH RECURSIVE proposed AS (
      SELECT source, target FROM jsonb_to_recordset(${proposed}::jsonb) AS edge(source text, target text)
    ), removed AS (
      SELECT source, target FROM jsonb_to_recordset(${removals}::jsonb) AS edge(source text, target text)
    ), edges AS (
      SELECT ${from} AS source, ${to} AS target FROM ${table} WHERE ${table.organizationId} = ${orgId}
      AND NOT EXISTS (SELECT 1 FROM removed WHERE removed.source=${from} AND removed.target=${to})
      UNION SELECT source, target FROM proposed
    ), reachable(source, target) AS (
      SELECT source, target FROM proposed
      UNION SELECT reachable.source, edges.target FROM reachable JOIN edges ON edges.source = reachable.target
    ) SELECT 1 AS cycle FROM reachable WHERE source = target LIMIT 1
  `);
  return rawResultRowCount(result) > 0;
}
