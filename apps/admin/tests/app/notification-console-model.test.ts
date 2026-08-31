import { describe, expect, it } from 'vitest';

import {
  type NotificationAnnouncementDraft,
  notificationDraftToCreateInput,
} from '../../src/app/(admin)/notifications/notification-console-model';

/** A complete draft; each test overrides only the fields whose behavior it exercises. */
function draft(
  overrides: Partial<NotificationAnnouncementDraft> = {},
): NotificationAnnouncementDraft {
  return {
    subject: 'Scheduled maintenance tonight',
    bodyText: 'Docket will be briefly unavailable tonight.',
    audienceType: 'user',
    audienceValue: 'user_1',
    channels: ['web'],
    priority: 'normal',
    replyPolicy: 'none',
    scheduledAt: '',
    ...overrides,
  };
}

describe('notificationDraftToCreateInput audience selection', () => {
  it('sends to every user without carrying a selector value', () => {
    expect(
      notificationDraftToCreateInput(draft({ audienceType: 'all_users', audienceValue: 'ignored' }))
        .audience,
    ).toEqual({ type: 'all_users' });
  });

  it('keeps a recognized segment key', () => {
    expect(
      notificationDraftToCreateInput(
        draft({ audienceType: 'segment', audienceValue: '  billing_admins  ' }),
      ).audience,
    ).toEqual({ type: 'segment', segment: 'billing_admins' });
  });

  it('falls back to the narrowest segment when the key is unrecognized', () => {
    // An unknown key must never widen the blast radius of a broadcast that cannot be recalled.
    expect(
      notificationDraftToCreateInput(
        draft({ audienceType: 'segment', audienceValue: 'everyone_everywhere' }),
      ).audience,
    ).toEqual({ type: 'segment', segment: 'active_users' });
  });

  it('trims a single recipient id', () => {
    expect(
      notificationDraftToCreateInput(draft({ audienceType: 'user', audienceValue: '  user_9  ' }))
        .audience,
    ).toEqual({ type: 'user', userId: 'user_9' });
  });

  it('discards empty entries from a comma-separated recipient list', () => {
    expect(
      notificationDraftToCreateInput(
        draft({ audienceType: 'users', audienceValue: 'user_1, ,user_2,' }),
      ).audience,
    ).toEqual({ type: 'users', userIds: ['user_1', 'user_2'] });
  });
});

describe('notificationDraftToCreateInput scheduling', () => {
  it('omits the send time entirely when none was chosen', () => {
    expect(notificationDraftToCreateInput(draft({ scheduledAt: '   ' }))).not.toHaveProperty(
      'scheduledAt',
    );
  });

  it('reads a seconds-bearing datetime-local value as UTC', () => {
    expect(
      notificationDraftToCreateInput(draft({ scheduledAt: '2026-07-08T05:00:30' })).scheduledAt,
    ).toBe('2026-07-08T05:00:30.000Z');
  });

  it('trims the subject and body that every channel preview shares', () => {
    const input = notificationDraftToCreateInput(
      draft({ subject: '  Maintenance  ', bodyText: '  Back shortly.  ' }),
    );

    expect(input.subject).toBe('Maintenance');
    expect(input.body).toEqual({ text: 'Back shortly.' });
  });
});
