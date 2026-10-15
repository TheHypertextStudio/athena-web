import { describe, expect, it } from 'vitest';
import { selectBlueprintLabels } from '../../src/lib/work-template-blueprints/labels';

describe('reusable child labels at the actual destination', () => {
  const catalog = [
    { id: 'workspace', teamId: null },
    { id: 'ours', teamId: 'team' },
    { id: 'elsewhere', teamId: 'other' },
  ];
  it('retains offered labels in authored order and drops deleted or foreign-team labels', () => {
    expect(
      selectBlueprintLabels(['ours', 'deleted', 'workspace', 'elsewhere', 'ours'], catalog, 'team'),
    ).toEqual({ kept: ['ours', 'workspace'], omitted: true });
  });
  it('allows only workspace labels without an owning team', () => {
    expect(selectBlueprintLabels(['ours', 'workspace'], catalog, null)).toEqual({
      kept: ['workspace'],
      omitted: true,
    });
    expect(selectBlueprintLabels(['workspace'], catalog, null)).toEqual({
      kept: ['workspace'],
      omitted: false,
    });
  });
});
