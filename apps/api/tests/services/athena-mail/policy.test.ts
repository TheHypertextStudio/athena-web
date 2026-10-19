import { describe, expect, it } from 'vitest';
import {
  ownerMailEligible,
  automaticMail,
  outboundRetryAllowed,
} from '../../../src/services/athena-mail/policy';

describe('Athena email channel boundaries', () => {
  it.each(['fail', 'none', 'temperror'])(
    'keeps owner mail captured when DKIM reports %s despite DMARC passing',
    (dkim) => {
      expect(
        ownerMailEligible('me@example.com', 'me@example.com', {
          spf: 'pass',
          dkim,
          dmarc: 'pass',
        }),
      ).toBe(false);
    },
  );
  it('requires exact enrolled sender and trusted DMARC success', () => {
    expect(
      ownerMailEligible('me@example.com', 'me@example.com', {
        spf: 'pass',
        dkim: 'pass',
        dmarc: 'pass',
      }),
    ).toBe(true);
    expect(
      ownerMailEligible('other@example.com', 'me@example.com', {
        spf: 'pass',
        dkim: 'pass',
        dmarc: 'pass',
      }),
    ).toBe(false);
    expect(ownerMailEligible('me@example.com', 'me@example.com', undefined)).toBe(false);
    expect(
      ownerMailEligible('me@example.com', 'me@example.com', {
        spf: 'pass',
        dkim: 'pass',
        dmarc: 'none',
      }),
    ).toBe(false);
  });
  it('suppresses automatic mail and never treats arbitrary reply-to as identity', () => {
    expect(automaticMail({ 'auto-submitted': 'auto-replied' })).toBe(true);
    expect(automaticMail({ 'content-type': 'multipart/report; report-type=delivery-status' })).toBe(
      true,
    );
    expect(automaticMail({ 'reply-to': 'evil@example.com' })).toBe(false);
  });
  it('stops ambiguous retries before provider idempotency expires', () => {
    expect(outboundRetryAllowed(new Date(0), new Date(23 * 3600_000))).toBe(true);
    expect(outboundRetryAllowed(new Date(0), new Date(24 * 3600_000))).toBe(false);
  });
});

describe('bounded email context', () => {
  it('limits references and preserves only the fresh owner answer', async () => {
    const { mailReferences } = await import('../../../src/services/athena-mail/policy');
    const { ownerReplyText } = await import('../../../src/services/athena-mail/continuation');
    expect(
      mailReferences({
        references: Array.from({ length: 100 }, (_, i) => `<msg-${i}@example.com>`).join(' '),
      }),
    ).toHaveLength(20);
    expect(ownerReplyText('The downtown venue.\nOn Friday, Athena wrote:\nWhich venue?')).toBe(
      'The downtown venue.',
    );
  });
});
