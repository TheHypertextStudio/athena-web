import { describe, expect, it } from 'vitest';
import {
  WorkTemplateAssignment,
  WorkTemplateChangeRequest,
  WorkTemplateChangePreview,
} from '../src/contracts/work-template-reference';

const selection = {
  workTypeId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  workTypeVersionId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
};
const previewToken = `sha256:${'a'.repeat(64)}`;
const changeId = 'bp_1234567890abcdef';

describe('selective generated Work-template changes', () => {
  it('preserves old identity-only calls and defaults every child acceptance off', () => {
    expect(WorkTemplateAssignment.parse(selection)).toMatchObject({
      mode: 'change',
      applyFields: [],
      acceptChildChanges: [],
    });
  });

  it('supports explicit update review and bounded individual opaque acceptance', () => {
    expect(WorkTemplateChangeRequest.parse({ ...selection, mode: 'update' }).mode).toBe('update');
    expect(
      WorkTemplateAssignment.parse({
        ...selection,
        mode: 'update',
        previewToken,
        acceptChildChanges: [changeId],
      }),
    ).toMatchObject({ mode: 'update', acceptChildChanges: [changeId] });
  });

  it('refuses unreviewed, duplicate, malformed or caller-authored child writes', () => {
    for (const input of [
      { ...selection, acceptChildChanges: [changeId] },
      { ...selection, previewToken, acceptChildChanges: [changeId, changeId] },
      { ...selection, previewToken, acceptChildChanges: ['some-task-id'] },
      { ...selection, previewToken, childChanges: [{ title: 'Injected child' }] },
    ])
      expect(WorkTemplateAssignment.safeParse(input).success).toBe(false);
  });

  it('returns strict bounded display changes without planned bodies or concrete write instructions', () => {
    const preview = {
      ...selection,
      mode: 'update',
      previewToken,
      changes: [],
      childChanges: [
        {
          changeId,
          kind: 'cancel_removed_child',
          path: ['old'],
          title: 'Retired preparation',
          selectedByDefault: false,
        },
      ],
    };
    expect(WorkTemplateChangePreview.safeParse(preview).success).toBe(true);
    expect(
      WorkTemplateChangePreview.safeParse({
        ...preview,
        childChanges: [{ ...preview.childChanges[0], description: 'Private body' }],
      }).success,
    ).toBe(false);
    expect(
      WorkTemplateChangePreview.safeParse({
        ...preview,
        childChanges: Array.from({ length: 4001 }, () => preview.childChanges[0]),
      }).success,
    ).toBe(false);
  });
});
