/** `@docket/api` — stable calendar-event bindings to reusable process series. */
import {
  calendarItem,
  calendarLayer,
  calendarProcessBinding,
  recurrenceSeries,
  type Database,
} from '@docket/db';
import {
  CalendarProcessBindingCreate,
  CalendarProcessBindingOut,
  type CalendarProcessBindingCreate as CalendarProcessBindingCreateValue,
} from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../../error';
import { createRecurrenceSeriesInTransaction, materializeSeriesOccurrence } from './series';

/** Command for binding one user-owned calendar item to an org-owned process definition. */
export interface BindProcessToCalendarItemCommand {
  /** Workspace that owns the process and generated work. */
  readonly organizationId: string;
  /** Actor credited with authoring the series and initial occurrence. */
  readonly actorId?: string;
  /** Signed-in user who must own the personal calendar item. */
  readonly userId: string;
  /** User-selected calendar item and process definition. */
  readonly calendarItemId: string;
  readonly processDefinitionId: string;
}

/** One provider occurrence ready to materialize against every matching workspace binding. */
export interface MaterializeCalendarBindingsCommand {
  /** Provider-backed calendar layer that received the occurrence. */
  readonly calendarLayerId: string;
  /** Stable provider series id (or the event id for a one-off event). */
  readonly externalSeriesId: string;
  /** Stable provider occurrence id used for retry-safe materialization. */
  readonly externalOccurrenceKey: string;
  /** Civil date of the event in its calendar timezone. */
  readonly scheduledFor: string;
}

/** Non-fatal outcome used by calendar sync to keep event ingestion independent of process work. */
export interface CalendarBindingMaterializationResult {
  /** Matching active bindings successfully materialized (including idempotent retries). */
  readonly materialized: number;
  /** Per-binding failures for sync diagnostics; one binding never blocks the others. */
  readonly errors: readonly string[];
}

/** Minimal provider occurrence timing required to derive its civil trigger date. */
export interface CalendarOccurrenceTiming {
  readonly startsAt: Date | null;
  readonly allDayStartDate: string | null;
  readonly timezone?: string | null;
}

/** Format an instant as a civil date in a provider or layer timezone. */
function instantCalendarDate(instant: Date, timezone: string): string {
  const formatter = (timeZone: string): Intl.DateTimeFormat =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatter(timezone).formatToParts(instant);
  } catch {
    parts = formatter('UTC').formatToParts(instant);
  }
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value['year']}-${value['month']}-${value['day']}`;
}

/** Derive a provider occurrence's civil date without converting an all-day value through UTC. */
export function calendarOccurrenceDate(
  occurrence: CalendarOccurrenceTiming,
  fallbackTimezone = 'UTC',
): string {
  if (occurrence.allDayStartDate !== null) return occurrence.allDayStartDate;
  if (occurrence.startsAt === null) throw new ConflictError('Calendar item has no start time');
  return instantCalendarDate(occurrence.startsAt, occurrence.timezone ?? fallbackTimezone);
}

/** Resolve the occurrence date from one persisted all-day or timed calendar item. */
function itemCalendarDate(
  item: typeof calendarItem.$inferSelect,
  layer: typeof calendarLayer.$inferSelect,
): string {
  return calendarOccurrenceDate(item, layer.timezone ?? 'UTC');
}

/**
 * Create the stable event-series binding and materialize the selected event immediately.
 *
 * @remarks
 * The binding and recurrence series commit atomically. A retry finds that same pair and retries the
 * occurrence materialization, whose provider occurrence key makes the generated work idempotent.
 */
export async function bindProcessToCalendarItem(
  database: Database,
  rawCommand: BindProcessToCalendarItemCommand,
): Promise<z.input<typeof CalendarProcessBindingOut>> {
  const selected = CalendarProcessBindingCreate.parse({
    calendarItemId: rawCommand.calendarItemId,
    processDefinitionId: rawCommand.processDefinitionId,
  }) satisfies CalendarProcessBindingCreateValue;
  const bound = await database.transaction(async (tx) => {
    const rows = await tx
      .select({ item: calendarItem, layer: calendarLayer })
      .from(calendarItem)
      .innerJoin(calendarLayer, eq(calendarLayer.id, calendarItem.layerId))
      .where(
        and(
          eq(calendarItem.id, selected.calendarItemId),
          eq(calendarItem.userId, rawCommand.userId),
          eq(calendarLayer.userId, rawCommand.userId),
          isNull(calendarItem.archivedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Calendar item not found');
    const externalSeriesId = row.item.recurringEventId ?? row.item.externalEventId ?? row.item.id;
    const scope = row.item.recurringEventId === null ? 'single_event' : 'event_series';
    const existing = await tx
      .select({ binding: calendarProcessBinding, series: recurrenceSeries })
      .from(calendarProcessBinding)
      .innerJoin(recurrenceSeries, eq(recurrenceSeries.id, calendarProcessBinding.seriesId))
      .where(
        and(
          eq(calendarProcessBinding.organizationId, rawCommand.organizationId),
          eq(calendarProcessBinding.calendarLayerId, row.layer.id),
          eq(calendarProcessBinding.externalSeriesId, externalSeriesId),
          isNull(recurrenceSeries.archivedAt),
        ),
      )
      .limit(1);
    const current = existing[0];
    if (current && current.binding.definitionId !== selected.processDefinitionId) {
      throw new ConflictError('This calendar series already uses a different process');
    }
    if (current) {
      return { ...current, item: row.item, layer: row.layer, scope, externalSeriesId };
    }

    const name = `${row.item.title} work`;
    const seriesId = await createRecurrenceSeriesInTransaction(tx, {
      organizationId: rawCommand.organizationId,
      actorId: rawCommand.actorId,
      series: {
        processDefinitionId: selected.processDefinitionId,
        name,
        trigger: { kind: 'event', event: { kind: 'calendar.item', source: 'calendar' } },
        effectiveFrom: itemCalendarDate(row.item, row.layer),
      },
    });
    const inserted = await tx
      .insert(calendarProcessBinding)
      .values({
        organizationId: rawCommand.organizationId,
        calendarLayerId: row.layer.id,
        externalSeriesId,
        definitionId: selected.processDefinitionId,
        seriesId,
      })
      .returning();
    const binding = inserted[0];
    if (!binding) throw new ConflictError('Calendar process binding could not be created');
    return {
      binding,
      series: { id: seriesId, name },
      item: row.item,
      layer: row.layer,
      scope,
      externalSeriesId,
    };
  });

  await materializeSeriesOccurrence(database, {
    organizationId: rawCommand.organizationId,
    actorId: rawCommand.actorId,
    seriesId: bound.series.id,
    scheduledFor: itemCalendarDate(bound.item, bound.layer),
    occurrenceKey: bound.item.externalEventId ?? bound.item.id,
  });

  return CalendarProcessBindingOut.parse({
    id: bound.binding.id,
    organizationId: bound.binding.organizationId,
    calendarItemId: bound.item.id,
    calendarLayerId: bound.binding.calendarLayerId,
    externalSeriesId: bound.externalSeriesId,
    scope: bound.scope,
    processDefinitionId: bound.binding.definitionId,
    recurrenceSeriesId: bound.binding.seriesId,
    seriesName: bound.series.name,
    createdAt: bound.binding.createdAt.toISOString(),
  });
}

/**
 * Materialize a synced provider occurrence for every active process binding on its calendar series.
 *
 * @remarks
 * Calendar sync calls this after persisting the event. Errors are isolated per workspace binding so
 * a broken process cannot prevent the calendar item or another workspace's process from syncing.
 */
export async function materializeCalendarProcessBindings(
  database: Database,
  command: MaterializeCalendarBindingsCommand,
): Promise<CalendarBindingMaterializationResult> {
  const rows = await database
    .select({ binding: calendarProcessBinding, series: recurrenceSeries })
    .from(calendarProcessBinding)
    .innerJoin(recurrenceSeries, eq(recurrenceSeries.id, calendarProcessBinding.seriesId))
    .where(
      and(
        eq(calendarProcessBinding.calendarLayerId, command.calendarLayerId),
        eq(calendarProcessBinding.externalSeriesId, command.externalSeriesId),
        eq(recurrenceSeries.status, 'active'),
        isNull(recurrenceSeries.archivedAt),
      ),
    );
  let materialized = 0;
  const errors: string[] = [];
  for (const row of rows) {
    try {
      await materializeSeriesOccurrence(database, {
        organizationId: row.binding.organizationId,
        seriesId: row.binding.seriesId,
        scheduledFor: command.scheduledFor,
        occurrenceKey: command.externalOccurrenceKey,
      });
      materialized += 1;
    } catch (error) {
      errors.push(
        `${row.binding.seriesId}: ${error instanceof Error ? error.message : 'materialization failed'}`,
      );
    }
  }
  return { materialized, errors };
}
