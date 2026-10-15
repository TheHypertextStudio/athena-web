import type { WorkTemplateDefinition } from '../contracts/work-template';
import type { BlueprintStep } from '../contracts/work-template-blueprint';
import { BlueprintError } from './errors';
import type { PublishedBlueprintSnapshot, WorkKind } from './types';

/** Publication reader receives each real reference and whether it begins an independent schedule. */
export type PublicationReferenceReader = (
  kind: WorkKind,
  reference: BlueprintStep['template'],
  path: readonly string[],
  scheduleRoot: boolean,
) => Promise<PublishedBlueprintSnapshot>;

interface Discovery {
  readonly read: PublicationReferenceReader;
  readonly ids: Set<string>;
}
interface Scope {
  readonly definition: WorkTemplateDefinition;
  readonly path: readonly string[];
  readonly ancestors: readonly string[];
  readonly budget: { count: number };
}
function assertNewIdentity(id: string, scope: Scope, path: readonly string[]): void {
  if (scope.ancestors.includes(id))
    throw new BlueprintError('blueprint_loop', 'A template cannot regenerate its own identity.', [
      path,
    ]);
}
async function visit(state: Discovery, scope: Scope): Promise<void> {
  for (const step of scope.definition.blueprint.steps) {
    if (++scope.budget.count > 500)
      throw new BlueprintError('blueprint_limit', 'Create at most 500 work rows per expansion.');
    if (step.kind === 'milestone') continue;
    const path = [...scope.path, step.key];
    const child = await state.read(step.kind, step.template, path, false);
    state.ids.add(child.workTypeId);
    if (!step.template) continue;
    assertNewIdentity(child.workTypeId, scope, path);
    await visit(state, {
      ...scope,
      definition: child.definition,
      path,
      ancestors: [...scope.ancestors, child.workTypeId],
    });
  }
  for (const schedule of scope.definition.defaultSchedules) {
    const path = [...scope.path, schedule.key];
    const child = await state.read(schedule.template.targetType, schedule.template, path, true);
    state.ids.add(child.workTypeId);
    assertNewIdentity(child.workTypeId, scope, path);
    await visit(state, {
      definition: child.definition,
      path,
      ancestors: [...scope.ancestors, child.workTypeId],
      budget: { count: 1 },
    });
  }
}
/** Discover and bound the transitive blueprint and default-schedule references before locking. */
export async function discoverPublicationReferences(
  rootId: string,
  definition: WorkTemplateDefinition,
  read: PublicationReferenceReader,
): Promise<string[]> {
  const state = { read, ids: new Set([rootId]) };
  await visit(state, { definition, path: [], ancestors: [rootId], budget: { count: 1 } });
  return [...state.ids].sort();
}
