import { describe, expect, it } from 'vitest';
import { workTypeDisplayName } from '@/components/templates/work-type-name';

describe('work type display names', () => {
  it('uses the family noun for the default definition instead of exposing Blank project', () => {
    expect(workTypeDisplayName({ name: 'Blank project', isBase: true }, 'Project')).toBe('Project');
  });

  it('preserves a user-defined type name without interpreting its meaning', () => {
    expect(workTypeDisplayName({ name: 'Community gathering', isBase: false }, 'Project')).toBe(
      'Community gathering',
    );
  });

  it('does not rewrite a user-authored name that happens to contain Blank', () => {
    expect(workTypeDisplayName({ name: 'Blank project', isBase: false }, 'Project')).toBe(
      'Blank project',
    );
  });
});
