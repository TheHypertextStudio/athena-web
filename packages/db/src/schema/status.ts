/**
 * `@docket/db` — service-status schema island.
 *
 * @remarks
 * Docket had no observability of any kind: one hardcoded liveness route, no Sentry, no tracing, and
 * nowhere at all that recorded whether a dependency had ever answered. An operator could not tell a
 * healthy deployment from a broken one without opening five provider consoles.
 *
 * This island is the truth layer under that. Every probe writes a row whether it succeeded or not,
 * because uptime is a ratio and a check that is only recorded when it passes measures nothing. A
 * failure is a row, a timeout is a row, and a check that never ran leaves a visible gap rather than
 * an implied success.
 *
 * Modelled on `sync_run`: an append-only per-run record carrying an outcome, a duration, and the
 * failure reason when there is one.
 */
import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { probeOutcome } from '../enums';
import { genId } from '../id';

/**
 * One recorded health check.
 *
 * @remarks
 * `serviceKey` is free text rather than an enum on purpose. The set of things worth probing changes
 * with the deployment — a provider is added, the runner is switched on — and an enum would make
 * each of those a migration, which is enough friction that checks would go unadded. The probe
 * runner in the API owns the catalogue; this table stores whatever it reports.
 *
 * `error` holds the failure reason and is null on success. `latencyMs` is recorded even for a
 * failure, since how long a service took to fail is often the more useful number.
 */
export const serviceProbe = pgTable(
  'service_probe',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    /** Which service was checked, as the probe catalogue names it. */
    serviceKey: text('service_key').notNull(),
    /** What the check concluded. */
    outcome: probeOutcome('outcome').notNull(),
    /** How long the check took, including a failure. */
    latencyMs: integer('latency_ms').notNull().default(0),
    /** The HTTP status when the check was an HTTP request, null otherwise. */
    statusCode: integer('status_code'),
    /**
     * Why the check did not succeed, as an application-owned reason code.
     *
     * @remarks
     * Never a provider's error text. This value is rendered in the operator console, and provider
     * messages are uncontrolled input that can carry request URLs, echoed headers, or account
     * identifiers. The probe runner owns the closed vocabulary written here.
     */
    reason: text('reason'),
    /**
     * When the check ran.
     *
     * @remarks
     * `withTimezone` because this is an instant, and the board's whole value is knowing how fresh a
     * verdict is. A naive `timestamp` column taking Postgres `now()` stores the server's local
     * wall-clock and is read back as UTC, which made every check report hours old the moment it was
     * written — a status board that cannot tell a current check from a stale one.
     */
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('service_probe_service_checked_idx').on(t.serviceKey, t.checkedAt)],
);
