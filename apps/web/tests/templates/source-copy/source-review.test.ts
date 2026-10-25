import { describe, expect, it } from 'vitest';
import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTypeVersionId } from '@docket/work/ids';
import { type CopySourceIdentity, WorkTemplateSourceCopyPreview } from '@docket/work/template-copy';
import { gallerySourceKey } from '@/components/templates/gallery/gallery-metadata';
import {
  galleryStructure,
  galleryPreviewSources,
} from '@/components/templates/gallery/gallery-structure';
import { galleryReviewGroups } from '@/components/templates/gallery/gallery-review-groups';
import { galleryPreview } from '../gallery/gallery-fixture';

const organizationId = OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
function workspacePreview() {
  const catalog = galleryPreview();
  const identities: CopySourceIdentity[] = catalog.copies.map((copy, index) =>
    index === 0
      ? {
          kind: 'draft',
          organizationId,
          workTypeId: copy.source.workTypeId,
          draftRevision: 7,
          draftFingerprint: `sha256:${'a'.repeat(64)}`,
        }
      : {
          kind: 'publication',
          organizationId,
          workTypeId: copy.source.workTypeId,
          workTypeVersionId: WorkTypeVersionId.parse(copy.source.catalogVersionId),
        },
  );
  return WorkTemplateSourceCopyPreview.parse({
    ...catalog,
    roots: [identities[0]],
    copies: catalog.copies.map((copy, index) => ({
      ...copy,
      source: identities[index],
      dependencies: index === 0 ? [identities[1]] : [],
      referenceBindings:
        index === 0
          ? [
              {
                slot: { kind: 'blueprint_step', key: copy.definition.blueprint.steps[0]?.key },
                target: identities[1],
              },
            ]
          : [],
    })),
    omissions: catalog.omissions.map((omission) => ({ ...omission, source: identities[0] })),
  });
}
describe('checked saved-source copy review', () => {
  it('joins exact tenant revisions rather than collapsing sources into catalog-shaped keys', () => {
    const source = workspacePreview().roots[0];
    if (source?.kind !== 'draft') throw new Error('Missing saved draft fixture');
    expect(gallerySourceKey(source)).not.toBe(gallerySourceKey({ ...source, draftRevision: 8 }));
    expect(gallerySourceKey(source)).not.toBe(
      gallerySourceKey({
        ...source,
        organizationId: OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAX'),
      }),
    );
  });
  it('expands a saved draft through the actual pinned publication closure', () => {
    const preview = workspacePreview();
    const definition = preview.copies[0]?.definition;
    if (!definition) throw new Error('Missing source definition');
    const nodes = galleryStructure(definition, galleryPreviewSources(preview));
    expect(nodes[0]?.children.map((child) => child.name)).toEqual([
      'Get quote',
      'Confirm booking',
      'Pay deposit',
    ]);
    expect(nodes[0]?.children[0]?.timing).toContain('7 days before Book venue’s due date');
    const groups = galleryReviewGroups(preview, []);
    expect(
      groups.flatMap((group) => group.copies).map((copy) => [copy.name, copy.includedCount]),
    ).toEqual([['Event', 8]]);
  });
  it('refuses a different publication rather than displaying the wrong child instructions', () => {
    const preview = workspacePreview();
    const definition = preview.copies[0]?.definition;
    if (!definition) throw new Error('Missing source definition');
    const sources = galleryPreviewSources(preview).map((source) =>
      source.identity.kind === 'publication'
        ? {
            ...source,
            identity: {
              ...source.identity,
              workTypeVersionId: WorkTypeVersionId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAZ'),
            },
          }
        : source,
    );
    expect(() => galleryStructure(definition, sources)).toThrow(/resolve exactly/);
  });
  it('uses each checked slot for mixed pinned and latest references to the same definition', () => {
    const preview = workspacePreview();
    const root = preview.copies[0],
      vendor = preview.copies[1];
    if (!root || vendor?.source.kind !== 'publication')
      throw new Error('Missing actual reference fixture');
    const later = structuredClone(vendor);
    later.source = {
      ...vendor.source,
      workTypeVersionId: WorkTypeVersionId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAZ'),
    };
    const earlyStep = vendor.definition.blueprint.steps[0],
      laterStep = later.definition.blueprint.steps[0];
    if (!earlyStep || !laterStep) throw new Error('Missing child instructions');
    earlyStep.fields.description = 'Instructions from the pinned version';
    laterStep.fields.description = 'Instructions from the checked latest version';
    const latest = root.definition.blueprint.steps.find((step) => step.key === 'promote');
    if (!latest) throw new Error('Missing latest occurrence');
    latest.template = {
      workTypeId: vendor.source.workTypeId,
      selection: { kind: 'latest' },
    };
    root.referenceBindings.push({
      slot: { kind: 'blueprint_step', key: latest.key },
      target: later.source,
    });
    root.dependencies.push(later.source);
    preview.copies.push(later);
    const nodes = galleryStructure(root.definition, galleryPreviewSources(preview), root.source);
    expect(nodes.find((node) => node.name === 'Book venue')?.children[0]?.document).toBe(
      'Instructions from the pinned version',
    );
    expect(nodes.find((node) => node.name === 'Promote event')?.children[0]?.document).toBe(
      'Instructions from the checked latest version',
    );
  });
});
