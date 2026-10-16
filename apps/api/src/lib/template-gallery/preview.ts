import { db } from '@docket/db';
import { OrganizationId } from '@docket/identity-access/ids';
import { GALLERY_CATALOG } from '@docket/work/template-gallery';
import {
  catalogCopySource,
  catalogCopyBindings,
  previewTemplateCopySources,
  fingerprintCopyFacts,
  copyIdentityKey,
  type TemplateCopySourcesInput,
} from '@docket/work/template-copy';
import {
  WorkTemplateGalleryPreview,
  WorkTemplateGalleryPreviewRequest,
} from '@docket/work/template-gallery-contract';
import { loadCreationActor } from '../work-creation/context';
import { requireTemplateAuthor, type TemplateActor } from '../templates/authorization';
import type { TemplateTransaction } from '../templates/persistence';
import { requireGalleryEntry } from './catalog';
import { requireGalleryChoices } from './choices';

/** Resolve actual released catalog identities and explicit decisions, without allocating destination IDs. */
export async function galleryCopySources(
  orgId: string,
  body: WorkTemplateGalleryPreviewRequest,
): Promise<TemplateCopySourcesInput> {
  const entries = new Map(
    await Promise.all(
      GALLERY_CATALOG.map(async (entry) => [entry.slug, await catalogCopySource(entry)] as const),
    ),
  );
  const source = (slug: string) => {
    requireGalleryEntry(slug);
    const value = entries.get(slug);
    if (!value) throw new Error('Catalog source lookup is incomplete');
    return value;
  };
  const sources = [...entries.values()];
  return {
    destinationOrganizationId: OrganizationId.parse(orgId),
    roots: body.roots.map((slug) => source(slug).identity),
    sources,
    bindings: catalogCopyBindings(sources),
    suggestedLabelMappings: body.labels.map((choice) => ({
      source: source(choice.sourceSlug).identity,
      suggestion: choice.suggestion,
      destinationLabelId: choice.destinationLabelId,
    })),
    offeringChoices: body.offerings.map((choice) => ({
      source: source(choice.sourceSlug).identity,
      teamIds: choice.teamIds,
    })),
  };
}
/** Prepare a checked read-only review on the caller's transaction; acceptance must repeat these checks. */
export async function prepareGalleryCopyPreview(
  tx: TemplateTransaction,
  caller: TemplateActor,
  raw: WorkTemplateGalleryPreviewRequest,
): Promise<{
  readonly input: TemplateCopySourcesInput;
  readonly review: WorkTemplateGalleryPreview;
}> {
  const body = WorkTemplateGalleryPreviewRequest.parse(raw);
  const live = await loadCreationActor(tx, caller.orgId, caller.actorId);
  await requireTemplateAuthor(live, tx);
  await requireGalleryChoices(tx, live, body);
  const input = await galleryCopySources(live.orgId, body),
    preview = await previewTemplateCopySources(input);
  const sources = new Map(
    input.sources.map((source) => [copyIdentityKey(source.identity), source]),
  );
  const copies = preview.copies.map((copy) => {
    const source = sources.get(copyIdentityKey(copy.source));
    if (!source) throw new Error('Catalog preview source is incomplete');
    return {
      source: copy.source,
      name: source.definition.name,
      targetType: source.kind,
      definition: copy.previewDefinition,
      offeredTeamIds: copy.offeredTeamIds,
      dependencies: copy.dependencies,
    };
  });
  const review = WorkTemplateGalleryPreview.parse({
    ...preview,
    mode: body.mode,
    copies,
    reviewFingerprint: await fingerprintCopyFacts({
      mode: body.mode,
      review: preview.reviewFingerprint,
    }),
  });
  return { input, review };
}
/** Preview manual catalog copies under current authoring policy on every subscription plan. */
export async function previewTemplateGalleryCopy(
  caller: TemplateActor,
  body: WorkTemplateGalleryPreviewRequest,
): Promise<WorkTemplateGalleryPreview> {
  const result = await db.transaction((tx) => prepareGalleryCopyPreview(tx, caller, body));
  return result.review;
}
