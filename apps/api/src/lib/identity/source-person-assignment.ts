import { project, sourcePersonReference, task, type db } from '@docket/db';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

/** The transaction used to keep native person fields and their source attribution consistent. */
export type SourcePersonTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The entity field whose provider identities jointly describe one native person value. */
export interface SourcePersonField {
  orgId: string;
  subjectType: string;
  subjectId: string;
  field: string;
}

/** A native single-person field resolves only when every source identity agrees on one person. */
export function canonicalSourcePerson(rows: readonly { actorId: string | null }[]): string | null {
  const people = new Set(rows.map((row) => row.actorId));
  return people.size === 1 ? (rows[0]?.actorId ?? null) : null;
}

/** Read all active source attributions for one entity field inside its write transaction. */
export async function sourceReferences(
  tx: SourcePersonTransaction,
  scope: SourcePersonField,
): Promise<(typeof sourcePersonReference.$inferSelect)[]> {
  return tx
    .select()
    .from(sourcePersonReference)
    .where(
      and(
        eq(sourcePersonReference.organizationId, scope.orgId),
        eq(sourcePersonReference.subjectType, scope.subjectType),
        eq(sourcePersonReference.subjectId, scope.subjectId),
        eq(sourcePersonReference.field, scope.field),
        isNull(sourcePersonReference.detachedAt),
      ),
    );
}

/** Update only a native field that still contains a value derived from these source records. */
export async function writeSourceAssignment(
  tx: SourcePersonTransaction,
  scope: SourcePersonField,
  actorId: string | null,
  expected?: readonly (string | null)[],
): Promise<boolean> {
  if (scope.subjectType === 'task' && scope.field === 'assignee') {
    const allowed = expected
      ? or(
          ...expected.map((id) =>
            id === null ? isNull(task.assigneeId) : eq(task.assigneeId, id),
          ),
        )
      : undefined;
    const changed = await tx
      .update(task)
      .set({ assigneeId: actorId, updatedAt: sql`${task.updatedAt}` })
      .where(and(eq(task.organizationId, scope.orgId), eq(task.id, scope.subjectId), allowed))
      .returning({ id: task.id });
    return changed.length > 0;
  }
  if (scope.subjectType === 'project' && scope.field === 'lead') {
    const allowed = expected
      ? or(...expected.map((id) => (id === null ? isNull(project.leadId) : eq(project.leadId, id))))
      : undefined;
    const changed = await tx
      .update(project)
      .set({ leadId: actorId, updatedAt: sql`${project.updatedAt}` })
      .where(and(eq(project.organizationId, scope.orgId), eq(project.id, scope.subjectId), allowed))
      .returning({ id: project.id });
    return changed.length > 0;
  }
  return true;
}

/** Recompute every affected native field when an identity is linked, corrected, or unlinked. */
export async function reconcileSourceAssignments(
  tx: SourcePersonTransaction,
  orgId: string,
  identityId: string,
  actorId: string | null,
): Promise<void> {
  const affected = await tx
    .select()
    .from(sourcePersonReference)
    .where(
      and(
        eq(sourcePersonReference.organizationId, orgId),
        eq(sourcePersonReference.externalActorId, identityId),
        isNull(sourcePersonReference.detachedAt),
      ),
    );
  for (const ref of affected) {
    const scope = {
      orgId,
      subjectType: ref.subjectType,
      subjectId: ref.subjectId,
      field: ref.field,
    };
    const before = await sourceReferences(tx, scope);
    const after = before.map((row) =>
      row.externalActorId === identityId ? { ...row, actorId } : row,
    );
    const expected = [
      ...new Set([canonicalSourcePerson(before), ...before.map((row) => row.actorId)]),
    ];
    const changed = await writeSourceAssignment(tx, scope, canonicalSourcePerson(after), expected);
    await tx
      .update(sourcePersonReference)
      .set({ actorId })
      .where(eq(sourcePersonReference.id, ref.id));
    if (!changed)
      await tx
        .update(sourcePersonReference)
        .set({ detachedAt: new Date() })
        .where(
          inArray(
            sourcePersonReference.id,
            before.map((row) => row.id),
          ),
        );
  }
}
