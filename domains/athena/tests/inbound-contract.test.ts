import { describe, expect, it } from 'vitest';
import {
  PersonalInboundBatchIn,
  PlatformNotificationRemoved,
  NotificationTriageSettingsIn,
} from '../src/contracts/inbound';
const id = '01K00000000000000000000000';
const removed = {
  id,
  type: 'platform.notification.removed',
  occurredAt: 2,
  payload: { id, notificationId: id, removedAt: 2, reason: 'dismissed' },
};
describe('personal inbound contract', () => {
  it('validates typed payloads and rejects conflicting envelope identity or occurrence time', () => {
    expect(PlatformNotificationRemoved.safeParse(removed).success).toBe(true);
    expect(PlatformNotificationRemoved.safeParse({ ...removed, occurredAt: 3 }).success).toBe(
      false,
    );
    expect(
      PlatformNotificationRemoved.safeParse({ ...removed, id: '01K00000000000000000000001' })
        .success,
    ).toBe(false);
  });
  it('accepts invalid siblings for explicit receipts while bounding envelope and family counts', () => {
    const batch = {
      schemaVersion: 1,
      sourceId: id,
      events: [removed, { id, type: 'future.event', payload: {} }],
    };
    expect(PersonalInboundBatchIn.safeParse(batch).success).toBe(true);
    expect(PersonalInboundBatchIn.safeParse({ ...batch, schemaVersion: 2 }).success).toBe(false);
    expect(
      PersonalInboundBatchIn.safeParse({
        ...batch,
        events: Array.from({ length: 201 }, () => removed),
      }).success,
    ).toBe(false);
    expect(PersonalInboundBatchIn.safeParse({ ...batch, events: [{}] }).success).toBe(false);
  });
  it('does not accept a caller-supplied consent timestamp', () => {
    expect(NotificationTriageSettingsIn.safeParse({ enabled: true, enabledAt: 0 }).success).toBe(
      false,
    );
  });
});
