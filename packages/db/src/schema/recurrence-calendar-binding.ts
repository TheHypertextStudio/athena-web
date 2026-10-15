import { sql } from 'drizzle-orm';
import { check, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { calendarLayer } from './calendar';
import { auditColumns } from './identity';
import { processDefinition, recurrenceSeries } from './recurrence';

/** Stable binding from one external calendar event series to one Docket process series. */
export const calendarProcessBinding = pgTable(
  'calendar_process_binding',
  {
    ...auditColumns(),
    calendarLayerId: text('calendar_layer_id')
      .notNull()
      .references(() => calendarLayer.id, { onDelete: 'cascade' }),
    externalSeriesId: text('external_series_id').notNull(),
    definitionId: text('definition_id')
      .notNull()
      .references(() => processDefinition.id, { onDelete: 'restrict' }),
    seriesId: text('series_id')
      .notNull()
      .references(() => recurrenceSeries.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('calendar_process_binding_series_uq').on(
      t.organizationId,
      t.calendarLayerId,
      t.externalSeriesId,
    ),
    uniqueIndex('calendar_process_binding_recurrence_series_uq').on(t.seriesId),
    check(
      'calendar_process_binding_external_series_not_blank',
      sql`length(btrim(${t.externalSeriesId})) > 0`,
    ),
  ],
);
