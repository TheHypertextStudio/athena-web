import { describe, expect, it } from 'vitest';

import { classifyTaskWorthiness } from '../../../src/lib/email-to-task/funnel';

describe('classifyTaskWorthiness', () => {
  it('scores an actionable, questioning thread above a neutral one', () => {
    const action = classifyTaskWorthiness(
      {
        subject: 'Can you confirm the interview slot?',
        snippet: 'Please reply by Friday',
        sender: 'recruiter@google.com',
      },
      50,
    );
    expect(action.worthy).toBe(true);
    expect(action.score).toBeGreaterThanOrEqual(50);
  });

  it('tags promotional mail and floors its score', () => {
    const promo = classifyTaskWorthiness(
      {
        subject: '50% off — limited time sale!',
        snippet: 'Click to unsubscribe',
        sender: 'deals@shop.com',
      },
      50,
    );
    expect(promo.category).toBe('promotions');
    expect(promo.worthy).toBe(false);
  });

  it('penalizes no-reply senders', () => {
    const noreply = classifyTaskWorthiness(
      {
        subject: 'Your weekly summary',
        snippet: 'Here is your activity',
        sender: 'no-reply@service.com',
      },
      50,
    );
    expect(noreply.worthy).toBe(false);
  });

  it('honors the supplied threshold (config, not a literal)', () => {
    const signal = { subject: 'Notes from today', snippet: 'fyi', sender: 'colleague@x.com' };
    expect(classifyTaskWorthiness(signal, 90).worthy).toBe(false);
    expect(classifyTaskWorthiness(signal, 10).worthy).toBe(true);
  });
});
