import { describe, expect, it } from 'vitest';
import {
  galleryAcceptanceFacts,
  galleryCopyReceipt,
  requireGalleryRetryMatches,
} from '../../src/lib/template-gallery/acceptance-facts';
import type { TemplateCopyRequestStatus } from '../../src/lib/templates/copy-reservation';
import { OrganizationId } from '@docket/identity-access/ids';
import { GALLERY_CATALOG } from '@docket/work/template-gallery';
import {
  catalogCopySource,
  catalogCopyBindings,
  copyIdentityKey,
  previewTemplateCopySources,
} from '@docket/work/template-copy';
import { WorkTemplateGalleryPreview } from '@docket/work/template-gallery-contract';

const id = (n: number) => String(n).padStart(26, '0');
const hash = `sha256:${'a'.repeat(64)}`;
const status = (): TemplateCopyRequestStatus => ({
  bundleId: id(1),
  requestId: 'b1219823-22b1-4f46-8b62-f098f50802fe',
  state: 'installed',
  mode: 'private_drafts',
  reviewFingerprint: hash,
  choicesFingerprint: hash,
  rootEntryKeys: [id(3)],
  receiptId: id(2),
  entries: [
    {
      key: id(3),
      workTypeId: id(4),
      reservedFirstVersionId: id(5),
      reservationState: 'pending',
      targetType: 'project',
    },
  ],
});
function firstEntry(current: TemplateCopyRequestStatus) {
  const entry = current.entries[0];
  if (!entry) throw new Error('Missing original outcome fixture');
  return entry;
}
describe('gallery acceptance and known outcomes', () => {
  it('projects the original private result even when a later action published its draft', () => {
    const current = status();
    expect(galleryCopyReceipt(current).roots[0]?.workTypeVersionId).toBeNull();
    expect(
      galleryCopyReceipt({
        ...current,
        entries: [{ ...firstEntry(current), reservationState: 'consumed' }],
      }).roots[0]?.workTypeVersionId,
    ).toBeNull();
  });
  it('returns original explicitly accepted publications and terminal Undo without reinstalling', () => {
    const current = status();
    const receipt = galleryCopyReceipt({
      ...current,
      mode: 'published',
      state: 'undone',
      entries: [{ ...firstEntry(current), reservationState: 'consumed' }],
    });
    expect(receipt.state).toBe('undone');
    expect(receipt.roots[0]?.workTypeVersionId).toBe(id(5));
  });
  it('rejects changed retry choices without consulting or mutating source definitions', () => {
    const current = status();
    expect(() => {
      requireGalleryRetryMatches(current, {
        mode: 'private_drafts',
        expectedReviewFingerprint: hash,
        choicesFingerprint: hash,
      });
    }).not.toThrow();
    for (const change of [
      { mode: 'published' as const },
      { expectedReviewFingerprint: `sha256:${'b'.repeat(64)}` },
      { choicesFingerprint: `sha256:${'c'.repeat(64)}` },
    ]) {
      expect(() => {
        requireGalleryRetryMatches(current, {
          mode: 'private_drafts',
          expectedReviewFingerprint: hash,
          choicesFingerprint: hash,
          ...change,
        });
      }).toThrow();
    }
  });
  it('refuses a missing root outcome rather than inventing its destination', () => {
    expect(() => galleryCopyReceipt({ ...status(), entries: [] })).toThrow();
  });
  it('keeps actual Event dependencies first with their exact immutable catalog hashes', async () => {
    const sources = await Promise.all(GALLERY_CATALOG.map(catalogCopySource));
    const entry = GALLERY_CATALOG.find((source) => source.slug === 'event');
    const rootSource = sources.find((source) => source.identity.workTypeId === entry?.id);
    if (!rootSource) throw new Error('Missing actual Event catalog fixture');
    const input = {
      destinationOrganizationId: OrganizationId.parse(id(99)),
      roots: [rootSource.identity],
      sources,
      bindings: catalogCopyBindings(sources),
    };
    const checked = await previewTemplateCopySources(input);
    const review = WorkTemplateGalleryPreview.parse({
      ...checked,
      mode: 'private_drafts',
      copies: checked.copies.map((copy) => ({
        source: copy.source,
        dependencies: copy.dependencies,
        offeredTeamIds: copy.offeredTeamIds,
        definition: copy.previewDefinition,
        name: copy.previewDefinition.name,
        targetType: copy.kind,
      })),
    });
    const accepted = galleryAcceptanceFacts(status().requestId, input, review, hash);
    const positions = new Map(accepted.entries.map((source, index) => [source.key, index]));
    expect(accepted.entries.length).toBeGreaterThan(1);
    for (const [index, source] of accepted.entries.entries()) {
      expect(source.sourceFingerprint).toBe(
        sources.find(
          (candidate) => copyIdentityKey(candidate.identity) === copyIdentityKey(source.source),
        )?.fingerprint,
      );
      expect(source.dependencies.every((key) => (positions.get(key) ?? Infinity) < index)).toBe(
        true,
      );
    }
    expect(accepted.roots).toEqual([rootSource.identity.workTypeId]);
  });
});
