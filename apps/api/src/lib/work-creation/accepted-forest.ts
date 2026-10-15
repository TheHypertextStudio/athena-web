import type { PreparedBlueprintCreation } from '../work-template-blueprints/preflight';
import type { WorkCreationBatchCommand, WorkCreationBatchResult } from './types';

/** Retain the locked publication closure and exact accepted rows for each original forest key. */
export function acceptedForestSelections(
  command: WorkCreationBatchCommand,
  prepared: readonly PreparedBlueprintCreation[],
): Pick<WorkCreationBatchResult, 'resolvedManifestsByKey' | 'selectedWorkByKey'> {
  return {
    resolvedManifestsByKey: new Map(
      command.roots.flatMap((root, index) => {
        const input = prepared[index];
        return input ? [[root.key, input.tree.manifest] as const] : [];
      }),
    ),
    selectedWorkByKey: new Map(
      command.roots.flatMap((root, index) => {
        const input = prepared[index];
        if (!input) return [];
        const rows = input.entries.map(({ allocated }) => ({
          path: allocated.node.path,
          kind: allocated.node.kind,
          id: allocated.id,
        }));
        return [[root.key, rows] as const];
      }),
    ),
  };
}
