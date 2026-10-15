import { AcceptedScheduleRoots, type AcceptedScheduleRoot } from '@docket/work/work-schedule-claim';
import { StepKey } from '@docket/work/work-template-blueprint';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { validateCreationBatch } from '../work-creation/context';
import {
  prepareCreationForest,
  validateExistingCreationDependencies,
} from '../work-creation/forest-preflight';
import type { WorkCreationBatchCommand } from '../work-creation/types';
import { validatePreparedBlueprintForest } from '../work-template-blueprints/forest';
import { lockBlueprintClosures } from '../work-template-blueprints/resolve';
import type { ScheduleDocument } from './schedule-compiler';

/** Prove the full ordinary work preflight and freeze its exact selected publications before a claim. */
export async function preflightScheduleClaim(
  tx: TemplateTransaction,
  command: WorkCreationBatchCommand,
  _document: ScheduleDocument,
): Promise<AcceptedScheduleRoot[]> {
  validateCreationBatch(command);
  const prepared = await prepareCreationForest(tx, command);
  const edges = validatePreparedBlueprintForest(command, prepared);
  await validateExistingCreationDependencies(tx, prepared, edges);
  await lockBlueprintClosures(
    tx,
    prepared.map((root) => root.graph),
  );
  return AcceptedScheduleRoots.parse(
    command.roots.map((root, index) => {
      const selected = prepared[index];
      if (!selected || (selected.command.kind !== 'task' && selected.command.kind !== 'project'))
        throw new ConflictError('The schedule root changed.');
      return {
        key: StepKey.parse(root.key),
        kind: selected.command.kind,
        workTypeId: selected.graph.root.workTypeId,
        versionId: selected.graph.root.versionId,
        resolvedManifest: selected.tree.manifest,
        optionalChoices: root.command.blueprint?.optionalChoices ?? [],
        selectedPaths: selected.tree.nodes.map((node) => ({
          path: [...node.path],
          kind: node.kind,
        })),
      };
    }),
  );
}
