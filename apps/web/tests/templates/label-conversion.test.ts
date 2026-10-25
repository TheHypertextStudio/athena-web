import { describe, expect, it } from 'vitest';
import {
  conversionWorkQuery,
  conversionChoices,
} from '@/components/templates/label-conversion/selection';
const group = '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  label = '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  template = '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  version = '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  work = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';
describe('explicit label conversion selection', () => {
  it.each(['task', 'project', 'program', 'initiative'] as const)(
    'uses the canonical authorized %s query with only the selected label and active work',
    (kind) => {
      const request = conversionWorkQuery(kind, label);
      expect(request).toMatchObject({
        target: kind,
        limit: 100,
        activeOnly: true,
        definition: {
          filter: { kind: 'predicate', field: 'labels', operator: 'includesAll', operand: [label] },
        },
      });
    },
  );
  it('constructs identity-only choices and never adds an unselected row or label', () => {
    expect(
      conversionChoices(
        { groupId: group, labelId: label, kind: 'task', templateId: template, versionId: version },
        [work],
      ),
    ).toEqual({
      labelGroupId: group,
      items: [
        {
          kind: 'task',
          id: work,
          removeLabelIds: [label],
          workTypeId: template,
          workTypeVersionId: version,
        },
      ],
    });
  });
  it('refuses empty or more than one hundred selected items', () => {
    const input = {
      groupId: group,
      labelId: label,
      kind: 'task' as const,
      templateId: template,
      versionId: version,
    };
    expect(() => conversionChoices(input, [])).toThrow();
    expect(() =>
      conversionChoices(
        input,
        Array.from({ length: 101 }, () => work),
      ),
    ).toThrow();
  });
});
