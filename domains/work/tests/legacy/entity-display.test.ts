import { describe, expect, it } from 'vitest';

import {
  defaultEntityDisplay,
  EntityDisplayGlyph,
  EntityDisplayUpdate,
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
      expect(display.glyph).toMatchObject({ kind: 'symbol' });
      expect(display.iconKey).toBeTruthy();
      expect(display.colorKey).toBeTruthy();
      expect(display.customized).toBe(false);
    }
  });

  it('accepts one symbol or one fully qualified emoji sequence as a display glyph', () => {
    expect(EntityDisplayGlyph.parse({ kind: 'symbol', name: 'rocket_launch' })).toEqual({
      kind: 'symbol',
      name: 'rocket_launch',
    });
    expect(EntityDisplayGlyph.parse({ kind: 'emoji', hexcode: '1F44D-1F3FD' })).toEqual({
      kind: 'emoji',
      hexcode: '1F44D-1F3FD',
    });

    expect(EntityDisplayGlyph.safeParse({ kind: 'symbol', name: 'Rocket Launch' }).success).toBe(
      false,
    );
    expect(
      EntityDisplayGlyph.safeParse({ kind: 'symbol', name: 'Not a material symbol!' }).success,
    ).toBe(false);
    expect(EntityDisplayGlyph.safeParse({ kind: 'emoji', hexcode: '👍🏽' }).success).toBe(false);
    expect(EntityDisplayGlyph.safeParse({ kind: 'emoji', hexcode: '1f44d-1f3fd' }).success).toBe(
      false,
    );
  });

  it('accepts the new glyph update and the legacy icon update during compatibility', () => {
    expect(
      EntityDisplayUpdate.parse({
        glyph: { kind: 'emoji', hexcode: '1F680' },
        colorKey: 'purple',
        customColor: null,
      }),
    ).toMatchObject({ glyph: { kind: 'emoji', hexcode: '1F680' } });
    expect(
      EntityDisplayUpdate.parse({ iconKey: 'launch', colorKey: 'purple', customColor: null }),
    ).toMatchObject({ iconKey: 'launch' });
  });
});
