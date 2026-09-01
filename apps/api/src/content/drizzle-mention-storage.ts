/**
 * The Drizzle implementation of the mention slice's storage ports.
 *
 * @remarks
 * The only module in this slice that knows the tables exist. Everything above it depends on
 * {@link MentionStorage}, so the services are testable against an in-memory double and a schema
 * change lands here rather than across five call sites.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { MentionEntityKind, MentionSubjectType } from '../contracts/mention';

import type {
  ExternalResourceRepository,
  MentionDraft,
  MentionRepository,
  MentionStorage,
  MentionSubject,
  MentionSubjectReader,
  MentionSubjectRow,
  ResourceDraft,
  StoredMention,
  StoredResource,
} from './mention-ports';

/** Collect the named Markdown columns of a loaded row. */
function readProse(
  row: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, string> {
  const prose: Record<string, string> = {};
  for (const field of fields) {
    const value = row[field];
    if (typeof value === 'string') prose[field] = value;
  }
  return prose;
}

/** Build the slice's storage over the app database. */
export function createDrizzleMentionStorage(): MentionStorage {
  const mentions: MentionRepository = {
    async listForSubject(subject: MentionSubject): Promise<readonly StoredMention[]> {
      const schema = await import('@docket/db');
      const rows = await schema.db
        .select()
        .from(schema.mention)
        .where(
          and(
            eq(schema.mention.organizationId, subject.organizationId),
            eq(schema.mention.subjectType, subject.subjectType),
            eq(schema.mention.subjectId, subject.subjectId),
          ),
        )
        .orderBy(asc(schema.mention.field), asc(schema.mention.position));
      return rows.map((row) => ({
        id: row.id,
        field: row.field,
        position: row.position,
        label: row.label,
        targetKind: row.targetKind,
        targetEntityKind: row.targetEntityKind,
        targetEntityId: row.targetEntityId,
        externalResourceId: row.externalResourceId,
      }));
    },

    async replaceForSubject(
      subject: MentionSubject,
      createdBy: string | null,
      desired: readonly MentionDraft[],
    ): Promise<void> {
      const schema = await import('@docket/db');
      // Delete-then-insert inside one transaction, because the caller has derived the complete
      // truth: a diff would be more statements for the same outcome, and would leave the table
      // briefly disagreeing with the prose if it were interrupted between them.
      await schema.db.transaction(async (tx) => {
        await tx
          .delete(schema.mention)
          .where(
            and(
              eq(schema.mention.subjectType, subject.subjectType),
              eq(schema.mention.subjectId, subject.subjectId),
            ),
          );
        if (desired.length === 0) return;
        await tx.insert(schema.mention).values(
          desired.map((draft) => ({
            organizationId: subject.organizationId,
            createdBy,
            subjectType: subject.subjectType,
            subjectId: subject.subjectId,
            field: draft.field,
            position: draft.position,
            targetKind: draft.ref.kind,
            targetEntityKind: draft.ref.kind === 'entity' ? draft.ref.entityKind : null,
            targetEntityId: draft.ref.kind === 'entity' ? draft.ref.entityId : null,
            externalResourceId: draft.externalResourceId ?? null,
            label: draft.label,
          })),
        );
      });
    },

    async deleteForSubject(subjectType: MentionSubjectType, subjectId: string): Promise<void> {
      const schema = await import('@docket/db');
      await schema.db
        .delete(schema.mention)
        .where(
          and(eq(schema.mention.subjectType, subjectType), eq(schema.mention.subjectId, subjectId)),
        );
    },
  };

  const resources: ExternalResourceRepository = {
    async findOrCreate(draft: ResourceDraft): Promise<string | undefined> {
      const schema = await import('@docket/db');
      await schema.db
        .insert(schema.externalResource)
        .values({
          organizationId: draft.organizationId,
          createdBy: draft.createdBy,
          provider: draft.provider,
          canonicalKey: draft.canonicalKey,
          canonicalUrl: draft.canonicalUrl,
          externalId: draft.externalId ?? null,
          resourceType: draft.resourceType,
        })
        .onConflictDoNothing({
          target: [schema.externalResource.organizationId, schema.externalResource.canonicalKey],
        });

      const rows = await schema.db
        .select({ id: schema.externalResource.id })
        .from(schema.externalResource)
        .where(
          and(
            eq(schema.externalResource.organizationId, draft.organizationId),
            eq(schema.externalResource.canonicalKey, draft.canonicalKey),
          ),
        )
        .limit(1);
      return rows[0]?.id;
    },

    async findByIds(organizationId, ids): Promise<readonly StoredResource[]> {
      if (ids.length === 0) return [];
      const schema = await import('@docket/db');
      const rows = await schema.db
        .select()
        .from(schema.externalResource)
        .where(
          and(
            eq(schema.externalResource.organizationId, organizationId),
            inArray(schema.externalResource.id, [...ids]),
          ),
        );
      return rows;
    },

    async findByKeys(organizationId, keys): Promise<readonly StoredResource[]> {
      if (keys.length === 0) return [];
      const schema = await import('@docket/db');
      const rows = await schema.db
        .select()
        .from(schema.externalResource)
        .where(
          and(
            eq(schema.externalResource.organizationId, organizationId),
            inArray(schema.externalResource.canonicalKey, [...keys]),
          ),
        );
      return rows;
    },
  };

  const subjects: MentionSubjectReader = {
    async read(
      subjectType: MentionSubjectType,
      entityId: string,
      organizationId: string,
      fields: readonly string[],
    ): Promise<MentionSubjectRow | undefined> {
      const schema = await import('@docket/db');
      const tables = {
        task: schema.task,
        project: schema.project,
        program: schema.program,
        initiative: schema.initiative,
        comment: schema.comment,
        update: schema.update,
        team: schema.team,
      } as const;
      const table = tables[subjectType];
      const rows = await schema.db
        .select()
        .from(table)
        .where(and(eq(table.id, entityId), eq(table.organizationId, organizationId)))
        .limit(1);
      const row = rows[0];
      if (!row) return undefined;
      // `team` is the one subject that predates `auditColumns()` and so records no creator. The
      // field is nullable precisely for cases like this, and inventing an author would be worse
      // than admitting there isn't one.
      return {
        createdBy: 'createdBy' in row ? row.createdBy : null,
        prose: readProse(row, fields),
      };
    },

    async entityExists(
      organizationId: string,
      entityKind: MentionEntityKind,
      entityId: string,
    ): Promise<boolean> {
      const schema = await import('@docket/db');
      const tables = {
        task: schema.task,
        project: schema.project,
        program: schema.program,
        initiative: schema.initiative,
        cycle: schema.cycle,
        milestone: schema.milestone,
        team: schema.team,
        actor: schema.actor,
        agent_session: schema.agentSession,
        comment: schema.comment,
        update: schema.update,
      } as const;
      const table = tables[entityKind];
      const rows = await schema.db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, entityId), eq(table.organizationId, organizationId)))
        .limit(1);
      return rows.length > 0;
    },
  };

  return { mentions, resources, subjects };
}
