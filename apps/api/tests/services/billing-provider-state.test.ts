import { InMemoryBillingGateway } from '@docket/billing/adapters/in-memory';
import type { Subscription } from '@docket/billing/contracts';
import { describe, expect, it } from 'vitest';

import { loadSingleCurrentSubscription } from '../../src/services/billing-provider-state';

describe('loadSingleCurrentSubscription', () => {
  it('refuses an ambiguous provider state before a finance action can mutate it', async () => {
    const subscriptions: readonly Subscription[] = [
      {
        id: 'sub_first',
        customerId: 'cus_org_1',
        referenceId: 'org_1',
        status: 'active',
        currentPeriodEnd: '2026-09-25T00:00:00.000Z',
      },
      {
        id: 'sub_second',
        customerId: 'cus_org_1',
        referenceId: 'org_1',
        status: 'past_due',
        currentPeriodEnd: '2026-09-25T00:00:00.000Z',
      },
    ];
    class DuplicateGateway extends InMemoryBillingGateway {
      override async listSubscriptions(): Promise<readonly Subscription[]> {
        return subscriptions;
      }
    }

    await expect(
      loadSingleCurrentSubscription(new DuplicateGateway(), 'org_1'),
    ).rejects.toMatchObject({
      status: 409,
      code: 'billing_provider_sync_failed',
    });
  });

  it('ignores canceled history and returns the one current subscription', async () => {
    const current: Subscription = {
      id: 'sub_current',
      customerId: 'cus_org_1',
      referenceId: 'org_1',
      status: 'active',
      currentPeriodEnd: '2026-09-25T00:00:00.000Z',
    };
    class HistoryGateway extends InMemoryBillingGateway {
      override async listSubscriptions(): Promise<readonly Subscription[]> {
        return [
          {
            ...current,
            id: 'sub_old',
            status: 'canceled',
          },
          current,
        ];
      }
    }

    await expect(loadSingleCurrentSubscription(new HistoryGateway(), 'org_1')).resolves.toEqual(
      current,
    );
  });
});
