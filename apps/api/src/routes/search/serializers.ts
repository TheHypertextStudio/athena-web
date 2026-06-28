/**
 * Search route serializers.
 *
 * @packageDocumentation
 */

import type { IndexStats } from '../../services/search/types.js';

export function toSearchStats(stats: IndexStats) {
  return {
    ...stats,
    lastIndexedAt: stats.lastIndexedAt,
  };
}
