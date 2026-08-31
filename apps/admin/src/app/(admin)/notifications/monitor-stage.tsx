'use client';

import { Stack, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

/** Minimal delivery row shown in the monitor stage. */
export interface NotificationMonitorDelivery {
  /** Delivery id. */
  readonly id: string;
  /** Delivery channel. */
  readonly channel: string;
  /** Delivery status. */
  readonly status: string;
}

/** Minimal inbound event row shown in the monitor stage. */
export interface NotificationMonitorInboundEvent {
  /** Inbound event id. */
  readonly id: string;
  /** Event channel. */
  readonly channel: string;
  /** Event kind. */
  readonly kind: string;
}

/** Minimal operator audit row shown in the monitor stage. */
export interface NotificationMonitorAuditEvent {
  /** Audit event id. */
  readonly id: string;
  /** Audit event type. */
  readonly type: string;
}

/** Props for {@link MonitorStage}. */
export interface MonitorStageProps {
  /** What was delivered, and on which channel. */
  readonly deliveries: readonly NotificationMonitorDelivery[];
  /** What came back — replies, bounces, and other inbound events. */
  readonly inboundEvents: readonly NotificationMonitorInboundEvent[];
  /** What operators did to this announcement. */
  readonly auditEvents: readonly NotificationMonitorAuditEvent[];
}

/**
 * The last stage: what actually happened after sending.
 *
 * @remarks
 * Three separate answers — what went out, what came back, and what operators did — so each keeps
 * its own heading rather than being flattened into one undifferentiated list.
 *
 * @param props - See {@link MonitorStageProps}.
 * @returns the monitor stage.
 */
export function MonitorStage({
  deliveries,
  inboundEvents,
  auditEvents,
}: MonitorStageProps): JSX.Element {
  return (
    <div className="grid gap-6 @2xl:grid-cols-3">
      <EventColumn
        title="Deliveries"
        empty="Nothing delivered yet."
        items={deliveries.map((delivery) => ({
          id: delivery.id,
          text: `${delivery.channel} · ${delivery.status}`,
        }))}
      />
      <EventColumn
        title="Inbound"
        empty="Nothing has come back."
        items={inboundEvents.map((event) => ({
          id: event.id,
          text: `${event.channel} · ${event.kind}`,
        }))}
      />
      <EventColumn
        title="Operator actions"
        empty="No operator action recorded."
        items={auditEvents.map((event) => ({
          id: event.id,
          text: event.type.replaceAll('_', ' '),
        }))}
      />
    </div>
  );
}

/** One titled column of monitor rows. */
function EventColumn({
  title,
  empty,
  items,
}: {
  readonly title: string;
  readonly empty: string;
  readonly items: readonly { readonly id: string; readonly text: string }[];
}): JSX.Element {
  return (
    <Stack gap={2}>
      <Text as="h3" token="title-small">
        {title}
      </Text>
      {items.length === 0 ? (
        <Text as="p" token="body-small" tone="muted">
          {empty}
        </Text>
      ) : (
        <Stack gap={1} as="ul">
          {items.map((item) => (
            <li key={item.id}>
              <Text as="span" token="body-small" tone="muted">
                {item.text}
              </Text>
            </li>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
