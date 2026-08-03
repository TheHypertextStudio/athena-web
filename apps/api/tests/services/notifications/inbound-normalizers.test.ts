/**
 * `@docket/api` — provider-payload normalization for inbound notification events.
 *
 * @remarks
 * `inbound.test.ts` proves the DB-integration path (recording + applying a delivery/contact-point
 * transition) for a representative event or two per channel. These are the pure normalizers
 * underneath it: every event-name spelling a provider actually sends (Resend's past-tense forms,
 * a generic gateway's present-tense forms), and the id/event-name fallback chains that make a
 * malformed or minimal payload still produce a storable, deduplicated event rather than a crash.
 */
import { describe, expect, it } from 'vitest';

import {
  normalizeEmailProviderPayload,
  normalizePushProviderPayload,
  normalizeSmsProviderPayload,
} from '../../../src/services/notifications/inbound';

describe('normalizeEmailProviderPayload', () => {
  it.each([
    ['delivered', 'delivered'],
    ['delivery', 'delivered'],
    ['bounce', 'bounced'],
    ['bounced', 'bounced'],
    ['complaint', 'complained'],
    ['complained', 'complained'],
    ['open', 'opened'],
    ['opened', 'opened'],
    ['click', 'clicked'],
    ['clicked', 'clicked'],
    ['reply', 'replied'],
    ['replied', 'replied'],
    ['unsubscribe', 'unsubscribed'],
    ['unsubscribed', 'unsubscribed'],
    ['something-unrecognized', 'action'],
  ])('maps event %s to kind %s', (event, kind) => {
    expect(normalizeEmailProviderPayload({ event }).kind).toBe(kind);
  });

  it('is case-insensitive on the event name', () => {
    expect(normalizeEmailProviderPayload({ event: 'BOUNCED' }).kind).toBe('bounced');
  });

  it('marks the contact point bounced on a bounce and unsubscribed on a complaint', () => {
    expect(normalizeEmailProviderPayload({ event: 'bounced' }).contactPointStatus).toBe('bounced');
    expect(normalizeEmailProviderPayload({ event: 'complained' }).contactPointStatus).toBe(
      'unsubscribed',
    );
    expect(
      normalizeEmailProviderPayload({ event: 'delivered' }).contactPointStatus,
    ).toBeUndefined();
  });

  it('falls back through type/eventType to "action" when no event name is present', () => {
    expect(normalizeEmailProviderPayload({ type: 'clicked' }).kind).toBe('clicked');
    expect(normalizeEmailProviderPayload({ eventType: 'opened' }).kind).toBe('opened');
    expect(normalizeEmailProviderPayload({}).kind).toBe('action');
  });

  it('falls back through providerEventId/eventId/id/messageId in order', () => {
    expect(normalizeEmailProviderPayload({ providerEventId: 'p1', id: 'i1' }).providerEventId).toBe(
      'p1',
    );
    expect(normalizeEmailProviderPayload({ eventId: 'e1', id: 'i1' }).providerEventId).toBe('e1');
    expect(normalizeEmailProviderPayload({ id: 'i1', messageId: 'm1' }).providerEventId).toBe('i1');
    expect(normalizeEmailProviderPayload({ messageId: 'm1' }).providerEventId).toBe('m1');
    expect(normalizeEmailProviderPayload({}).providerEventId).toBeUndefined();
  });

  it('reads the sender from "from", falling back to "recipient"', () => {
    expect(normalizeEmailProviderPayload({ from: 'a@example.test' }).from).toBe('a@example.test');
    expect(normalizeEmailProviderPayload({ recipient: 'b@example.test' }).from).toBe(
      'b@example.test',
    );
  });

  it('ignores blank or non-string field values', () => {
    expect(normalizeEmailProviderPayload({ event: '   ' }).kind).toBe('action');
    expect(normalizeEmailProviderPayload({ notificationId: 42 }).notificationId).toBeUndefined();
  });

  it('stamps the resolved event name back onto the stored payload', () => {
    expect(normalizeEmailProviderPayload({ event: 'Bounced' }).payload).toMatchObject({
      event: 'bounced',
    });
  });
});

describe('normalizeSmsProviderPayload', () => {
  it.each([
    ['stop', 'unsubscribed'],
    ['unsubscribed', 'unsubscribed'],
    ['replied', 'replied'],
    ['reply', 'replied'],
    ['delivered', 'action'],
  ])('maps event %s to kind %s', (event, kind) => {
    expect(normalizeSmsProviderPayload({ event }).kind).toBe(kind);
  });

  it('marks the contact point unsubscribed on stop and active on start', () => {
    expect(normalizeSmsProviderPayload({ event: 'stop' }).contactPointStatus).toBe('unsubscribed');
    expect(normalizeSmsProviderPayload({ event: 'start' }).contactPointStatus).toBe('active');
    expect(normalizeSmsProviderPayload({ event: 'delivered' }).contactPointStatus).toBeUndefined();
  });

  it.each(['failed', 'undelivered'])('marks the delivery failed on %s', (event) => {
    expect(normalizeSmsProviderPayload({ event }).deliveryStatus).toBe('failed');
  });

  it('does not mark the delivery failed on an ordinary event', () => {
    expect(normalizeSmsProviderPayload({ event: 'delivered' }).deliveryStatus).toBeUndefined();
  });

  it('reads the sender from "from"', () => {
    expect(normalizeSmsProviderPayload({ from: '+15550001111' }).from).toBe('+15550001111');
  });
});

describe('normalizePushProviderPayload', () => {
  it('maps a delivered event to kind delivered, and anything else to action', () => {
    expect(normalizePushProviderPayload({ event: 'delivered' }).kind).toBe('delivered');
    expect(normalizePushProviderPayload({ event: 'clicked' }).kind).toBe('action');
  });

  it.each(['invalid_token', 'failed'])(
    'marks the delivery failed and the contact point disabled on %s',
    (event) => {
      const normalized = normalizePushProviderPayload({ event });
      expect(normalized.deliveryStatus).toBe('failed');
      expect(normalized.contactPointStatus).toBe('disabled');
    },
  );

  it('does not mark failure on an ordinary event', () => {
    const normalized = normalizePushProviderPayload({ event: 'delivered' });
    expect(normalized.deliveryStatus).toBeUndefined();
    expect(normalized.contactPointStatus).toBeUndefined();
  });

  it('carries no "from" field (push has no sender address)', () => {
    expect(normalizePushProviderPayload({ event: 'delivered' }).from).toBeUndefined();
  });
});
