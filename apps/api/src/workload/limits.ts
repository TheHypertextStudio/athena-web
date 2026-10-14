import { ValidationError } from '../error';

/** Maximum records in one personal workload projection. */
export const MAX_WORKLOAD_ROWS = 10_000;

/** Refuse a truncated workload rather than presenting partial totals as complete. */
export function assertWorkloadBounded(count: number): void {
  if (count > MAX_WORKLOAD_ROWS) {
    throw new ValidationError([
      {
        path: ['date'],
        message: 'This day contains too many workload records to summarize safely.',
      },
    ]);
  }
}
