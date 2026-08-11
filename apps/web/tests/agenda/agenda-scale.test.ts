import { describe, expect, it } from 'vitest';

import {
  AGENDA_SCALE_STEPS,
  agendaScaleStepDown,
  agendaScaleStepUp,
  normalizeAgendaScale,
} from '@/components/agenda/agenda-scale';

describe('Agenda scale', () => {
  it('exposes only the three intentional whole-number scale steps', () => {
    expect(AGENDA_SCALE_STEPS).toEqual([48, 96, 144]);
  });

  it.each([
    [32, 48],
    [48, 48],
    [60, 48],
    [72, 48],
    [73, 96],
    [108, 96],
    [120, 96],
    [121, 144],
    [172, 144],
  ])('snaps legacy persisted scale %i to %i', (legacy, expected) => {
    expect(normalizeAgendaScale(legacy)).toBe(expected);
  });

  it('steps without ever producing a fractional multiplier', () => {
    expect(agendaScaleStepUp(48)).toBe(96);
    expect(agendaScaleStepUp(96)).toBe(144);
    expect(agendaScaleStepUp(144)).toBe(144);
    expect(agendaScaleStepDown(144)).toBe(96);
    expect(agendaScaleStepDown(96)).toBe(48);
    expect(agendaScaleStepDown(48)).toBe(48);
  });
});
