/**
 * The organization data-lifecycle state machine.
 *
 * @remarks
 * This machine decides when a workspace's data stops being reachable and when it is authorized for
 * deletion, so its guards are the whole point: an edge that fires too eagerly destroys a paying
 * customer's data, and one that never fires leaves cancelled orgs live forever. The transitions
 * are guarded SQL, so these run against an embedded database — the behavior under test is which
 * rows a `WHERE` clause refuses to touch, which no fake could show.
 *
 * The sweep is a cron handler that will be retried, so idempotence is asserted directly rather
 * than assumed.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import {
  applyBillingEvent,
  EXPORT_WINDOW_DAYS,
  onPastDue,
  onReactivated,
  onTrialOrPaymentTerminal,
  sweepLifecycle,
  type OrgLifecycleState,
} from '../../src/application/lifecycle';
import type { BillingEvent } from '../../src/contracts';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

const NOW = '2026-08-12T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Create an organization in a chosen lifecycle state and return its id. */
async function seedOrg(
  lifecycleState: OrgLifecycleState,
  extra: { deleteAfterAt?: Date | null; exportReadyAt?: Date | null } = {},
): Promise<string> {
  const slug = `billing-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState, ...extra })
    .returning({ id: schema.organization.id });
  const row = rows[0];
  if (!row) throw new Error('failed to seed an organization');
  return row.id;
}

/** Read one organization's lifecycle row back. */
async function readOrg(id: string) {
  const rows = await db
    .select({
      lifecycleState: schema.organization.lifecycleState,
      exportReadyAt: schema.organization.exportReadyAt,
      deleteAfterAt: schema.organization.deleteAfterAt,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, id));
  const row = rows[0];
  if (!row) throw new Error(`organization ${id} vanished`);
  return row;
}

describe('entering the export window', () => {
  it('schedules deletion a full grace period out, and marks the data ready to export', async () => {
    const orgId = await seedOrg('active');

    expect(await onTrialOrPaymentTerminal(db, orgId, NOW)).toBe(1);

    const org = await readOrg(orgId);
    expect(org.lifecycleState).toBe('export_window');
    expect(org.exportReadyAt?.toISOString()).toBe(NOW);
    expect(org.deleteAfterAt?.getTime()).toBe(
      new Date(NOW).getTime() + EXPORT_WINDOW_DAYS * DAY_MS,
    );
  });

  it.each(['trialing', 'active', 'past_due'] as const)(
    'accepts an org that is still operating (%s)',
    async (from) => {
      const orgId = await seedOrg(from);
      expect(await onTrialOrPaymentTerminal(db, orgId, NOW)).toBe(1);
    },
  );

  it.each(['pending_deletion', 'deleted'] as const)(
    'refuses to pull a wound-down org (%s) back into the window',
    async (from) => {
      // Re-opening an export window for an org already authorized for deletion would resurrect
      // data the customer was told was gone.
      const orgId = await seedOrg(from);
      expect(await onTrialOrPaymentTerminal(db, orgId, NOW)).toBe(0);
      expect((await readOrg(orgId)).lifecycleState).toBe(from);
    },
  );

  it('re-stamps the same window when replayed rather than extending it', async () => {
    const orgId = await seedOrg('active');
    await onTrialOrPaymentTerminal(db, orgId, NOW);
    const first = await readOrg(orgId);

    expect(await onTrialOrPaymentTerminal(db, orgId, NOW)).toBe(1);

    const second = await readOrg(orgId);
    expect(second.deleteAfterAt?.getTime()).toBe(first.deleteAfterAt?.getTime());
  });
});

describe('reactivation', () => {
  it('rescues an org out of the export window and clears its deletion schedule', async () => {
    const orgId = await seedOrg('export_window', {
      exportReadyAt: new Date(NOW),
      deleteAfterAt: new Date(new Date(NOW).getTime() + EXPORT_WINDOW_DAYS * DAY_MS),
    });

    expect(await onReactivated(db, orgId)).toBe(1);

    const org = await readOrg(orgId);
    expect(org.lifecycleState).toBe('active');
    expect(org.exportReadyAt).toBeNull();
    expect(org.deleteAfterAt).toBeNull();
  });

  it('cannot resurrect a deleted org', async () => {
    // A late billing webhook must not undo a completed deletion.
    const orgId = await seedOrg('deleted');
    expect(await onReactivated(db, orgId)).toBe(0);
    expect((await readOrg(orgId)).lifecycleState).toBe('deleted');
  });
});

describe('past due is a warning, not a wind-down', () => {
  it.each(['trialing', 'active', 'past_due'] as const)(
    'marks an operating org (%s)',
    async (from) => {
      const orgId = await seedOrg(from);
      expect(await onPastDue(db, orgId)).toBe(1);
      expect((await readOrg(orgId)).lifecycleState).toBe('past_due');
    },
  );

  it('does not drag an org back out of the export window', async () => {
    const orgId = await seedOrg('export_window');
    expect(await onPastDue(db, orgId)).toBe(0);
    expect((await readOrg(orgId)).lifecycleState).toBe('export_window');
  });
});

describe('the deletion sweep', () => {
  const past = new Date(new Date(NOW).getTime() - DAY_MS);
  const future = new Date(new Date(NOW).getTime() + DAY_MS);

  it('advances an elapsed export window to pending deletion', async () => {
    const orgId = await seedOrg('export_window', { deleteAfterAt: past });
    const result = await sweepLifecycle(db, NOW);
    expect(result.toPendingDeletion).toBeGreaterThanOrEqual(1);
    expect((await readOrg(orgId)).lifecycleState).toBe('pending_deletion');
  });

  it('leaves a window that has not elapsed alone', async () => {
    const orgId = await seedOrg('export_window', { deleteAfterAt: future });
    await sweepLifecycle(db, NOW);
    expect((await readOrg(orgId)).lifecycleState).toBe('export_window');
  });

  it('never deletes in the same sweep that promoted an org', async () => {
    // `pending_deletion` has to be observable for at least one cycle, otherwise an org goes from
    // exportable to deleted with no window in which anyone could notice.
    const orgId = await seedOrg('export_window', { deleteAfterAt: past });
    await sweepLifecycle(db, NOW);
    expect((await readOrg(orgId)).lifecycleState).toBe('pending_deletion');
  });

  it('deletes on the following sweep and clears the export pointer', async () => {
    const orgId = await seedOrg('export_window', { deleteAfterAt: past, exportReadyAt: past });
    await sweepLifecycle(db, NOW);
    await sweepLifecycle(db, NOW);

    const org = await readOrg(orgId);
    expect(org.lifecycleState).toBe('deleted');
    expect(org.exportReadyAt).toBeNull();
  });

  it('is idempotent once everything has settled, so the cron can retry safely', async () => {
    await seedOrg('export_window', { deleteAfterAt: past });
    await sweepLifecycle(db, NOW);
    await sweepLifecycle(db, NOW);

    expect(await sweepLifecycle(db, NOW)).toEqual({ toPendingDeletion: 0, toDeleted: 0 });
  });

  it('ignores a pending org with no deletion date rather than deleting it', async () => {
    const orgId = await seedOrg('pending_deletion', { deleteAfterAt: null });
    await sweepLifecycle(db, NOW);
    expect((await readOrg(orgId)).lifecycleState).toBe('pending_deletion');
  });
});

describe('folding billing events into the lifecycle', () => {
  const event = (over: Partial<BillingEvent> & { referenceId: string }): BillingEvent =>
    ({ type: 'subscription.updated', ...over }) as BillingEvent;

  it.each([
    ['trialing', 'active'],
    ['active', 'active'],
    ['past_due', 'past_due'],
    ['canceled', 'export_window'],
  ] as const)('trusts the subscription status %s over the event type', async (status, effect) => {
    const orgId = await seedOrg('active');
    const applied = await applyBillingEvent(
      db,
      event({ referenceId: orgId, subscription: { status } as never }),
      NOW,
    );
    expect(applied).toBe(effect);
  });

  it.each([
    ['checkout.completed', 'active'],
    ['subscription.created', 'active'],
    ['subscription.updated', 'active'],
    ['subscription.past_due', 'past_due'],
    ['subscription.canceled', 'export_window'],
    ['subscription.trial_will_end', 'none'],
  ] as const)(
    'falls back to the event type %s when no snapshot is attached',
    async (type, effect) => {
      const orgId = await seedOrg('active');
      const applied = await applyBillingEvent(db, event({ referenceId: orgId, type }), NOW);
      expect(applied).toBe(effect);
    },
  );

  it('changes nothing for an informational trial-ending notice', async () => {
    // A warning that a trial ends soon must not itself end the trial.
    const orgId = await seedOrg('trialing');
    await applyBillingEvent(
      db,
      event({ referenceId: orgId, type: 'subscription.trial_will_end' } as never),
      NOW,
    );
    expect((await readOrg(orgId)).lifecycleState).toBe('trialing');
  });

  it('reaches the same state when the same event is replayed', async () => {
    const orgId = await seedOrg('active');
    const cancelled = event({ referenceId: orgId, type: 'subscription.canceled' } as never);

    await applyBillingEvent(db, cancelled, NOW);
    const once = await readOrg(orgId);
    await applyBillingEvent(db, cancelled, NOW);
    const twice = await readOrg(orgId);

    expect(twice.lifecycleState).toBe('export_window');
    expect(twice.deleteAfterAt?.getTime()).toBe(once.deleteAfterAt?.getTime());
  });
});
