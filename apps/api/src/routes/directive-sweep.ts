/**
 * `@docket/api` — the directive-posture sweep (curfew-integration.md §4).
 *
 * @remarks
 * Every five minutes the scheduler recomputes each configured Hub's posture for its local
 * "today" from the day's blocks and the wall clock, and publishes
 * `notifications/resources/updated` for `docket://hub/directive` **only when the posture
 * actually changed** — a healthy day produces no notification traffic, and a polling client
 * gains nothing by asking more often than the sweep runs.
 *
 * Change detection rides the `directiveId` invariant `computeDirective` already maintains: the
 * id is regenerated exactly when the persisted posture or reason moves, so "did this sweep
 * change anything" is one id comparison rather than a second copy of the change rule. The
 * publish is addressed per-Hub ({@link notifyHubResourceUpdated}) because the directive URI is
 * the same string for every caller and resolves against the reader's own Hub.
 *
 * Idempotent and retry-safe: recomputing an unchanged day rewrites nothing and publishes
 * nothing, so a scheduler retry is a no-op.
 */
import { dayDirective, db } from '@docket/db';
import { and, eq } from 'drizzle-orm';

import { notifyHubResourceUpdated } from '../mcp/notify';
import { advanceEveningExtension } from '../services/boundary/extension-service';
import { getDayBoundaryPort } from '../services/boundary/registry';
import { computeDirective, loadDayContext } from '../services/scheduling/directive-service';
import { hubToday, hubsWithSchedulingConfigured } from '../services/scheduling/repository';

/** The caller-scoped MCP resource URI the sweep publishes updates for. */
export const DIRECTIVE_RESOURCE_URI = 'docket://hub/directive';

/** What one sweep pass did. */
export interface DirectiveSweepResult {
  /** How many configured Hubs were evaluated. */
  readonly hubs: number;
  /** How many Hubs' posture changed (each published one resource-updated notification). */
  readonly changed: number;
  /** How many Hubs failed to compute; each is logged and the sweep moves on. */
  readonly failed: number;
  /** How many Hubs queued a bounded request for more evening this pass. */
  readonly extensionsRequested: number;
  /** How many previously-queued requests reached a terminal answer this pass. */
  readonly extensionsResolved: number;
}

/**
 * Recompute every configured Hub's posture for its local today, publishing on change only.
 *
 * @param now - The instant to evaluate at (request time, never module scope).
 * @returns the pass's counts.
 */
export async function sweepDirectivePosture(now: Date): Promise<DirectiveSweepResult> {
  const hubs = await hubsWithSchedulingConfigured(db);
  const port = getDayBoundaryPort();
  let changed = 0;
  let failed = 0;
  let extensionsRequested = 0;
  let extensionsResolved = 0;
  for (const entry of hubs) {
    try {
      const date = hubToday(entry.timezone, now);
      const before = await db
        .select({ directiveId: dayDirective.directiveId })
        .from(dayDirective)
        .where(and(eq(dayDirective.hubId, entry.hubId), eq(dayDirective.date, date)))
        .limit(1);
      const context = await loadDayContext(db, {
        hubId: entry.hubId,
        userId: entry.userId,
        date,
      });
      const directive = await computeDirective(db, context, { now });

      // The boundary loop rides this pass rather than a second schedule of its own. It reads the
      // same day the posture was just computed from, and it is deliberately *after* that
      // computation and outside the change-only guard below: a day whose posture is unchanged can
      // still have a request waiting on an answer, and skipping the poll on a quiet tick is how a
      // pending request would go unresolved all evening. It writes only its own table, so an
      // unchanged posture still publishes nothing.
      const pass = await advanceEveningExtension(db, context, { port, now });
      if (pass.submitted) extensionsRequested += 1;
      extensionsResolved += pass.resolved;

      if (before[0]?.directiveId === directive.directiveId) continue;
      changed += 1;
      await notifyHubResourceUpdated(entry.userId, DIRECTIVE_RESOURCE_URI);
    } catch (err) {
      // One Hub's failure must not starve every Hub after it; the scheduler retries the sweep.
      failed += 1;
      console.error(`directive-posture sweep failed for hub ${entry.hubId}:`, err);
    }
  }
  return { hubs: hubs.length, changed, failed, extensionsRequested, extensionsResolved };
}
