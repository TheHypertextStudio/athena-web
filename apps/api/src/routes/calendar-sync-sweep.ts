/**
 * `@docket/api` — the calendar background sweep (mirrors `integration-sync.ts`'s
 * `sweepConnectorSync` shape for the layered-calendar domain).
 *
 * @remarks
 * {@link sweepCalendarSync} is what makes calendar sync run without a manual "Sync Now"
 * click: for every user with at least one non-disconnected calendar connection, it runs a
 * full incremental pull ({@link syncCalendarConnections}), drains that user's due
 * provider-write outbox ({@link drainDueCalendarItemWrites}), and registers/renews
 * push-notification watches ({@link registerOrRenewWatches}) so push hints keep working
 * going forward. Idempotent and safe to retry: every per-layer lease inside
 * `syncCalendarConnections` already serializes against a concurrent manual sync, so a
 * layer held by another run is simply skipped for this pass, not an error.
 */
import { calendarConnection, db } from '@docket/db';
import type { CalendarProvider } from '@docket/types';
import { ne } from 'drizzle-orm';

import { drainDueCalendarItemWrites } from '../calendar/calendar-outbox';
import { env } from '../env';

import { registerOrRenewWatches, syncCalendarConnections } from './calendar-sync-engine';
import { createDefaultCalendarSyncModules } from './calendar-sync-modules';

/**
 * Resolve the registered push-notification callback URL for one provider, or `null` when
 * unconfigured — the explicit, no-hidden-default config gate `registerOrRenewWatches`
 * checks before registering any watch. Reading env lives here (the production wiring),
 * never inside the provider-free engine.
 */
export function callbackUrlFor(provider: CalendarProvider): string | null {
  if (provider === 'google') return env.GOOGLE_CALENDAR_WEBHOOK_URL ?? null;
  return null;
}

/** The tally of one {@link sweepCalendarSync} pass. */
export interface CalendarSyncSweepTally {
  /** Users with at least one non-disconnected calendar connection, processed this pass. */
  readonly usersProcessed: number;
  /** Provider-write outbox entries applied across every processed user. */
  readonly writesApplied: number;
  /** Push-notification watch channels newly registered or renewed across every processed user. */
  readonly watchesRegistered: number;
  /** Per-layer/per-connection sync errors collected across every processed user. */
  readonly errors: readonly string[];
}

/**
 * Run the background calendar sweep: sync, drain, and refresh push watches for every user
 * with a live calendar connection.
 *
 * @param now - The sweep's reference time (read at request time, never module scope).
 */
export async function sweepCalendarSync(now: Date): Promise<CalendarSyncSweepTally> {
  const rows = await db
    .selectDistinct({ userId: calendarConnection.userId })
    .from(calendarConnection)
    .where(ne(calendarConnection.status, 'disconnected'));

  const adapters = createDefaultCalendarSyncModules();
  let usersProcessed = 0;
  let writesApplied = 0;
  let watchesRegistered = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const pullResult = await syncCalendarConnections(db, { userId: row.userId, now, adapters });
    errors.push(...pullResult.errors);

    const drainResult = await drainDueCalendarItemWrites(db, {
      userId: row.userId,
      now,
      syncModules: adapters,
    });
    writesApplied += drainResult.applied;

    const watchResult = await registerOrRenewWatches(db, {
      userId: row.userId,
      now,
      adapters,
      callbackUrlFor,
    });
    watchesRegistered += watchResult.registered;

    usersProcessed += 1;
  }

  return { usersProcessed, writesApplied, watchesRegistered, errors };
}
