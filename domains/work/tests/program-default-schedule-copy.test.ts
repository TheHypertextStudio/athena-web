import { describe, expect, it } from 'vitest';
import {
  ProgramDefaultSchedule,
  instantiateDefaultScheduleCopy,
} from '../src/contracts/work-schedule-defaults';
const id = '01M4Y1B4B5V04E5ANJQ5QHTEZ8';
const outline = ProgramDefaultSchedule.parse({
  key: 'dinner',
  name: 'Dinner',
  template: { targetType: 'project', workTypeId: id, selection: { kind: 'latest' } },
  titlePattern: '{month} Dinner',
  cadence: { kind: 'daily', startOffsetDays: 2 },
  teamRule: 'parent_team',
  actorRule: 'parent_responsible',
});
const context = {
  creationDate: '2026-12-31',
  timezone: 'America/Los_Angeles',
  creationTeamId: id,
  initiatingActorId: id,
  athenaActorId: null,
};
describe('independent Program schedule copies', () => {
  it('resolves actual parent assignments and relative civil start into an independent draft', () => {
    const copy = instantiateDefaultScheduleCopy(
      outline,
      { teamId: id, responsibleActorId: id },
      context,
    );
    expect(copy.cadence.startDate).toBe('2027-01-02');
    expect(copy.root).toEqual({
      kind: 'project',
      fields: {},
      dates: {},
      placement: {},
      teamId: id,
      responsibleActorId: id,
    });
    copy.cadence.interval = 3;
    expect(outline.cadence.interval).toBe(1);
  });
  it('keeps explicit unassigned and never substitutes the creator for missing parent responsibility', () => {
    expect(
      instantiateDefaultScheduleCopy(outline, { teamId: null, responsibleActorId: null }, context)
        .root.responsibleActorId,
    ).toBeNull();
    const creator = {
      ...outline,
      actorRule: 'creator' as const,
      teamRule: 'creation_team' as const,
    };
    expect(
      instantiateDefaultScheduleCopy(creator, { teamId: null, responsibleActorId: null }, context)
        .root.responsibleActorId,
    ).toBe(id);
  });
});
