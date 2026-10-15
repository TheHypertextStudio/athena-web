import { pgEnum } from 'drizzle-orm/pg-core';
/** Durable outcome of one expected recurrence occurrence. */
export const processOccurrenceStatus = pgEnum('process_occurrence_status', [
  'expected',
  'materialized',
  'completed',
  'skipped',
  'canceled',
  'needs_resolution',
  'superseded',
  'failed',
]);
