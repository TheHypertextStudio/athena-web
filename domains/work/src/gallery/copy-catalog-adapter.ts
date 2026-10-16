import { BlueprintError } from '../blueprints/errors';
import { GalleryEntry } from './types';
import { CatalogVersionId, copyIdentityKey, copyIdentityScope } from './copy-identity';
import { fingerprintCopyFacts } from './copy-fingerprint';
import { normalizeCopyDefinition } from './copy-normalize';
import { authoredCopyReferences } from './copy-prospective-source';
import type { CopyDefinitionSource, CopyReferenceBinding } from './copy-prospective-types';

/** Adapt immutable released catalog data honestly; no workspace, publication row or projection is fabricated. */
export async function catalogCopySource(raw: GalleryEntry): Promise<CopyDefinitionSource> {
  const entry = GalleryEntry.parse(raw);
  const definition = normalizeCopyDefinition(entry.definition, entry.defaultSchedules);
  return {
    identity: {
      kind: 'catalog',
      release: entry.release,
      workTypeId: entry.id,
      catalogVersionId: CatalogVersionId.parse(entry.versionId),
    },
    kind: definition.payload.targetType,
    definition,
    fingerprint: await fingerprintCopyFacts({ ...entry, definition }),
    labelSuggestions: entry.labelSuggestions,
    offeringSuggestions: entry.offeringSuggestions,
  };
}
/** Resolve catalog-authored exact references only inside their immutable release namespace. */
export function catalogCopyBindings(
  sources: readonly CopyDefinitionSource[],
): CopyReferenceBinding[] {
  return sources.flatMap((source) => {
    if (source.identity.kind !== 'catalog')
      throw new BlueprintError('blueprint_invalid', 'Catalog binding needs catalog source facts.');
    return authoredCopyReferences(source).map((entry) => {
      const reference = entry.reference;
      const targets = sources.filter(
        (target) =>
          target.identity.kind === 'catalog' &&
          copyIdentityScope(target.identity) === copyIdentityScope(source.identity) &&
          target.identity.workTypeId === reference.workTypeId &&
          reference.selection.kind === 'pinned' &&
          String(target.identity.catalogVersionId) === reference.selection.workTypeVersionId,
      );
      const distinct = new Map(targets.map((target) => [copyIdentityKey(target.identity), target]));
      const target = [...distinct.values()][0];
      if (distinct.size !== 1 || !target)
        throw new BlueprintError(
          'blueprint_invalid',
          'Missing exact same-release catalog reference.',
        );
      return { source: source.identity, slot: entry.slot, target: target.identity };
    });
  });
}
