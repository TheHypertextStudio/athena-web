import type { TemplateTargetType } from '@docket/work/template-contract';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../client';
import { genId } from '../id';
import { template, workTypeVersion } from './schema';

/** Historical checkpoint transaction operations. */
export type MigrationConnection = Pick<Database, 'insert' | 'select' | 'update'>;
/** Base references produced by the fixed expansion schema. */
export type MigrationBases = ReadonlyMap<
  TemplateTargetType,
  {
    readonly workTypeId: string;
    readonly workTypeVersionId: string;
  }
>;

async function provisionBase(
  connection: MigrationConnection,
  organizationId: string,
  kind: TemplateTargetType,
): Promise<{ workTypeId: string; workTypeVersionId: string }> {
  const definition = WorkTemplateDefinition.parse({
    name: `Blank ${kind}`,
    payload: { targetType: kind },
  });
  await connection
    .insert(template)
    .values({
      id: genId(),
      organizationId,
      targetType: kind,
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
        eq(template.organizationId, organizationId),
        eq(template.targetType, kind),
        eq(template.isBase, true),
      ),
    )
    .limit(1)
    .for('update');
  if (!base) throw new Error('Base template provisioning did not produce a definition.');
  if (base.latestPublishedVersionId)
    return { workTypeId: base.id, workTypeVersionId: base.latestPublishedVersionId };
  const publication = WorkTemplateDefinition.parse({
    name: base.name,
    description: base.description,
    icon: base.icon,
    payload: base.payload,
    defaultStatusKey: base.draftDefinition?.defaultStatusKey ?? null,
  });
  const versionId = genId();
  await connection.insert(workTypeVersion).values({
    id: versionId,
    organizationId,
    workTypeId: base.id,
    number: 1,
    definition: publication,
  });
  await connection
    .update(template)
    .set({
      publicationState: 'published',
      latestPublishedVersionId: versionId,
      draftDefinition: base.draftDefinition ?? publication,
    })
    .where(eq(template.id, base.id));
  return { workTypeId: base.id, workTypeVersionId: versionId };
}

/** Provision bases with only 0151 columns, preserving any existing base's audit timestamps. */
export async function provisionMigrationBases(
  connection: MigrationConnection,
  organizationId: string,
): Promise<MigrationBases> {
  const existing = await connection
    .select()
    .from(template)
    .where(and(eq(template.organizationId, organizationId), eq(template.isBase, true)));
  const bases = new Map<TemplateTargetType, { workTypeId: string; workTypeVersionId: string }>();
  for (const kind of ['initiative', 'program', 'project', 'task'] as const) {
    const base = existing.find((row) => row.targetType === kind);
    bases.set(
      kind,
      base?.latestPublishedVersionId
        ? { workTypeId: base.id, workTypeVersionId: base.latestPublishedVersionId }
        : await provisionBase(connection, organizationId, kind),
    );
  }
  return bases;
}
