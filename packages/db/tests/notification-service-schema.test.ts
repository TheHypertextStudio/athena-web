import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  contactPoint,
  contactPointStatus,
  contactPointType,
  notification,
  notificationCategory,
  notificationChannel,
  notificationDelivery,
  notificationDeliveryStatus,
  notificationDestinationType,
  notificationInboundEvent,
  notificationInboundEventKind,
  notificationIntent,
  notificationIntentStatus,
  notificationPreference,
  notificationPriority,
  notificationRecipient,
  notificationRecipientReason,
  notificationReplyPolicy,
  notificationSenderType,
  notificationSuppressionReason,
} from '../src/schema';
import {
  notificationServiceColumnFixtures,
  notificationServiceEnumFixtures,
  notificationServiceJsonShapeFixtures,
} from './fixtures/notification-service';

function columnNames(table: PgTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function columnFixture(values: readonly string[]): string[] {
  return [...values];
}

describe('notification service schema', () => {
  it('declares the notification service enum literals', () => {
    expect(notificationSenderType.enumValues).toEqual(notificationServiceEnumFixtures.senderTypes);
    expect(notificationCategory.enumValues).toEqual(notificationServiceEnumFixtures.categories);
    expect(notificationPriority.enumValues).toEqual(notificationServiceEnumFixtures.priorities);
    expect(notificationChannel.enumValues).toEqual(notificationServiceEnumFixtures.channels);
    expect(notificationIntentStatus.enumValues).toEqual(
      notificationServiceEnumFixtures.intentStatuses,
    );
    expect(notificationReplyPolicy.enumValues).toEqual(
      notificationServiceEnumFixtures.replyPolicies,
    );
    expect(notificationRecipientReason.enumValues).toEqual(
      notificationServiceEnumFixtures.recipientReasons,
    );
    expect(notificationSuppressionReason.enumValues).toContain('quiet_hours');
    expect(notificationDestinationType.enumValues).toEqual(
      notificationServiceEnumFixtures.destinationTypes,
    );
    expect(notificationDeliveryStatus.enumValues).toEqual(
      notificationServiceEnumFixtures.deliveryStatuses,
    );
    expect(contactPointType.enumValues).toEqual(notificationServiceEnumFixtures.contactPointTypes);
    expect(contactPointStatus.enumValues).toEqual(
      notificationServiceEnumFixtures.contactPointStatuses,
    );
    expect(notificationInboundEventKind.enumValues).toEqual(
      notificationServiceEnumFixtures.inboundEventKinds,
    );
  });

  it('declares durable intent, recipient, delivery, preference, contact point, and inbound tables', () => {
    expect(columnNames(notificationIntent)).toEqual(
      expect.arrayContaining(columnFixture(notificationServiceColumnFixtures.intent)),
    );
    expect(columnNames(notificationRecipient)).toEqual(
      expect.arrayContaining(columnFixture(notificationServiceColumnFixtures.recipient)),
    );
    expect(columnNames(notificationDelivery)).toEqual(
      expect.arrayContaining(columnFixture(notificationServiceColumnFixtures.delivery)),
    );
    expect(columnNames(notificationPreference)).toEqual(
      expect.arrayContaining(columnFixture(notificationServiceColumnFixtures.preference)),
    );
    expect(columnNames(contactPoint)).toEqual(
      expect.arrayContaining(columnFixture(notificationServiceColumnFixtures.contactPoint)),
    );
    expect(columnNames(notificationInboundEvent)).toEqual(
      expect.arrayContaining(columnFixture(notificationServiceColumnFixtures.inboundEvent)),
    );
  });

  it('links the existing web inbox projection back to notification service rows', () => {
    expect(columnNames(notification)).toEqual(
      expect.arrayContaining(columnFixture(notificationServiceColumnFixtures.inboxProjectionLinks)),
    );
  });

  it('exports typed JSON shapes for notification service jsonb columns', () => {
    expect(Object.values(notificationServiceJsonShapeFixtures)).toHaveLength(6);
  });
});
