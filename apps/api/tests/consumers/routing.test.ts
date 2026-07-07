import { describe, expect, test } from 'vitest';

import { resolveRecipients } from '../../src/consumers/routing';

describe('resolveRecipients', () => {
  test('routes pre-resolved external recipients through one strongest-reason input', async () => {
    const recipients = await resolveRecipients({} as never, {
      organizationId: 'org_1',
      kind: 'comment',
      entity: null,
      externalRecipients: new Map([
        ['user_1', 'participant'],
        ['user_2', 'mention'],
      ]),
    });

    expect([...recipients]).toEqual([
      ['user_1', 'participant'],
      ['user_2', 'mention'],
    ]);
  });
});
