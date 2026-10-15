import { program, project, milestone, task } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { scheduleDocumentRoots, type ScheduleDocument } from './schedule-compiler';

/** Recheck nullable retained authority's actual private destinations without granting a fabricated actor. */
export async function assertNativeScheduleDestinations(
  tx: TemplateTransaction,
  organizationId: string,
  document: ScheduleDocument,
  ownerProgramId: string | null,
): Promise<void> {
  const fields = {
    programId: program,
    projectId: project,
    milestoneId: milestone,
    parentTaskId: task,
  };
  const references = scheduleDocumentRoots(document).flatMap(({ draft }) =>
    Object.entries(draft.root.placement).flatMap(([field, id]) =>
      typeof id === 'string' && field in fields
        ? [{ field: field as keyof typeof fields, id }]
        : [],
    ),
  );
  if (ownerProgramId) references.push({ field: 'programId', id: ownerProgramId });
  const checked = new Set<string>();
  for (const { field, id } of references) {
    if (checked.has(`${field}:${id}`)) continue;
    const table = fields[field];
    const [row] = await tx
      .select({ id: table.id })
      .from(table)
      .where(
        and(eq(table.organizationId, organizationId), eq(table.id, id), isNull(table.archivedAt)),
      )
      .limit(1);
    if (!row) throw new NotFoundError('Schedule destination not found');
    checked.add(`${field}:${id}`);
  }
}
