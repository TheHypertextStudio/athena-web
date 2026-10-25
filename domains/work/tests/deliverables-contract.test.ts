import { describe, expect, it } from 'vitest';
import { CommentCreate } from '../src/contracts/comment';
import { UpdateCreate } from '../src/contracts/update';

const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('deliverables on authored posts', () => {
  it('retains attachment IDs on comments and updates', () => {
    for (const contract of [CommentCreate, UpdateCreate]) {
      expect(
        contract.parse({
          subjectType: 'project',
          subjectId: id,
          body: 'Here is the work.',
          attachmentIds: [id],
        }),
      ).toHaveProperty('attachmentIds', [id]);
    }
  });

  it('rejects duplicate attachment IDs and more than ten files', () => {
    for (const contract of [CommentCreate, UpdateCreate]) {
      const post = { subjectType: 'project', subjectId: id, body: 'Work' };
      expect(contract.safeParse({ ...post, attachmentIds: [id, id] }).success).toBe(false);
      expect(
        contract.safeParse({
          ...post,
          attachmentIds: Array.from({ length: 11 }, (_, index) => String(index)),
        }).success,
      ).toBe(false);
    }
  });
});
