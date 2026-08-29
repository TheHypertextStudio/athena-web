import { describe, expect, it } from 'vitest';

import { defaultEntityDisplay, EntityDisplaySubjectType } from '../src/entity-display';

const CUSTOMIZABLE_WORK_SUBJECTS = [
  'initiative',
  'program',
  'project',
  'task',
  'cycle',
  'milestone',
  'team',
] as const;

describe('entity display subjects', () => {
  it('defines a custom identity for every native work entity', () => {
    expect(EntityDisplaySubjectType.options).toEqual(
      expect.arrayContaining([...CUSTOMIZABLE_WORK_SUBJECTS]),
    );

    for (const subjectType of CUSTOMIZABLE_WORK_SUBJECTS) {
      const display = defaultEntityDisplay(subjectType, '01JENTITYDISPLAY000000000');
      expect(display.subjectType).toBe(subjectType);
      expect(display.iconKey).toBeTruthy();
      expect(display.colorKey).toBeTruthy();
      expect(display.customized).toBe(false);
    }
  });
});
