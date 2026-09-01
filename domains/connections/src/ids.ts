import { z } from 'zod';

const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ownedId = z.string().regex(ulid);

/** External integration identifier. */
export const IntegrationId = ownedId
  .brand<'IntegrationId'>()
  .describe(
    'ULID id of an Integration — a connected external provider/account (calendar, source control, etc.).',
  );
/** External integration identifier value. */
export type IntegrationId = z.infer<typeof IntegrationId>;
/** External resource identifier. */
export const ExternalResourceId = ownedId
  .brand<'ExternalResourceId'>()
  .describe(
    'ULID id of an ExternalResource — one deduped resource outside Docket that someone has referenced.',
  );
/** External resource identifier value. */
export type ExternalResourceId = z.infer<typeof ExternalResourceId>;
/** Canonical event identifier. */
export const EventId = ownedId
  .brand<'EventId'>()
  .describe(
    'ULID id of an Event — a row in the canonical cross-tool activity log (internal or external).',
  );
/** Canonical event identifier value. */
export type EventId = z.infer<typeof EventId>;
/** Inbound provider event identifier. */
export const InboundEventId = ownedId
  .brand<'InboundEventId'>()
  .describe(
    'ULID id of an InboundEvent — a row in the durable write-ahead ingestion inbox (a received external event awaiting processing).',
  );
/** Inbound provider event identifier value. */
export type InboundEventId = z.infer<typeof InboundEventId>;
/** Event subscription identifier. */
export const EventSubscriptionId = ownedId
  .brand<'EventSubscriptionId'>()
  .describe('ULID id of an EventSubscription — an external webhook/push-channel registration.');
/** Event subscription identifier value. */
export type EventSubscriptionId = z.infer<typeof EventSubscriptionId>;
/** Audit event identifier. */
export const AuditEventId = ownedId
  .brand<'AuditEventId'>()
  .describe('ULID id of an AuditEvent — a tenant-scoped record of a sensitive action.');
/** Audit event identifier value. */
export type AuditEventId = z.infer<typeof AuditEventId>;
