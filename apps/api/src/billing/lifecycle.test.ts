import { resolve } from 'node:path';

import { InMemoryBillingGateway } from '@docket/boundaries';
import { type Database, organization } from '@docket/db';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  applyBillingEvent,
  EXPORT_WINDOW_DAYS,
  onPastDue,
  onReactivated,
  onTrialOrPaymentTerminal,
  sweepLifecycle,
} from './lifecycle';

const NOW = '2026-01-01T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

let db!: Database;

/** Insert an org in a given lifecycle state and return its id. */
async function makeOrg(
  state: (typeof organization.$inferSelect)['lifecycleState'],
  extra: Partial<typeof organization.$inferInsert> = {},
): Promise<string> {
  const slug = `org-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await db
    .insert(organization)
    .values({ name: slug, slug, lifecycleState: state, ...extra })
    .returning({ id: organization.id });
  return rows[0]!.id;
}

/** Read an org's full lifecycle columns. */
async function readOrg(id: string) {
  const rows = await db
    .select({
      lifecycleState: organization.lifecycleState,
      exportReadyAt: organization.exportReadyAt,
      deleteAfterAt: organization.deleteAfterAt,
    })
    .from(organization)
    .where(eq(organization.id, id))
    .limit(1);
  return rows[0]!;
}

beforeAll(async () => {
  const client = new PGlite('memory://');
  const d = drizzle(client);
  await migrate(d, {
    migrationsFolder: resolve(import.meta.dirname, '../../../../packages/db/drizzle'),
  });
  db = d as unknown as Database;
});

describe('onTrialOrPaymentTerminal', () => {
  it('moves a trialing org into the export window with a +14d delete deadline', async () => {
    const id = await makeOrg('trialing');
    const updated = await onTrialOrPaymentTerminal(db, id, NOW);
    expect(updated).toBe(1);

    const org = await readOrg(id);
    expect(org.lifecycleState).toBe('export_window');
    expect(org.exportReadyAt?.toISOString()).toBe(NOW);
    expect(org.deleteAfterAt?.getTime()).toBe(
      new Date(NOW).getTime() + EXPORT_WINDOW_DAYS * DAY_MS,
    );
  });

  it('is idempotent: re-running re-stamps the same window (no further advance)', async () => {
    const id = await makeOrg('active');
    await onTrialOrPaymentTerminal(db, id, NOW);
    const second = await onTrialOrPaymentTerminal(db, id, NOW);
    expect(second).toBe(1); // still in export_window, re-stamped to the same instant
    const org = await readOrg(id);
    expect(org.lifecycleState).toBe('export_window');
    expect(org.deleteAfterAt?.getTime()).toBe(
      new Date(NOW).getTime() + EXPORT_WINDOW_DAYS * DAY_MS,
    );
  });

  it('does not pull a pending_deletion org back into the window', async () => {
    const id = await makeOrg('pending_deletion');
    const updated = await onTrialOrPaymentTerminal(db, id, NOW);
    expect(updated).toBe(0);
    expect((await readOrg(id)).lifecycleState).toBe('pending_deletion');
  });
});

describe('onReactivated', () => {
  it('rescues an export_window org back to active and clears the timers', async () => {
    const id = await makeOrg('export_window', {
      exportReadyAt: new Date(NOW),
      deleteAfterAt: new Date(new Date(NOW).getTime() + EXPORT_WINDOW_DAYS * DAY_MS),
    });
    const updated = await onReactivated(db, id);
    expect(updated).toBe(1);
    const org = await readOrg(id);
    expect(org.lifecycleState).toBe('active');
    expect(org.exportReadyAt).toBeNull();
    expect(org.deleteAfterAt).toBeNull();
  });

  it('cannot reactivate a deleted org', async () => {
    const id = await makeOrg('deleted');
    expect(await onReactivated(db, id)).toBe(0);
    expect((await readOrg(id)).lifecycleState).toBe('deleted');
  });
});

describe('onPastDue', () => {
  it('marks an active org past_due without entering the window', async () => {
    const id = await makeOrg('active');
    expect(await onPastDue(db, id)).toBe(1);
    const org = await readOrg(id);
    expect(org.lifecycleState).toBe('past_due');
    expect(org.deleteAfterAt).toBeNull();
  });
});

describe('sweepLifecycle', () => {
  it('advances export_window → pending_deletion → deleted across two sweeps once the deadline passes', async () => {
    const past = new Date(new Date(NOW).getTime() - DAY_MS);
    const id = await makeOrg('export_window', {
      exportReadyAt: new Date(NOW),
      deleteAfterAt: past,
    });

    const first = await sweepLifecycle(db, NOW);
    expect(first.toPendingDeletion).toBeGreaterThanOrEqual(1);
    expect((await readOrg(id)).lifecycleState).toBe('pending_deletion');

    const second = await sweepLifecycle(db, NOW);
    expect(second.toDeleted).toBeGreaterThanOrEqual(1);
    const org = await readOrg(id);
    expect(org.lifecycleState).toBe('deleted');
    expect(org.exportReadyAt).toBeNull();
  });

  it('does not advance an org whose deadline has not yet passed', async () => {
    const future = new Date(new Date(NOW).getTime() + DAY_MS);
    const id = await makeOrg('export_window', {
      exportReadyAt: new Date(NOW),
      deleteAfterAt: future,
    });
    await sweepLifecycle(db, NOW);
    expect((await readOrg(id)).lifecycleState).toBe('export_window');
  });

  it('keeps pending_deletion observable for one cycle, then deletes on the next sweep', async () => {
    const past = new Date(new Date(NOW).getTime() - DAY_MS);
    const id = await makeOrg('export_window', {
      exportReadyAt: new Date(NOW),
      deleteAfterAt: past,
    });

    const first = await sweepLifecycle(db, NOW);
    // Promoted to pending_deletion this sweep — NOT deleted in the same pass.
    expect(first.toPendingDeletion).toBeGreaterThanOrEqual(1);
    expect((await readOrg(id)).lifecycleState).toBe('pending_deletion');

    const second = await sweepLifecycle(db, NOW);
    expect(second.toDeleted).toBeGreaterThanOrEqual(1);
    expect((await readOrg(id)).lifecycleState).toBe('deleted');

    // A fully-deleted org is untouched by any further sweeps.
    await sweepLifecycle(db, NOW);
    expect((await readOrg(id)).lifecycleState).toBe('deleted');
  });
});

describe('applyBillingEvent (BillingEvent → lifecycle)', () => {
  it('a checkout.completed (trialing) keeps/returns the org active', async () => {
    const id = await makeOrg('export_window', {
      exportReadyAt: new Date(NOW),
      deleteAfterAt: new Date(new Date(NOW).getTime() + EXPORT_WINDOW_DAYS * DAY_MS),
    });
    const gateway = new InMemoryBillingGateway({ now: NOW });
    await gateway.createCheckoutSession({
      referenceId: id,
      priceKey: 'docket_team',
      successUrl: 'https://x/ok',
      cancelUrl: 'https://x/no',
    });
    const checkout = gateway.events.find(
      (e) => e.type === 'checkout.completed' && e.referenceId === id,
    )!;

    const effect = await applyBillingEvent(db, checkout, NOW);
    expect(effect).toBe('active');
    expect((await readOrg(id)).lifecycleState).toBe('active');
  });

  it('a past_due event marks the org past_due', async () => {
    const id = await makeOrg('active');
    const gateway = new InMemoryBillingGateway({ now: NOW });
    await gateway.createCheckoutSession({
      referenceId: id,
      priceKey: 'p',
      successUrl: 'a',
      cancelUrl: 'b',
    });
    let evt = gateway.advance(id); // created/trialing
    while (evt && evt.subscription?.status !== 'past_due') evt = gateway.advance(id);
    expect(evt?.subscription?.status).toBe('past_due');

    const effect = await applyBillingEvent(db, evt!, NOW);
    expect(effect).toBe('past_due');
    expect((await readOrg(id)).lifecycleState).toBe('past_due');
  });

  it('a canceled event drives the org into the export window (terminal)', async () => {
    const id = await makeOrg('active');
    const gateway = new InMemoryBillingGateway({ now: NOW });
    await gateway.createCheckoutSession({
      referenceId: id,
      priceKey: 'p',
      successUrl: 'a',
      cancelUrl: 'b',
    });
    await gateway.cancelSubscription(id);
    const canceled = gateway.events.find(
      (e) => e.type === 'subscription.canceled' && e.referenceId === id,
    )!;

    const effect = await applyBillingEvent(db, canceled, NOW);
    expect(effect).toBe('export_window');
    const org = await readOrg(id);
    expect(org.lifecycleState).toBe('export_window');
    expect(org.deleteAfterAt?.getTime()).toBe(
      new Date(NOW).getTime() + EXPORT_WINDOW_DAYS * DAY_MS,
    );
  });

  it('replaying the same canceled event is idempotent (same terminal state)', async () => {
    const id = await makeOrg('active');
    const gateway = new InMemoryBillingGateway({ now: NOW });
    await gateway.createCheckoutSession({
      referenceId: id,
      priceKey: 'p',
      successUrl: 'a',
      cancelUrl: 'b',
    });
    await gateway.cancelSubscription(id);
    const canceled = gateway.events.find(
      (e) => e.type === 'subscription.canceled' && e.referenceId === id,
    )!;
    await applyBillingEvent(db, canceled, NOW);
    const first = await readOrg(id);
    await applyBillingEvent(db, canceled, NOW);
    const second = await readOrg(id);
    expect(second.lifecycleState).toBe(first.lifecycleState);
    expect(second.deleteAfterAt?.getTime()).toBe(first.deleteAfterAt?.getTime());
  });
});
