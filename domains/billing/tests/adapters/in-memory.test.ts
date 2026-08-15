import { describe, expect, it } from 'vitest';

import { InMemoryBillingGateway } from '../../src/adapters/in-memory';

describe('InMemoryBillingGateway', () => {
  it('starts an existing customer without a second trial when trialDays is zero', async () => {
    const gateway = new InMemoryBillingGateway();
    await gateway.createCheckoutSession({
      referenceId: 'org_returning',
      priceKey: 'docket_pro_monthly',
      successUrl: 'https://app/ok',
      cancelUrl: 'https://app/no',
      trialDays: 0,
    });

    const subscription = await gateway.getSubscription('org_returning');
    expect(subscription).toMatchObject({ status: 'active' });
    expect(subscription).not.toHaveProperty('trialEnd');
  });

  describe('createCheckoutSession', () => {
    it('creates a trialing subscription and emits a checkout.completed event', async () => {
      const gw = new InMemoryBillingGateway();
      const result = await gw.createCheckoutSession({
        referenceId: 'org_1',
        priceKey: 'price_team',
        successUrl: 'https://app/ok',
        cancelUrl: 'https://app/no',
      });

      expect(result.sessionId).toMatch(/^cs_\d{6}$/);
      expect(result.url).toBe(`https://billing.mock.docket.local/checkout/${result.sessionId}`);

      const sub = await gw.getSubscription('org_1');
      expect(sub).toMatchObject({ referenceId: 'org_1', status: 'trialing' });
      expect(sub?.trialEnd).toBe(sub?.currentPeriodEnd);

      expect(gw.events).toHaveLength(1);
      expect(gw.events[0]).toMatchObject({ type: 'checkout.completed', referenceId: 'org_1' });
    });

    it('honors a custom trial length', async () => {
      const gw = new InMemoryBillingGateway({ now: '2026-01-01T00:00:00.000Z' });
      await gw.createCheckoutSession({
        referenceId: 'org_2',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
        trialDays: 7,
      });
      const sub = await gw.getSubscription('org_2');
      expect(sub?.currentPeriodEnd).toBe('2026-01-08T00:00:00.000Z');
    });

    it('defaults the trial to 14 days when none is given', async () => {
      const gw = new InMemoryBillingGateway({ now: '2026-01-01T00:00:00.000Z' });
      await gw.createCheckoutSession({
        referenceId: 'org_3',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
      });
      const sub = await gw.getSubscription('org_3');
      expect(sub?.currentPeriodEnd).toBe('2026-01-15T00:00:00.000Z');
    });

    it('honors a custom base URL for synthetic links', async () => {
      const gw = new InMemoryBillingGateway({ baseUrl: 'https://mock.example.com' });
      const result = await gw.createCheckoutSession({
        referenceId: 'org_4',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
      });
      expect(result.url).toBe(`https://mock.example.com/checkout/${result.sessionId}`);
    });
  });

  describe('getSubscription', () => {
    it('returns null when no subscription exists for the scope', async () => {
      const gw = new InMemoryBillingGateway();
      expect(await gw.getSubscription('never_created')).toBeNull();
    });
  });

  describe('cancelSubscription', () => {
    it('cancels an existing subscription and emits a subscription.canceled event', async () => {
      const gw = new InMemoryBillingGateway({ now: '2026-01-01T00:00:00.000Z' });
      await gw.createCheckoutSession({
        referenceId: 'org_5',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
      });
      await gw.cancelSubscription('org_5');

      const sub = await gw.getSubscription('org_5');
      expect(sub).toMatchObject({
        referenceId: 'org_5',
        status: 'canceled',
        currentPeriodEnd: '2026-01-01T00:00:00.000Z',
      });
      expect(sub).not.toHaveProperty('trialEnd');

      const last = gw.events.at(-1);
      expect(last).toMatchObject({ type: 'subscription.canceled', referenceId: 'org_5' });
    });

    it('is a no-op for a scope with no subscription', async () => {
      const gw = new InMemoryBillingGateway();
      await gw.cancelSubscription('never_created');
      expect(gw.events).toHaveLength(0);
      expect(await gw.getSubscription('never_created')).toBeNull();
    });
  });

  describe('createBillingPortalSession', () => {
    it('returns a synthetic portal URL addressed by the reference id', async () => {
      const gw = new InMemoryBillingGateway({ baseUrl: 'https://mock.example.com' });
      const result = await gw.createBillingPortalSession('org_6');
      expect(result).toEqual({ url: 'https://mock.example.com/portal/org_6' });
    });
  });

  describe('advance', () => {
    it('steps a fresh scope through the full lifecycle in order, then returns null', () => {
      const gw = new InMemoryBillingGateway({ now: '2026-01-01T00:00:00.000Z' });

      const created = gw.advance('org_7');
      expect(created).toMatchObject({ type: 'subscription.created', referenceId: 'org_7' });
      expect(created?.subscription).toMatchObject({ status: 'trialing' });
      expect(created?.subscription?.trialEnd).toBe(created?.subscription?.currentPeriodEnd);

      const updated = gw.advance('org_7');
      expect(updated).toMatchObject({ type: 'subscription.updated' });
      expect(updated?.subscription).toMatchObject({ status: 'active' });
      expect(updated?.subscription?.id).toBe(created?.subscription?.id);
      expect(updated?.subscription).not.toHaveProperty('trialEnd');

      const pastDue = gw.advance('org_7');
      expect(pastDue).toMatchObject({ type: 'subscription.past_due' });
      expect(pastDue?.subscription).toMatchObject({ status: 'past_due' });

      const canceled = gw.advance('org_7');
      expect(canceled).toMatchObject({ type: 'subscription.canceled' });
      expect(canceled?.subscription).toMatchObject({ status: 'canceled' });

      expect(gw.advance('org_7')).toBeNull();
      expect(gw.events).toHaveLength(4);
    });

    it('creates a new subscription id when advancing a scope with no prior checkout', () => {
      const gw = new InMemoryBillingGateway();
      const event = gw.advance('org_8');
      expect(event?.subscription?.id).toMatch(/^sub_\d{6}$/);
    });
  });
});
