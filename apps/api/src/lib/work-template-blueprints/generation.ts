import {
  BlueprintError,
  type BlueprintCreationContext,
  type PlannedWorkTree,
} from '@docket/work/blueprints';
import type { BlueprintCreationOptions } from '@docket/work/work-template-blueprint';
import type { TemplateTransaction } from '../templates/persistence';
import { loadStatusSets } from '../work-status';
import type { PreparedBlueprintEntry } from './preflight';
/** Attach the initial managed-tree receipt only to newly created work. */
export async function prepareGenerationMetadata(
  tx: TemplateTransaction,
  entries: readonly PreparedBlueprintEntry[],
  facts: {
    tree: PlannedWorkTree;
    context: BlueprintCreationContext;
    options: BlueprintCreationOptions;
    generationKey: string | undefined;
  },
): Promise<void> {
  const teamIds = [
    ...new Set(
      entries.flatMap((entry) =>
        entry.allocated.node.teamId ? [entry.allocated.node.teamId] : [],
      ),
    ),
  ];
  const sets = await loadStatusSets(facts.context.organizationId, { teamIds }, tx);
  for (const entry of entries) {
    if (entry.kind !== 'ordinary' || entry.prepared.insert.kind === 'milestone') continue;
    const values = entry.prepared.insert.values;
    const category = sets.categoryOf(values.statusId);
    values.blueprintEverStarted = category === 'started' || category === 'completed';
    if (entry.allocated.parent !== null) continue;
    if (!facts.generationKey)
      throw new BlueprintError('blueprint_invalid', 'A creation requires its allocated root.');
    values.blueprintState = {
      revision: 0,
      generationKey: facts.generationKey,
      resolvedManifest: [...facts.tree.manifest],
      optionalChoices: [...facts.options.optionalChoices],
      creationTimezone: facts.context.timezone,
      workingWeekdays: [...facts.context.workingWeekdays],
      lastApplicationChangeSetId: null,
    };
  }
}
