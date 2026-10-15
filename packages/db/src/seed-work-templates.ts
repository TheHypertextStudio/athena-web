import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { and, eq } from 'drizzle-orm';

import type { Database } from './client';
import { genId } from './id';
import { template, workTypeVersion } from './schema/work-template';

/** A workspace's four base identities and their current published versions. */
export type SeededWorkTemplates = ReadonlyMap<
  TemplateTargetType,
  {
    readonly workTypeId: string;
    readonly workTypeVersionId: string;
  }
>;

/** Handle accepted by bootstrap and migration, including an existing transaction. */
export type WorkTemplateSeedDatabase = Pick<Database, 'insert' | 'select' | 'update'>;

/** Transaction boundary independent of a driver's optional relational-query schema. */
export type WorkTemplateProvisionDatabase = WorkTemplateSeedDatabase & {
  transaction<T>(operation: (transaction: WorkTemplateSeedDatabase) => Promise<T>): Promise<T>;
};

const KINDS = ['initiative', 'program', 'project', 'task'] as const;

async function seedBase(
  connection: WorkTemplateSeedDatabase,
  input: { organizationId: string; kind: TemplateTargetType; createdBy: string | null },
): Promise<{ workTypeId: string; workTypeVersionId: string }> {
  const definition = WorkTemplateDefinition.parse({
    name: `Blank ${input.kind}`,
    payload: { targetType: input.kind },
  });
  await connection
    .insert(template)
    .values({
      id: genId(),
      organizationId: input.organizationId,
      createdBy: input.createdBy,
      targetType: input.kind,
      name: definition.name,
      payload: definition.payload,
      scope: 'organization',
      isBase: true,
      publicationState: 'draft',
      draftDefinition: definition,
    })
    .onConflictDoNothing();
  const [base] = await connection
    .select()
    .from(template)
    .where(
      and(
        eq(template.organizationId, input.organizationId),
        eq(template.targetType, input.kind),
        eq(template.isBase, true),
      ),
    )
    .limit(1)
    .for('update');
  if (!base) throw new Error('Base template provisioning did not produce a definition.');
  if (base.latestPublishedVersionId)
    return { workTypeId: base.id, workTypeVersionId: base.latestPublishedVersionId };
  const versionId = genId();
  await connection.insert(workTypeVersion).values({
    id: versionId,
    organizationId: input.organizationId,
    workTypeId: base.id,
    number: 1,
    definition,
    publishedByActorId: input.createdBy,
  });
  await connection
    .update(template)
    .set({
      publicationState: 'published',
      latestPublishedVersionId: versionId,
    })
    .where(eq(template.id, base.id));
  return { workTypeId: base.id, workTypeVersionId: versionId };
}

/** Provision missing bases inside the caller's transaction without resetting published outlines. */
export async function seedBaseWorkTemplatesInTransaction(
  connection: WorkTemplateSeedDatabase,
  organizationId: string,
  createdBy: string | null = null,
): Promise<SeededWorkTemplates> {
  const transaction = connection;
  const existing = await transaction
    .select()
    .from(template)
    .where(and(eq(template.organizationId, organizationId), eq(template.isBase, true)));
  const result = new Map<TemplateTargetType, { workTypeId: string; workTypeVersionId: string }>();
  for (const kind of KINDS) {
    const base = existing.find((entry) => entry.targetType === kind);
    const identity = base?.latestPublishedVersionId
      ? { workTypeId: base.id, workTypeVersionId: base.latestPublishedVersionId }
      : await seedBase(transaction, { organizationId, kind, createdBy });
    result.set(kind, identity);
  }
  return result;
}

/** Atomically provision a workspace's four required base templates using the existing ID generator. */
export async function seedBaseWorkTemplates(
  database: WorkTemplateProvisionDatabase,
  organizationId: string,
  createdBy: string | null = null,
): Promise<SeededWorkTemplates> {
  return database.transaction((transaction) =>
    seedBaseWorkTemplatesInTransaction(transaction, organizationId, createdBy),
  );
}
