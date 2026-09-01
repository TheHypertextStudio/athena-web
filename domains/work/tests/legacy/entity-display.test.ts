import { describe, expect, it } from 'vitest';

import {
  defaultEntityDisplay,
  ENTITY_PRESENTATION_POLICIES,
  EntityDisplaySubjectType,
  EntityPresentationSubjectType,
} from '../../src/contracts/entity-display';

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
  it('declares a presentation policy for every native interaction subject', () => {
    expect(EntityPresentationSubjectType.options).toEqual([
      'initiative',
      'program',
      'project',
      'task',
      'cycle',
      'milestone',
      'team',
      'label',
      'workStatus',
      'actor',
      'calendarEvent',
      'attachment',
      'timeBlock',
      'initiativeRoot',
      'calendarSlot',
    ]);

    expect(ENTITY_PRESENTATION_POLICIES).toMatchObject({
      initiative: { policy: 'customizable', subjectType: 'initiative' },
      program: { policy: 'customizable', subjectType: 'program' },
      project: { policy: 'customizable', subjectType: 'project' },
      task: { policy: 'customizable', subjectType: 'task' },
      cycle: { policy: 'customizable', subjectType: 'cycle' },
      milestone: { policy: 'customizable', subjectType: 'milestone' },
      team: { policy: 'customizable', subjectType: 'team' },
      label: { policy: 'semantic', subjectType: 'label' },
      workStatus: { policy: 'semantic', subjectType: 'workStatus' },
      actor: { policy: 'avatar' },
      calendarEvent: { policy: 'external' },
      attachment: { policy: 'external' },
      timeBlock: { policy: 'semantic' },
      initiativeRoot: { policy: 'virtual' },
      calendarSlot: { policy: 'virtual' },
    });
  });

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
