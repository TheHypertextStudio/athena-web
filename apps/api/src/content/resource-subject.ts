import { db, initiative, program, project, task, type attachment, type Database } from '@docket/db';
import { canActor, type Capability } from '@docket/authz';
import { AttachmentOut, type WorkResourceSubjectType } from '@docket/work/attachment-contract';
import { and, eq, isNull } from 'drizzle-orm';
import { CapabilityError, NotFoundError } from '../error';
import { assertTaskCapability, buildTaskViewFilter, loadTask } from '../routes/task-helpers';
import { assertSharedWorkWritable } from '../product-capability';

/** An authenticated actor and one exact work destination. */
export interface ResourceSubject {
  readonly orgId: string;
  readonly actorId: string;
  readonly subjectType: WorkResourceSubjectType;
  readonly subjectId: string;
}

/** Load current work and enforce view or contribution without relying on an index. */
export async function authorizeResourceSubject(
  input: ResourceSubject,
  required: 'view' | 'contribute',
  database: Database = db,
): Promise<void> {
  const { orgId, actorId, subjectType, subjectId } = input;
  if (subjectType === 'task') {
    const row = await loadTask(orgId, subjectId, database);
    if (row.archivedAt || !(await buildTaskViewFilter(orgId, actorId, database))(row))
      throw new NotFoundError();
    if (required === 'contribute')
      await assertTaskCapability(orgId, actorId, row, required, database);
  } else {
    await authorizeContainer(input, required, database);
  }
  if (required === 'contribute') await assertSharedWorkWritable(orgId, undefined, database);
}

async function authorizeContainer(
  input: ResourceSubject,
  required: Capability,
  database: Database,
): Promise<void> {
  const { orgId, actorId, subjectType, subjectId } = input;
  const tables = { task, project, program, initiative };
  const table = tables[subjectType];
  const [row] = await database
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, orgId), eq(table.id, subjectId), isNull(table.archivedAt)))
    .limit(1);
  if (!row) throw new NotFoundError();
  const access = await canActor(
    actorId,
    required,
    { kind: subjectType, id: subjectId, orgId },
    database,
  );
  if (!access.allow) {
    if (access.effectiveCapability === null) throw new NotFoundError();
    throw new CapabilityError();
  }
}

/** Project attachment display fields without exposing its blob key or retry identity. */
export function attachmentOutput(row: typeof attachment.$inferSelect): AttachmentOut {
  return AttachmentOut.parse({
    id: row.id,
    organizationId: row.organizationId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    kind: row.kind,
    title: row.title,
    url: row.url,
    sourceIntegrationId: row.sourceIntegrationId,
    externalId: row.externalId,
    metadata: row.metadata as Record<string, unknown> | null,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    createdAt: row.createdAt.toISOString(),
  });
}
