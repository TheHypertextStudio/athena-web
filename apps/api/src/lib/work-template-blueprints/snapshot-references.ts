import { blueprintStep, workTypeVersion } from '@docket/db';
import {
  BlueprintError,
  type BlueprintDateReferences,
  type ExistingBlueprintNode,
} from '@docket/work/blueprints';
import { and, eq, inArray } from 'drizzle-orm';
import type { TemplateTransaction } from '../templates/persistence';
import type { BlueprintSnapshotRow } from './snapshot-types';

function qualifiedScope(row: BlueprintSnapshotRow): string {
  return JSON.stringify(row.work.row.blueprintPath?.slice(0, -1) ?? []);
}
function oneReference(matches: readonly BlueprintSnapshotRow[]): string | undefined {
  if (matches.length > 1)
    throw new BlueprintError(
      'blueprint_invalid',
      'An accepted date rule has ambiguous existing prerequisites.',
    );
  return matches[0]?.work.id;
}
/** Resolve accepted immutable rule keys to exact current physical facts, never names or path-only identity. */
export async function snapshotDateReferences(
  tx: TemplateTransaction,
  orgId: string,
  rows: readonly BlueprintSnapshotRow[],
  nodes: readonly ExistingBlueprintNode[],
): Promise<ExistingBlueprintNode[]> {
  const versionIds = [
    ...new Set(
      rows.flatMap(({ work }) =>
        Object.values(work.row.blueprintDateBindings).flatMap((binding) =>
          binding ? [binding.sourceVersionId] : [],
        ),
      ),
    ),
  ];
  if (!versionIds.length) return [...nodes];
  const versions = await tx
    .select({ id: workTypeVersion.id, workTypeId: workTypeVersion.workTypeId })
    .from(workTypeVersion)
    .where(and(eq(workTypeVersion.organizationId, orgId), inArray(workTypeVersion.id, versionIds)));
  const sourceTypes = new Map(versions.map((row) => [row.id, row.workTypeId]));
  const stepIds = rows.flatMap(({ work }) =>
    work.row.blueprintStepId ? [work.row.blueprintStepId] : [],
  );
  const steps = stepIds.length
    ? await tx
        .select({ id: blueprintStep.id, key: blueprintStep.key })
        .from(blueprintStep)
        .where(and(eq(blueprintStep.organizationId, orgId), inArray(blueprintStep.id, stepIds)))
    : [];
  const keys = new Map(steps.map((row) => [row.id, row.key]));
  const rowsById = new Map(rows.map((row) => [row.work.id, row]));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const owner = rowsById.get(node.id);
    if (!owner) throw new BlueprintError('blueprint_invalid', 'Missing accepted date owner.');
    const references = Object.fromEntries(
      Object.entries(node.dateBindings).flatMap(([field, binding]) => {
        if (!binding) return [];
        const family = sourceTypes.get(binding.sourceVersionId);
        const candidates = rows.filter(
          (entry) =>
            nodesById.get(entry.work.id)?.sourceWorkTypeId === family &&
            qualifiedScope(entry) === qualifiedScope(owner),
        );
        const resolve = (key: string, milestone: boolean) =>
          oneReference(
            candidates.filter(
              (entry) =>
                keys.get(entry.work.row.blueprintStepId ?? '') === key &&
                (milestone
                  ? entry.work.kind === 'milestone'
                  : entry.work.kind === 'task' && entry.parent?.id === owner.parent?.id),
            ),
          );
        const rule = binding.rule;
        const milestoneKey =
          rule.kind === 'anchor' && rule.anchor.kind === 'milestone'
            ? rule.anchor.stepKey
            : undefined;
        const completionKeys = rule.kind === 'after_completion' ? rule.stepKeys : [];
        const milestoneId = milestoneKey ? resolve(milestoneKey, true) : undefined;
        const value: BlueprintDateReferences = {
          parentId: node.parentId ?? null,
          milestoneIds: milestoneKey && milestoneId ? { [milestoneKey]: milestoneId } : {},
          completionIds: Object.fromEntries(
            completionKeys.flatMap((key) => {
              const id = resolve(key, false);
              return id ? [[key, id]] : [];
            }),
          ),
        };
        return [[field, value]];
      }),
    );
    return { ...node, dateReferences: references };
  });
}
