import { localMinuteOfDay } from '@docket/planning/zoned-time';

/** Choose a supported timezone where the clock falls inside the fixture's work window. */
export function planningTimezone(
  fromMinute = 10 * 60,
  throughMinute = 13 * 60,
  now = new Date(),
): string {
  // A regional shortlist can leave gaps when every listed zone is outside working hours.
  const zone = Intl.supportedValuesOf('timeZone').find((timezone) => {
    const minute = localMinuteOfDay(now, timezone);
    return minute >= fromMinute && minute <= throughMinute;
  });
  if (!zone) throw new Error('No test timezone has a local time inside the requested window.');
  return zone;
}
