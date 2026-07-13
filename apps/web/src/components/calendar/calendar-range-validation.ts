/** Application-owned validation copy for malformed calendar ranges. */
const INVALID_RANGE_MESSAGE = 'Choose valid start and end times in your calendar timezone.';

/**
 * Validate an exclusive-end calendar range before sending it to a mutation.
 *
 * @param startsAt - ISO instant or bare ISO date at the inclusive start.
 * @param endsAt - ISO instant or bare ISO date at the exclusive end.
 * @returns Accessible application copy when the range cannot be persisted, otherwise `null`.
 */
export function calendarRangeError(startsAt: string | null, endsAt: string | null): string | null {
  if (!startsAt || !endsAt) return INVALID_RANGE_MESSAGE;
  const startEpoch = Date.parse(startsAt);
  const endEpoch = Date.parse(endsAt);
  if (!Number.isFinite(startEpoch) || !Number.isFinite(endEpoch)) return INVALID_RANGE_MESSAGE;
  return endEpoch <= startEpoch ? 'End must be after start.' : null;
}
