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

describe('classifyTaskWorthiness with routing cues from the person’s own rules', () => {
  /** The headline case: an opportunity worded exactly the way promotional mail is worded. */
  const OPPORTUNITY = {
    subject: 'Limited-time LVBT opportunity: spring showcase sponsor slot',
    snippet: 'We can hold the LVBT sponsor slot for a limited time. Unsubscribe any time.',
    sender: 'Showcase Partnerships <partnerships@showcase.example>',
  };

  it('keeps promotional-sounding mail a routing rule names, unfloored and untagged', () => {
    const verdict = classifyTaskWorthiness(OPPORTUNITY, 50, [{ field: 'content', value: 'lvbt' }]);
    expect(verdict.worthy).toBe(true);
    expect(verdict.score).toBeGreaterThanOrEqual(70);
    // Not tagged, or the shipped dismiss-promotions rule would throw away what routing just kept.
    expect(verdict.category).toBeUndefined();
  });

  it('drops the same mail when the cues name something else', () => {
    const verdict = classifyTaskWorthiness(OPPORTUNITY, 50, [
      { field: 'content', value: 'quarterly board pack' },
    ]);
    expect(verdict.worthy).toBe(false);
    expect(verdict.category).toBe('promotions');
  });

  it('matches a cue on the sender as well as on the wording', () => {
    const bySender = classifyTaskWorthiness(OPPORTUNITY, 50, [
      { field: 'sender', value: 'partnerships@showcase.example' },
    ]);
    expect(bySender.worthy).toBe(true);
    // A sender cue is about the sender: the same literal as a content cue matches nothing here.
    const asContent = classifyTaskWorthiness(OPPORTUNITY, 50, [
      { field: 'content', value: 'partnerships@showcase.example' },
    ]);
    expect(asContent.worthy).toBe(false);
  });

  it('matches case-insensitively, so a rule written in caps still rescues its mail', () => {
    expect(
      classifyTaskWorthiness(
        { subject: 'lvbt slot — limited time', snippet: 'unsubscribe', sender: 'x@y.test' },
        50,
        [{ field: 'content', value: 'lvbt' }],
      ).worthy,
    ).toBe(true);
  });

  it('passes a named thread whatever the threshold, because the person already decided', () => {
    const strict = classifyTaskWorthiness(
      { ...OPPORTUNITY, sender: 'no-reply@showcase.example' },
      100,
      [{ field: 'content', value: 'lvbt' }],
    );
    expect(strict.worthy).toBe(true);
  });

  it('leaves non-promotional mail scored exactly as before', () => {
    const signal = { subject: 'Notes from today', snippet: 'fyi', sender: 'colleague@x.com' };
    expect(classifyTaskWorthiness(signal, 50, [{ field: 'content', value: 'invoice' }])).toEqual(
      classifyTaskWorthiness(signal, 50),
    );
  });
});
