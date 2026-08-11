import type { AgendaEntry } from './agenda-model';

/** One non-blocking fact that applies to the Agenda's selected day. */
export interface AgendaDayContext {
  /** Stable source item id. */
  readonly id: string;
  /** Supported semantic context category. */
  readonly kind: 'working_location';
  /** User-visible context label supplied by the provider. */
  readonly label: string;
  /** Owning layer color, when available. */
  readonly color: string | null;
}

/** Scheduled entries and semantic facts separated for the single-day Agenda surface. */
export interface AgendaDayPartition {
  readonly dayContext: AgendaDayContext[];
  readonly entries: AgendaEntry[];
}

/**
 * Separate provider day context from events that occupy all-day or timed schedule space.
 *
 * @remarks
 * Classification is intentionally semantic. A normal event titled "Home" remains an event;
 * only a provider item normalized as `working_location` becomes day context.
 *
 * @param entries - Merged legacy and layered Agenda entries.
 * @returns Day-context facts plus the remaining scheduled entries.
 */
export function partitionAgendaDay(entries: readonly AgendaEntry[]): AgendaDayPartition {
  const dayContext: AgendaDayContext[] = [];
  const scheduledEntries: AgendaEntry[] = [];

  for (const entry of entries) {
    if (entry.calendarItem?.providerEventType === 'working_location') {
      dayContext.push({
        id: entry.id,
        kind: 'working_location',
        label: entry.title,
        color: entry.layerColor ?? null,
      });
      continue;
    }
    scheduledEntries.push(entry);
  }

  return { dayContext, entries: scheduledEntries };
}
