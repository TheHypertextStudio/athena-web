/** The only pixels-per-hour values the narrow Agenda rail may persist or display. */
export const AGENDA_SCALE_STEPS = [48, 96, 144] as const;

/** One legal Agenda scale. */
export type AgendaScale = (typeof AGENDA_SCALE_STEPS)[number];

/**
 * Snap a legacy or untrusted persisted scale to the nearest supported Agenda step.
 *
 * @param value - Stored pixels per hour.
 * @returns The nearest legal scale, resolving exact ties toward the less expanded view.
 */
export function normalizeAgendaScale(value: number): AgendaScale {
  return AGENDA_SCALE_STEPS.reduce((closest, candidate) =>
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest,
  );
}

/** Return the next more detailed Agenda scale, clamped at `3×`. */
export function agendaScaleStepUp(value: number): AgendaScale {
  const current = normalizeAgendaScale(value);
  const index = AGENDA_SCALE_STEPS.indexOf(current);
  return AGENDA_SCALE_STEPS[Math.min(index + 1, AGENDA_SCALE_STEPS.length - 1)] ?? current;
}

/** Return the next more compact Agenda scale, clamped at `1×`. */
export function agendaScaleStepDown(value: number): AgendaScale {
  const current = normalizeAgendaScale(value);
  const index = AGENDA_SCALE_STEPS.indexOf(current);
  return AGENDA_SCALE_STEPS[Math.max(index - 1, 0)] ?? current;
}
