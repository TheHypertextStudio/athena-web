/**
 * `services/notifications/admin-service` — `estimate()` suppression-aggregation branches.
 *
 * @remarks
 * The real `resolveNotificationPreferences` always stamps a suppression's own `channel` to match
 * the decision it came from, and `estimate()`'s suppression sort never runs on fewer than two
 * entries — so neither the `suppression.channel ?? decision.channel` fallback nor the
 * multi-suppression sort is reachable through any real preference/contact-point setup. This file
 * mocks `@docket/notifications/dispatch` at module scope (hoisted, like
 * `tests/routes/me-athena-async.test.ts` does for the async runner) to hand `estimate()` decisions
 * it would never otherwise see, and asserts on its own aggregation logic as a black box.
 */
import type * as DbModule from '@docket/db';
import type { NotificationAudienceEstimateOut } from '@docket/notifications/schemas';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type * as DispatchModule from '@docket/notifications/dispatch';

vi.mock('@docket/notifications/dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof DispatchModule>();
  return {
    ...actual,
    expandNotificationAudience: vi.fn().mockResolvedValue([
      { userId: 'estimate-user-1', organizationId: null, reason: 'explicit' },
      { userId: 'estimate-user-2', organizationId: null, reason: 'explicit' },
    ]),
    resolveNotificationPreferences: vi
      .fn()
      .mockImplementation(async (_db: unknown, input: { userId: string }) => {
        if (input.userId === 'estimate-user-1') {
          return [
            {
              channel: 'sms',
              decision: 'suppress',
              destination: null,
              // No `channel` on the suppression itself: exercises the
              // `suppression.channel ?? decision.channel` fallback.
              suppression: { reason: 'quiet_hours' },
            },
            { channel: 'push', decision: 'send', destination: { type: 'push' } },
          ];
        }
        return [
          {
            channel: 'email',
            decision: 'suppress',
            destination: null,
            suppression: { reason: 'quiet_hours', channel: 'email' },
          },
        ];
      }),
  };
});

import { AdminNotificationService } from '../../../src/services/notifications/admin-service';
import { NotificationIntentService } from '../../../src/services/notifications/intent-service';
import { getDb, one, seedStaffUser, seedUserWithHub } from '../../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

function service(): AdminNotificationService {
  return new AdminNotificationService(db, new NotificationIntentService(db));
}

describe('estimate() — suppression aggregation', () => {
  it('falls back to the decision channel and sorts multiple suppressions by channel', async () => {
    const staff = await seedStaffUser(db, schema);
    const recipientUserId = await seedUserWithHub(db, schema, 'EstimateRecipient');
    const intent = one(
      await db
        .insert(schema.notificationIntent)
        .values({
          senderType: 'staff',
          category: 'service_announcement',
          priority: 'normal',
          audience: { type: 'user', userId: recipientUserId },
          channels: ['sms', 'push', 'email'],
          subject: 'Estimate with two suppressed channels',
          body: { text: 'Body' },
          replyPolicy: 'none',
          status: 'draft',
          createdBy: staff.userId,
        })
        .returning({ id: schema.notificationIntent.id }),
    );

    const estimate: z.input<typeof NotificationAudienceEstimateOut> = await service().estimate(
      staff.userId,
      intent.id,
    );

    expect(estimate.recipientCount).toBe(2);
    expect(estimate.channelCounts.sms).toEqual({ send: 0, delay: 0, suppress: 1 });
    expect(estimate.channelCounts.push).toEqual({ send: 1, delay: 0, suppress: 0 });
    expect(estimate.channelCounts.email).toEqual({ send: 0, delay: 0, suppress: 1 });
    // Sorted by channel: 'email' before 'sms'. The 'sms' entry proves the fallback resolved to
    // the decision's own channel even though its suppression object omitted one.
    expect(estimate.suppressions).toEqual([
      { channel: 'email', reason: 'quiet_hours', count: 1 },
      { channel: 'sms', reason: 'quiet_hours', count: 1 },
    ]);
  });
});
