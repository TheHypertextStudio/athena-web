import { describe, expect, it } from 'vitest';
import {
  WorkTemplateCopyReceipt,
  WorkTemplateGalleryAcceptRequest,
  WorkTemplateCopyUndoResult,
} from '../src/contracts/template-gallery';
import { ulid } from './blueprint-fixtures';

const root = { workTypeId: ulid(3), workTypeVersionId: null, targetType: 'project' };
const receipt = {
  bundleId: ulid(1),
  changeSetId: ulid(2),
  mode: 'private_drafts',
  state: 'installed',
  roots: [root],
};
describe('honest saved gallery outcomes', () => {
  it('accepts actual draft identities without claiming publication', () => {
    expect(WorkTemplateCopyReceipt.parse(receipt).roots[0]?.workTypeVersionId).toBeNull();
  });
  it('requires a real accepted publication only for explicit workspace publication', () => {
    expect(WorkTemplateCopyReceipt.safeParse({ ...receipt, mode: 'published' }).success).toBe(
      false,
    );
    expect(
      WorkTemplateCopyReceipt.safeParse({
        ...receipt,
        mode: 'published',
        roots: [{ ...root, workTypeVersionId: ulid(4) }],
      }).success,
    ).toBe(true);
    expect(
      WorkTemplateCopyReceipt.safeParse({
        ...receipt,
        roots: [{ ...root, workTypeVersionId: ulid(4) }],
      }).success,
    ).toBe(false);
  });
  it('refuses duplicated destination roots and invented receipt authority', () => {
    expect(WorkTemplateCopyReceipt.safeParse({ ...receipt, roots: [root, root] }).success).toBe(
      false,
    );
    expect(
      WorkTemplateCopyReceipt.safeParse({ ...receipt, acceptingActorId: ulid(5) }).success,
    ).toBe(false);
  });
  it('accepts one stable request identity and only reviewed manual choices', () => {
    const request = {
      requestId: 'b1219823-22b1-4f46-8b62-f098f50802fe',
      expectedReviewFingerprint: `sha256:${'a'.repeat(64)}`,
      roots: ['event'],
      release: 1,
      mode: 'private_drafts',
    };
    expect(WorkTemplateGalleryAcceptRequest.safeParse(request).success).toBe(true);
    expect(
      WorkTemplateGalleryAcceptRequest.safeParse({ ...request, actorId: ulid(6) }).success,
    ).toBe(false);
    expect(
      WorkTemplateGalleryAcceptRequest.safeParse({ ...request, requestId: 'new-on-retry' }).success,
    ).toBe(false);
  });
  it('requires a terminal Undo result and exposes only safe retained-copy reasons', () => {
    const result = {
      receipt: { ...receipt, state: 'undone' },
      retained: [{ workTypeId: root.workTypeId, reason: 'in_use' }],
    };
    expect(WorkTemplateCopyUndoResult.safeParse(result).success).toBe(true);
    expect(WorkTemplateCopyUndoResult.safeParse({ ...result, receipt }).success).toBe(false);
    expect(
      WorkTemplateCopyUndoResult.safeParse({
        ...result,
        retained: [{ ...result.retained[0], protectingPlanIds: [ulid(5)] }],
      }).success,
    ).toBe(false);
  });
});
