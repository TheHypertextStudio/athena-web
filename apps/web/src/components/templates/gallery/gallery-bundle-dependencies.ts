import type { WorkTemplateCopyBundle } from '@docket/work/template-gallery-contract';
import { authoredCopyReferences } from '@docket/work/template-copy';

type Entry = WorkTemplateCopyBundle['entries'][number];
type Reference = ReturnType<typeof authoredCopyReferences>[number];
type Disposition =
  { readonly state: 'ready' | 'review' } | { readonly state: 'pending'; readonly name: string };
/** Current authorized definition dependencies; installation edges remain provenance only. */
export interface GalleryBundleDependencies {
  readonly unpublished: readonly string[];
  readonly requiresReview: boolean;
}
function referenceDisposition(authored: Reference, bundle: WorkTemplateCopyBundle): Disposition {
  const dependency = bundle.entries.find(
    (value) => value.workTypeId === authored.reference.workTypeId,
  );
  if (!dependency?.template) return { state: 'review' };
  const template = dependency.template;
  if (template.targetType !== authored.kind || template.status === 'archived')
    return { state: 'review' };
  const selectedId =
    authored.reference.selection.kind === 'pinned'
      ? authored.reference.selection.workTypeVersionId
      : null;
  if (
    dependency.reservation.state === 'pending' &&
    selectedId === dependency.reservation.reservedFirstPublicationId
  )
    return { state: 'pending', name: (template.draftDefinition ?? template.definition).name };
  return publishedDisposition(dependency, selectedId);
}
function publishedDisposition(dependency: Entry, selectedId: string | null): Disposition {
  const publication = dependency.template?.latestVersion;
  if (dependency.reservation.state !== 'consumed' || !publication) return { state: 'review' };
  return { state: selectedId === null || selectedId === publication.id ? 'ready' : 'review' };
}
/** Inspect current authored references without assuming an unseen or different publication exists. */
export function galleryBundleDependencies(
  entry: Entry,
  bundle: WorkTemplateCopyBundle,
): GalleryBundleDependencies {
  if (!entry.template) return { unpublished: [], requiresReview: true };
  const references = authoredCopyReferences({
    definition: entry.template.draftDefinition ?? entry.template.definition,
  });
  const dispositions = references.map((reference) => referenceDisposition(reference, bundle));
  return {
    unpublished: [
      ...new Set(dispositions.flatMap((value) => (value.state === 'pending' ? [value.name] : []))),
    ],
    requiresReview: dispositions.some((value) => value.state === 'review'),
  };
}

/** Current authorized parents waiting for this exact unpublished reserved definition. */
export function galleryBundleConsumers(
  target: Entry,
  bundle: WorkTemplateCopyBundle,
): readonly string[] {
  return bundle.entries.flatMap((entry) => {
    if (!entry.template || entry.workTypeId === target.workTypeId) return [];
    const definition = entry.template.draftDefinition ?? entry.template.definition;
    const waiting = authoredCopyReferences({ definition }).some(
      (reference) =>
        reference.reference.workTypeId === target.workTypeId &&
        referenceDisposition(reference, bundle).state === 'pending',
    );
    return waiting ? [definition.name] : [];
  });
}
