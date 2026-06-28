/**
 * Analytics route helpers.
 *
 * @packageDocumentation
 */

import type { AnalyticsPeriod } from '../../services/analytics/types.js';

const ANALYTICS_LOOKBACK_DAYS = {
  day: 1,
  week: 7,
  month: 30,
} as const;

const DEFAULT_ANALYTICS_LOOKBACK_DAYS = 30;

export function getLookbackDays(period: AnalyticsPeriod): number {
  switch (period) {
    case 'day':
      return ANALYTICS_LOOKBACK_DAYS.day;
    case 'week':
      return ANALYTICS_LOOKBACK_DAYS.week;
    case 'month':
      return ANALYTICS_LOOKBACK_DAYS.month;
    default:
      return DEFAULT_ANALYTICS_LOOKBACK_DAYS;
  }
}
