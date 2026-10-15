import { BlueprintStepId } from '@docket/work/ids';
import { Blueprint, type Blueprint as BlueprintValue } from '@docket/work/work-template-blueprint';
import { and, eq } from 'drizzle-orm';

import type { Database } from './client';
import { genId } from './id';
import { blueprintDependency, blueprintStep } from './schema/work-template-blueprint';
import { workTypeVersion } from './schema/work-template';

/** Publication transaction surface; this helper never starts or commits a transaction. */
export type BlueprintProjectionTransaction = Pick<Database, 'insert' | 'select'>;

/** Exact publication whose immutable FK/index projection is being persisted. */
export interface BlueprintProjectionInput {
  readonly organizationId: string;
  readonly versionId: string;
  readonly blueprint: BlueprintValue;
}

/**
 * Persist the exact step/edge projection alongside its publication and return allocated step IDs.
 * @throws when the publication is missing, its definition differs, or a partial projection exists.
 */
export async function persistBlueprintProjection(
  transaction: BlueprintProjectionTransaction,
  input: BlueprintProjectionInput,
): Promise<Readonly<Record<string, BlueprintStepId>>> {
  const [publication] = await transaction
    .select({ definition: workTypeVersion.definition })
    .from(workTypeVersion)
    .where(
      and(
        eq(workTypeVersion.id, input.versionId),
        eq(workTypeVersion.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for('update');
  if (!publication) throw new Error('Blueprint publication not found.');
  const blueprint = Blueprint.parse(input.blueprint);
  const canonical = Blueprint.parse(
    Object.hasOwn(publication.definition, 'blueprint')
      ? publication.definition.blueprint
      : { steps: [], dependencies: [] },
  );
  if (JSON.stringify(blueprint) !== JSON.stringify(canonical))
    throw new Error('Blueprint projection differs from publication.');
  const existing = await transaction
    .select()
    .from(blueprintStep)
    .where(
      and(
        eq(blueprintStep.versionId, input.versionId),
        eq(blueprintStep.organizationId, input.organizationId),
      ),
    );
  if (existing.length > 0) return verifyExistingProjection(transaction, input, blueprint, existing);
  const ids = Object.fromEntries(
    blueprint.steps.map((step) => [step.key, BlueprintStepId.parse(genId())]),
  );
  if (blueprint.steps.length > 0)
    await transaction.insert(blueprintStep).values(
      blueprint.steps.map((step) => ({
        id: projectedId(ids, step.key),
        organizationId: input.organizationId,
        versionId: input.versionId,
        key: step.key,
        kind: step.kind,
        parentStepKey: step.parentStepKey,
        sort: step.sort,
        step,
      })),
    );
  if (blueprint.dependencies.length > 0)
    await transaction.insert(blueprintDependency).values(
      blueprint.dependencies.map((edge) => ({
        organizationId: input.organizationId,
        versionId: input.versionId,
        blockerStepId: projectedId(ids, edge.blockerStepKey),
        blockedStepId: projectedId(ids, edge.blockedStepKey),
      })),
    );
  return ids;
}

async function verifyExistingProjection(
  transaction: BlueprintProjectionTransaction,
  input: BlueprintProjectionInput,
  blueprint: BlueprintValue,
  existing: readonly (typeof blueprintStep.$inferSelect)[],
): Promise<Readonly<Record<string, BlueprintStepId>>> {
  const ids: Record<string, BlueprintStepId> = {};
  for (const row of existing) {
    const step = blueprint.steps.find((candidate) => candidate.key === row.key);
    if (
      !step ||
      JSON.stringify(Blueprint.parse({ steps: [row.step], dependencies: [] }).steps[0]) !==
        JSON.stringify(step)
    )
      throw new Error('Existing blueprint projection is incomplete or different.');
    ids[row.key] = BlueprintStepId.parse(row.id);
  }
  const edges = await transaction
    .select()
    .from(blueprintDependency)
    .where(
      and(
        eq(blueprintDependency.versionId, input.versionId),
        eq(blueprintDependency.organizationId, input.organizationId),
      ),
    );
  const expected = new Set(
    blueprint.dependencies.map((edge) => `${ids[edge.blockerStepKey]}:${ids[edge.blockedStepKey]}`),
  );
  if (
    existing.length !== blueprint.steps.length ||
    edges.length !== expected.size ||
    edges.some((edge) => !expected.has(`${edge.blockerStepId}:${edge.blockedStepId}`))
  )
    throw new Error('Existing blueprint projection is incomplete or different.');
  return ids;
}

function projectedId(ids: Readonly<Record<string, BlueprintStepId>>, key: string): BlueprintStepId {
  const id = ids[key];
  if (!id) throw new Error('Blueprint dependency refers to a missing step.');
  return id;
}
