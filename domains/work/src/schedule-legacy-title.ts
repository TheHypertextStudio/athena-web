import { BlueprintCivilDate } from './contracts/work-template-blueprint';
import { TITLE_MAX } from './task-titles';
/**
 * Render the original date→year→month→monthName replacement order, preserving literal braces/spacing.
 * @throws When the saved civil date is invalid or the rendered work title is blank/oversized.
 */
export function renderLegacyScheduleTitle(pattern: string, civilDate: string): string {
  const date = BlueprintCivilDate.parse(civilDate);
  const [year = '', month = ''] = date.split('-');
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${year}-${month}-01T00:00:00.000Z`),
  );
  const rendered = pattern
    .replaceAll('{date}', date)
    .replaceAll('{year}', year)
    .replaceAll('{month}', month)
    .replaceAll('{monthName}', monthName);
  if (!rendered.trim() || rendered.length > TITLE_MAX)
    throw new RangeError('Use a nonblank schedule title within the work title limit.');
  return rendered;
}
