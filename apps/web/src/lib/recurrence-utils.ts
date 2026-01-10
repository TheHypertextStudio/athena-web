/**
 * Recurrence utilities for the calendar UI.
 *
 * Provides functions for building, parsing, and describing RRULE strings.
 */

import { RRule, Frequency, type Weekday } from 'rrule';

/**
 * Frequency options for the UI.
 */
export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * End type options for recurrence.
 */
export type RecurrenceEndType = 'never' | 'on_date' | 'after_count';

/**
 * Days of the week.
 */
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type WeekdayCode = (typeof WEEKDAYS)[number];

/**
 * Weekday labels for the UI.
 */
export const WEEKDAY_LABELS: Record<WeekdayCode, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

/**
 * Short weekday labels.
 */
export const WEEKDAY_SHORT_LABELS: Record<WeekdayCode, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};

/**
 * Configuration for building an RRULE.
 */
export interface RecurrenceConfig {
  frequency: RecurrenceFrequency;
  interval: number;
  byWeekday?: WeekdayCode[];
  byMonthDay?: number[];
  endType: RecurrenceEndType;
  endDate?: Date;
  endCount?: number;
}

/**
 * Common recurrence presets.
 */
export const RECURRENCE_PRESETS = {
  none: null,
  daily: { frequency: 'daily' as const, interval: 1, endType: 'never' as const },
  weekdays: {
    frequency: 'weekly' as const,
    interval: 1,
    byWeekday: ['MO', 'TU', 'WE', 'TH', 'FR'] as WeekdayCode[],
    endType: 'never' as const,
  },
  weekly: { frequency: 'weekly' as const, interval: 1, endType: 'never' as const },
  biweekly: { frequency: 'weekly' as const, interval: 2, endType: 'never' as const },
  monthly: { frequency: 'monthly' as const, interval: 1, endType: 'never' as const },
  yearly: { frequency: 'yearly' as const, interval: 1, endType: 'never' as const },
} as const;

export type RecurrencePreset = keyof typeof RECURRENCE_PRESETS;

/**
 * Preset labels for the UI.
 */
export const PRESET_LABELS: Record<RecurrencePreset, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekdays: 'Every weekday (Mon-Fri)',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/**
 * Map frequency strings to RRule Frequency enum.
 */
const FREQUENCY_MAP: Record<RecurrenceFrequency, Frequency> = {
  daily: Frequency.DAILY,
  weekly: Frequency.WEEKLY,
  monthly: Frequency.MONTHLY,
  yearly: Frequency.YEARLY,
};

/**
 * Map weekday codes to RRule Weekday instances.
 */
const WEEKDAY_MAP: Record<WeekdayCode, Weekday> = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
};

/**
 * Build an RRULE string from a configuration object.
 */
export function buildRRule(config: RecurrenceConfig): string {
  const options: Partial<{
    freq: Frequency;
    interval: number;
    byweekday: Weekday[];
    bymonthday: number[];
    count: number;
    until: Date;
  }> = {
    freq: FREQUENCY_MAP[config.frequency],
  };

  if (config.interval > 1) {
    options.interval = config.interval;
  }

  if (config.byWeekday && config.byWeekday.length > 0) {
    options.byweekday = config.byWeekday.map((day) => WEEKDAY_MAP[day]);
  }

  if (config.byMonthDay && config.byMonthDay.length > 0) {
    options.bymonthday = config.byMonthDay;
  }

  if (config.endType === 'after_count' && config.endCount) {
    options.count = config.endCount;
  }

  if (config.endType === 'on_date' && config.endDate) {
    options.until = config.endDate;
  }

  const rule = new RRule(options);
  // Return just the RRULE part without DTSTART
  return rule
    .toString()
    .replace(/^DTSTART:[^\n]*\n/, '')
    .replace(/^RRULE:/, '');
}

/**
 * Parse an RRULE string into a configuration object.
 */
export function parseRRule(rruleString: string): RecurrenceConfig | null {
  if (!rruleString) return null;

  try {
    // Normalize the string
    const normalized = rruleString.startsWith('RRULE:') ? rruleString : `RRULE:${rruleString}`;
    const rule = RRule.fromString(normalized);
    const options = rule.origOptions;

    // Map frequency back
    let frequency: RecurrenceFrequency = 'daily';
    if (options.freq === Frequency.WEEKLY) frequency = 'weekly';
    else if (options.freq === Frequency.MONTHLY) frequency = 'monthly';
    else if (options.freq === Frequency.YEARLY) frequency = 'yearly';

    // Map weekdays back
    let byWeekday: WeekdayCode[] | undefined;
    if (options.byweekday) {
      const weekdays = Array.isArray(options.byweekday) ? options.byweekday : [options.byweekday];
      byWeekday = weekdays.map((wd) => {
        if (typeof wd === 'number') {
          return WEEKDAYS[wd] ?? 'MO';
        }
        // Handle Weekday objects
        const weekdayObj = wd as { weekday: number };
        return WEEKDAYS[weekdayObj.weekday] ?? 'MO';
      });
    }

    // Determine end type
    let endType: RecurrenceEndType = 'never';
    let endDate: Date | undefined;
    let endCount: number | undefined;

    if (options.count) {
      endType = 'after_count';
      endCount = options.count;
    } else if (options.until) {
      endType = 'on_date';
      endDate = options.until;
    }

    return {
      frequency,
      interval: options.interval ?? 1,
      byWeekday,
      byMonthDay: options.bymonthday as number[] | undefined,
      endType,
      endDate,
      endCount,
    };
  } catch {
    return null;
  }
}

/**
 * Get a human-readable description of an RRULE string.
 */
export function describeRRule(rruleString: string): string {
  if (!rruleString) return 'Does not repeat';

  const config = parseRRule(rruleString);
  if (!config) return 'Custom recurrence';

  let description = '';

  // Frequency and interval
  switch (config.frequency) {
    case 'daily':
      description = config.interval > 1 ? `Every ${String(config.interval)} days` : 'Daily';
      break;
    case 'weekly':
      if (config.byWeekday && config.byWeekday.length > 0) {
        const dayLabels = config.byWeekday.map((d) => WEEKDAY_SHORT_LABELS[d]);
        description =
          config.interval > 1
            ? `Every ${String(config.interval)} weeks on ${dayLabels.join(', ')}`
            : `Weekly on ${dayLabels.join(', ')}`;
      } else {
        description = config.interval > 1 ? `Every ${String(config.interval)} weeks` : 'Weekly';
      }
      break;
    case 'monthly':
      description = config.interval > 1 ? `Every ${String(config.interval)} months` : 'Monthly';
      break;
    case 'yearly':
      description = config.interval > 1 ? `Every ${String(config.interval)} years` : 'Yearly';
      break;
  }

  // End condition
  if (config.endType === 'after_count' && config.endCount) {
    description += `, ${String(config.endCount)} times`;
  } else if (config.endType === 'on_date' && config.endDate) {
    description += `, until ${config.endDate.toLocaleDateString()}`;
  }

  return description;
}

/**
 * Check if a preset matches a configuration.
 */
export function getMatchingPreset(config: RecurrenceConfig): RecurrencePreset {
  // Check weekdays preset
  if (
    config.frequency === 'weekly' &&
    config.interval === 1 &&
    config.byWeekday?.length === 5 &&
    config.byWeekday.includes('MO') &&
    config.byWeekday.includes('TU') &&
    config.byWeekday.includes('WE') &&
    config.byWeekday.includes('TH') &&
    config.byWeekday.includes('FR') &&
    !config.byWeekday.includes('SA') &&
    !config.byWeekday.includes('SU')
  ) {
    return 'weekdays';
  }

  // Check other presets
  if (config.frequency === 'daily' && config.interval === 1) return 'daily';
  if (config.frequency === 'weekly' && config.interval === 1 && !config.byWeekday?.length)
    return 'weekly';
  if (config.frequency === 'weekly' && config.interval === 2 && !config.byWeekday?.length)
    return 'biweekly';
  if (config.frequency === 'monthly' && config.interval === 1) return 'monthly';
  if (config.frequency === 'yearly' && config.interval === 1) return 'yearly';

  return 'none';
}

/**
 * Get the next N occurrences of a recurrence rule.
 */
export function getNextOccurrences(rruleString: string, startDate: Date, count = 5): Date[] {
  if (!rruleString) return [];

  try {
    const normalized = rruleString.startsWith('RRULE:') ? rruleString : `RRULE:${rruleString}`;
    const rule = RRule.fromString(normalized);

    // Create a new rule with the start date
    const ruleWithStart = new RRule({
      ...rule.origOptions,
      dtstart: startDate,
    });

    return ruleWithStart.all((_, i) => i < count);
  } catch {
    return [];
  }
}
