import { describe, expect, it, vi } from 'vitest';

import {
  DOCUMENT_IMAGE_RETENTION_MS,
  sweepUnreferencedDocumentImages,
  type DocumentImageCleanupCandidate,
  type DocumentImageCleanupStorage,
} from '../../src/content/document-image-cleanup';

const now = new Date('2026-09-05T12:00:00.000Z');
const candidate: DocumentImageCleanupCandidate = {
  id: 'image_1',
  organizationId: 'org_1',
  blobKey: 'document-images/org_1/image_1',
};

function storageFor(candidates: readonly DocumentImageCleanupCandidate[]): {
  storage: DocumentImageCleanupStorage;
  removed: string[];
  cutoff: Date[];
} {
  const removed: string[] = [];
  const cutoff: Date[] = [];
  return {
    removed,
    cutoff,
    storage: {
      listUnreferencedBefore: (value) => {
        cutoff.push(value);
        return Promise.resolve(candidates);
      },
      deleteRow: (organizationId, imageId) => {
        removed.push(`${organizationId}:${imageId}`);
        return Promise.resolve();
      },
    },
  };
}

describe('unreferenced document image cleanup', () => {
  it('deletes bytes and then the row after seven unreferenced days', async () => {
    const state = storageFor([candidate]);
    const blob = { delete: vi.fn().mockResolvedValue(undefined) };

    const result = await sweepUnreferencedDocumentImages(
      state.storage,
      { isImageInUse: vi.fn().mockResolvedValue(false) },
      blob,
      now,
    );

    expect(state.cutoff).toEqual([new Date(now.getTime() - DOCUMENT_IMAGE_RETENTION_MS)]);
    expect(blob.delete).toHaveBeenCalledWith(candidate.blobKey);
    expect(state.removed).toEqual(['org_1:image_1']);
    expect(result).toEqual({ considered: 1, deleted: 1, retained: 0, failed: 0 });
  });

  it('retains a live image after the authoritative check repairs its missing projection', async () => {
    const state = storageFor([candidate]);
    const blob = { delete: vi.fn().mockResolvedValue(undefined) };

    const result = await sweepUnreferencedDocumentImages(
      state.storage,
      { isImageInUse: vi.fn().mockResolvedValue(true) },
      blob,
      now,
    );

    expect(blob.delete).not.toHaveBeenCalled();
    expect(state.removed).toEqual([]);
    expect(result).toEqual({ considered: 1, deleted: 0, retained: 1, failed: 0 });
  });

  it('keeps the database row when blob deletion fails so a later sweep can retry', async () => {
    const state = storageFor([candidate]);
    const blob = { delete: vi.fn().mockRejectedValue(new Error('blob unavailable')) };

    const result = await sweepUnreferencedDocumentImages(
      state.storage,
      { isImageInUse: vi.fn().mockResolvedValue(false) },
      blob,
      now,
    );

    expect(state.removed).toEqual([]);
    expect(result).toEqual({ considered: 1, deleted: 0, retained: 0, failed: 1 });
  });
});
