import { describe, expect, it } from 'vitest';
import { WorkTemplateAssignment } from '../src/contracts/work-template-reference';

const selection = {
  workTypeId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  workTypeVersionId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
};
const previewToken = `sha256:${'a'.repeat(64)}`;

describe('reviewed work-template starting changes', () => {
  it('keeps every starting-field change off for existing identity-only clients', () => {
    expect(WorkTemplateAssignment.parse(selection)).toMatchObject({
      ...selection,
      applyFields: [],
    });
  });

  it('accepts explicitly reviewed starting-field choices with their preview token', () => {
    expect(
      WorkTemplateAssignment.parse({
        ...selection,
        previewToken,
        applyFields: ['description', 'priority', 'labels', 'status'],
      }),
    ).toMatchObject({ applyFields: ['description', 'priority', 'labels', 'status'], previewToken });
  });

  it('refuses unreviewed content replacement, duplicate choices, dates and children', () => {
    for (const input of [
      { ...selection, applyFields: ['description'] },
      { ...selection, previewToken, applyFields: ['description', 'description'] },
      { ...selection, previewToken, applyFields: ['dueDate'] },
      { ...selection, previewToken, applyFields: ['children'] },
      { ...selection, previewToken, description: 'Caller-supplied body' },
    ])
      expect(WorkTemplateAssignment.safeParse(input).success).toBe(false);
  });
});
