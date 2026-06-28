/**
 * Analytics route serializers.
 *
 * @packageDocumentation
 */

import type { DashboardSummary } from '../../services/analytics/types.js';

export function toDashboardSummary(summary: DashboardSummary) {
  return {
    ...summary,
    dateFrom: summary.dateFrom,
    dateTo: summary.dateTo,
  };
}
