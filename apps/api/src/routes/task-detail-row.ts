import { db, task, team } from '@docket/db';
import type { SourcePersonReferenceOut } from '@docket/connections/integration-contract';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { sourcePersonProjection } from '../lib/identity/source-person-projection';

interface TaskDetailRow {
  row: typeof task.$inferSelect;
  workflowStates: typeof team.$inferSelect.workflowStates;
  sourcePeople: z.input<typeof SourcePersonReferenceOut>[];
}

/** Read an active task, its team's workflow, and source people in one tenant-scoped query. */
export async function loadTaskDetailRow(orgId: string, id: string): Promise<TaskDetailRow[]> {
  return db
    .select({
      row: task,
      workflowStates: team.workflowStates,
      sourcePeople: sourcePersonProjection(task.organizationId, 'task', task.id),
    })
    .from(task)
    .innerJoin(team, and(eq(task.teamId, team.id), eq(team.organizationId, orgId)))
    .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
    .limit(1);
}
