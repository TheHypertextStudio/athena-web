import { OrganizationId } from '@docket/identity-access/ids';
import { GALLERY_CATALOG } from '@docket/work/template-gallery';
import {
  CatalogVersionId,
  normalizeCopyDefinition,
  catalogCopySource,
  catalogCopyBindings,
  previewTemplateCopySources,
} from '@docket/work/template-copy';
import {
  WorkTemplateGalleryItem,
  WorkTemplateGalleryPreview,
} from '@docket/work/template-gallery-contract';
/** Released catalog facts, preserving their actual namespace and composed Program defaults. */
export const gallerySources = GALLERY_CATALOG.map((entry) => ({
  identity: {
    kind: 'catalog' as const,
    release: 1 as const,
    workTypeId: entry.id,
    catalogVersionId: CatalogVersionId.parse(entry.versionId),
  },
  definition: normalizeCopyDefinition(entry.definition, entry.defaultSchedules),
  slug: entry.slug,
  name: entry.definition.name,
  targetType: entry.definition.payload.targetType,
  category: entry.category,
  forks: entry.forks,
  use: entry.use,
  labelSuggestions: entry.labelSuggestions,
  offeringSuggestions: entry.offeringSuggestions,
}));
/** Complete small browse records from the real 110-entry catalog. */
export const galleryItems = gallerySources.map((source) =>
  WorkTemplateGalleryItem.parse({
    identity: source.identity,
    slug: source.slug,
    name: source.name,
    targetType: source.targetType,
    category: source.category,
    forks: source.forks,
    use: source.use,
  }),
);
/** Require an actual source fixture rather than synthesizing a publication. */
export function galleryFixture(slug: string) {
  const source = gallerySources.find((entry) => entry.slug === slug);
  if (!source) throw new Error('Missing actual gallery fixture.');
  return source;
}
/** Checked server-review fixture with real Event/Vendor sources and one exact reviewed document rewrite. */
export function galleryPreview() {
  const event = galleryFixture('event'),
    vendor = galleryFixture('vendor-booking');
  return WorkTemplateGalleryPreview.parse({
    reviewFingerprint: `sha256:${'0'.repeat(64)}`,
    mode: 'private_drafts',
    roots: [event.identity],
    copies: [
      {
        source: event.identity,
        name: event.name,
        targetType: event.targetType,
        definition: {
          ...event.definition,
          payload: {
            ...event.definition.payload,
            description: 'Reviewed destination instructions.',
          },
        },
        offeredTeamIds: [],
        dependencies: [vendor.identity],
      },
      {
        source: vendor.identity,
        name: vendor.name,
        targetType: vendor.targetType,
        definition: vendor.definition,
        offeredTeamIds: [],
        dependencies: [],
      },
    ],
    omissions: [
      { source: event.identity, kind: 'image', path: ['payload', 'description'], count: 1 },
    ],
  });
}

/** Complete approved startup fork prepared by the same pure copy planner as the read API. */
export async function fullStartupPreview() {
  const sources = await Promise.all(GALLERY_CATALOG.map(catalogCopySource));
  const preview = await previewTemplateCopySources({
    destinationOrganizationId: OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAX'),
    roots: galleryItems
      .filter((item) => item.forks.includes('startup'))
      .map((item) => item.identity),
    sources,
    bindings: catalogCopyBindings(sources),
  });
  return WorkTemplateGalleryPreview.parse({
    ...preview,
    mode: 'private_drafts',
    copies: preview.copies.map((copy) => ({
      source: copy.source,
      name: copy.previewDefinition.name,
      targetType: copy.kind,
      definition: copy.previewDefinition,
      offeredTeamIds: copy.offeredTeamIds,
      dependencies: copy.dependencies,
    })),
  });
}
