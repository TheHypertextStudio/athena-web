import type { PublishedBlueprintSnapshot } from '../blueprints/types';
import { BlueprintError } from '../blueprints/errors';
import { CopySourceCatalog } from './copy-source';
import { validateCopyExpansion } from './copy-closure';
import type { CopySourceIdentity } from './copy-identity';
import { planTemplateCopySources } from './copy-prospective-plan';
import type {
  CopyDefinitionSource,
  CopyReferenceBinding,
  ReservedTemplateCopyInput,
} from './copy-prospective-types';
import type { CopySourceRef, TemplateCopyInput, TemplateCopyPlan } from './copy-types';
import { authoredCopyReferences } from './copy-prospective-source';

/** Qualify an actual publication without changing its persisted identity or inventing a projection. */
export function publicationCopyIdentity(
  snapshot: PublishedBlueprintSnapshot,
): Extract<CopySourceIdentity, { kind: 'publication' }> {
  return {
    kind: 'publication',
    organizationId: snapshot.organizationId,
    workTypeId: snapshot.workTypeId,
    workTypeVersionId: snapshot.versionId,
  };
}
function legacyReference(identity: CopySourceIdentity): CopySourceRef {
  if (identity.kind !== 'publication')
    throw new BlueprintError(
      'blueprint_invalid',
      'Publication adapter received a non-publication source.',
    );
  return { workTypeId: identity.workTypeId, versionId: identity.workTypeVersionId };
}
function normalizedInput(
  input: TemplateCopyInput,
  catalog: CopySourceCatalog,
): ReservedTemplateCopyInput {
  const identity = (source: CopySourceRef) =>
    publicationCopyIdentity(catalog.require(source).snapshot);
  const sources: CopyDefinitionSource[] = [...catalog.sources.values()].map(
    ({ snapshot, ...facts }) => ({
      ...facts,
      identity: publicationCopyIdentity(snapshot),
      kind: snapshot.kind,
      definition: snapshot.definition,
    }),
  );
  const bindings: CopyReferenceBinding[] = sources.flatMap((source) =>
    authoredCopyReferences(source).map((entry) => ({
      source: source.identity,
      slot: entry.slot,
      target: publicationCopyIdentity(catalog.resolve(entry.reference).snapshot),
    })),
  );
  return {
    destinationOrganizationId: input.destinationOrganizationId,
    roots: input.roots.map(identity),
    sources,
    bindings,
    destinations: input.destinations.map((entry) => ({
      kind: 'reserved',
      source: identity(entry.source),
      workTypeId: entry.workTypeId,
      reservedFirstPublicationId: entry.versionId,
    })),
    ...(input.labelMappings ? { labelMappings: input.labelMappings } : {}),
    ...(input.suggestedLabelMappings
      ? {
          suggestedLabelMappings: input.suggestedLabelMappings.map((entry) => ({
            ...entry,
            source: identity(entry.source),
          })),
        }
      : {}),
    ...(input.offeringChoices
      ? {
          offeringChoices: input.offeringChoices.map((entry) => ({
            ...entry,
            source: identity(entry.source),
          })),
        }
      : {}),
    ...(input.documentEdits
      ? {
          documentEdits: input.documentEdits.map((entry) => ({
            ...entry,
            source: identity(entry.source),
          })),
        }
      : {}),
  };
}
/** Preserve the publication-only input/output contract while using the one honest copy planning core. */
export async function planPublishedTemplateCopy(
  input: TemplateCopyInput,
): Promise<TemplateCopyPlan> {
  const catalog = new CopySourceCatalog(input);
  const result = await planTemplateCopySources(normalizedInput(input, catalog));
  for (const copy of result.copies)
    await validateCopyExpansion(catalog, catalog.require(legacyReference(copy.source)));
  return {
    copies: result.copies.map((copy) => ({
      source: legacyReference(copy.source),
      workTypeId: copy.workTypeId,
      versionId: copy.reservedFirstPublicationId,
      organizationId: copy.organizationId,
      sourceFingerprint: copy.sourceFingerprint,
      definition: copy.definition,
      offeredTeamIds: copy.offeredTeamIds,
    })),
    roots: result.roots.map((root) => ({
      workTypeId: root.workTypeId,
      versionId: root.reservedFirstPublicationId,
    })),
    omissions: result.omissions.map((omission) => ({
      ...omission,
      source: legacyReference(omission.source),
    })),
  };
}
