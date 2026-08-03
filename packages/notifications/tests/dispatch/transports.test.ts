import type { Mailer } from '@docket/mail';
import type { PushSender, SmsSender } from '@docket/integrations';
import { describe, expect, it } from 'vitest';

import {
  configureNotificationTransports,
  defaultMailer,
  defaultPushSender,
  defaultSmsSender,
} from '../../src/dispatch/transports';

describe('notification transports', () => {
  it('throws a clear error for each accessor before transports are configured', () => {
    expect(() => defaultMailer()).toThrow(
      /Notification transports were never configured \(no mailer\)/,
    );
    expect(() => defaultSmsSender()).toThrow(
      /Notification transports were never configured \(no SMS sender\)/,
    );
    expect(() => defaultPushSender()).toThrow(
      /Notification transports were never configured \(no push sender\)/,
    );
  });

  it('returns the configured transports once registered', () => {
    const mailer: Mailer = { send: async () => undefined };
    const sms: SmsSender = {
      send: async () => ({ id: 'sms_1', to: 'x', body: 'b', sentAt: 'now' }),
    };
    const push: PushSender = {
      send: async () => ({ id: 'push_1', token: 't', title: 'T', sentAt: 'now' }),
    };

    configureNotificationTransports({
      mailer: () => mailer,
      sms: () => sms,
      push: () => push,
    });

    expect(defaultMailer()).toBe(mailer);
    expect(defaultSmsSender()).toBe(sms);
    expect(defaultPushSender()).toBe(push);
  });
});
