import { z } from 'zod';
import { parseCalendarDate } from './calendar-date';
import { BlueprintCivilDate } from './contracts/work-template-blueprint';
import { TITLE_MAX } from './task-titles';
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const TOKENS = ['day', 'month', 'month_number', 'year', 'quarter'] as const;
type TitleToken = (typeof TOKENS)[number];
type TitlePart =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'token'; readonly value: TitleToken };
function titleToken(value: string): TitleToken {
  const token = TOKENS.find((token) => token === value);
  if (!token) throw new RangeError('Use a supported schedule title token.');
  return token;
}
function titleParts(pattern: string): TitlePart[] {
  const parts: TitlePart[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '{' && pattern[i + 1] === '{') {
      parts.push({ kind: 'literal', value: '{' });
      i++;
      continue;
    }
    if (char === '}' && pattern[i + 1] === '}') {
      parts.push({ kind: 'literal', value: '}' });
      i++;
      continue;
    }
    if (char === '}') throw new RangeError('Close schedule title tokens.');
    if (char !== '{') {
      parts.push({ kind: 'literal', value: char ?? '' });
      continue;
    }
    const end = pattern.indexOf('}', i + 1);
    if (end < 0) throw new RangeError('Close schedule title tokens.');
    parts.push({ kind: 'token', value: titleToken(pattern.slice(i + 1, end)) });
    i = end;
  }
  return parts;
}
function validPattern(value: string): boolean {
  try {
    titleParts(value);
    return value.trim().length > 0;
  } catch {
    return false;
  }
}
/** Bounded authored schedule title with explicit tokens and escaped literal braces. */
export const ScheduleTitlePattern = z
  .string()
  .min(1)
  .max(256)
  .refine(validPattern, 'Use supported title tokens and balanced braces.');
/** Valid authored schedule title pattern value. */
export type ScheduleTitlePattern = z.infer<typeof ScheduleTitlePattern>;
/** Render English title tokens from a saved run civil date, rejecting invalid or oversized titles without truncation. */
export function renderScheduleTitlePattern(pattern: string, civilDate: string): string {
  const accepted = ScheduleTitlePattern.parse(pattern);
  const date = parseCalendarDate(BlueprintCivilDate.parse(civilDate));
  const values: Readonly<Record<TitleToken, string>> = {
    day: String(date.day),
    month: MONTHS[date.month - 1] ?? '',
    month_number: String(date.month),
    year: String(date.year),
    quarter: String(Math.ceil(date.month / 3)),
  };
  const title = titleParts(accepted)
    .map((part) => (part.kind === 'literal' ? part.value : values[part.value]))
    .join('')
    .trim();
  if (!title || title.length > TITLE_MAX)
    throw new RangeError('Use a nonblank schedule title within the work title limit.');
  return title;
}
