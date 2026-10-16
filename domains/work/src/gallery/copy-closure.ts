import { BlueprintError } from '../blueprints/errors';
import { validateBlueprintGraph } from '../blueprints/graph';
import { discoverPublicationReferences } from '../blueprints/publication-references';
import type { PublishedBlueprintSnapshot, ResolvedBlueprintGraph } from '../blueprints/types';
import { type CopySourceCatalog, copySourceKey } from './copy-source';
import type { CopySourceSnapshot } from './copy-types';

function blueprintOnly(snapshot: PublishedBlueprintSnapshot): PublishedBlueprintSnapshot {
  return { ...snapshot, definition: { ...snapshot.definition, defaultSchedules: [] } };
}
/** Validate each copied root's full optional expansion through the existing shared blueprint engine. */
export async function validateCopyExpansion(
  catalog: CopySourceCatalog,
  source: CopySourceSnapshot,
): Promise<void> {
  const root = blueprintOnly(source.snapshot);
  const publications = new Map<string, PublishedBlueprintSnapshot>();
  const resolutions: ResolvedBlueprintGraph['resolutions'][number][] = [];
  await discoverPublicationReferences(
    root.workTypeId,
    root.definition,
    async (kind, reference, path) => {
      const chosen = reference ? catalog.resolve(reference).snapshot : catalog.bases.get(kind);
      if (!chosen)
        throw new BlueprintError('blueprint_invalid', 'Missing checked inline base publication.');
      const snapshot = blueprintOnly(chosen);
      publications.set(copySourceKey(snapshot), snapshot);
      resolutions.push({
        path: [...path],
        workTypeId: snapshot.workTypeId,
        versionId: snapshot.versionId,
      });
      return snapshot;
    },
  );
  validateBlueprintGraph({
    root,
    publications: [...publications.values()],
    resolutions,
    fingerprint: source.fingerprint,
  });
}
