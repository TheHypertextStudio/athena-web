import {
  processInstance,
  processInstanceProject,
  processInstanceTask,
  processOccurrence,
  type Database,
} from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { OccurrenceOut } from '../../contracts/recurrence';
import { readableLegacyWork } from './legacy-work-visibility';

interface GeneratedReference {
  readonly instanceId: string;
  readonly id: string;
  readonly kind: 'task' | 'project';
}

async function generatedReferences(
  database: Database,
  organizationId: string,
  instanceIds: string[],
): Promise<GeneratedReference[]> {
  if (instanceIds.length === 0) return [];
  const [tasks, projects] = await Promise.all([
    database
      .select({ instanceId: processInstanceTask.instanceId, id: processInstanceTask.taskId })
      .from(processInstanceTask)
      .where(
        and(
          eq(processInstanceTask.organizationId, organizationId),
          inArray(processInstanceTask.instanceId, instanceIds),
        ),
      ),
    database
      .select({
        instanceId: processInstanceProject.instanceId,
        id: processInstanceProject.projectId,
      })
      .from(processInstanceProject)
      .where(
        and(
          eq(processInstanceProject.organizationId, organizationId),
          inArray(processInstanceProject.instanceId, instanceIds),
        ),
      ),
  ]);
  return [
    ...tasks.map((row) => ({ ...row, kind: 'task' as const })),
    ...projects.map((row) => ({ ...row, kind: 'project' as const })),
  ];
}

/** Serialize occurrence history with authorized links to generated projects and tasks. */
export async function occurrenceOutputs(
  database: Database,
  organizationId: string,
  seriesId: string,
  actorId: string,
): Promise<z.input<typeof OccurrenceOut>[]> {
  const rows = await database
    .select({ occurrence: processOccurrence, instanceId: processInstance.id })
    .from(processOccurrence)
    .leftJoin(
      processInstance,
      and(
        eq(processInstance.occurrenceId, processOccurrence.id),
        eq(processInstance.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(processOccurrence.organizationId, organizationId),
        eq(processOccurrence.seriesId, seriesId),
      ),
    )
    .orderBy(processOccurrence.scheduledFor);
  const references = await generatedReferences(
    database,
    organizationId,
    rows.flatMap((row) => (row.instanceId ? [row.instanceId] : [])),
  );
  const visible = await readableLegacyWork(database, { organizationId, actorId }, references);
  const firstVisible = new Map<string, string>();
  for (const reference of references) {
    const key = `${reference.instanceId}:${reference.kind}`;
    if (visible.has(`${reference.kind}:${reference.id}`) && !firstVisible.has(key)) {
      firstVisible.set(key, reference.id);
    }
  }
  return rows.map(({ occurrence, instanceId }) =>
    OccurrenceOut.parse({
      id: occurrence.id,
      seriesId: occurrence.seriesId,
      scheduledFor: occurrence.scheduledFor,
      originalScheduledFor: occurrence.originalScheduledFor,
      status: occurrence.status,
      processInstanceId: instanceId,
      taskId: firstVisible.get(`${instanceId}:task`) ?? null,
      projectId: firstVisible.get(`${instanceId}:project`) ?? null,
      resolvedAt: occurrence.resolvedAt?.toISOString() ?? null,
    }),
  );
}
