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

  test('delivers a directly addressed recipient even when they are the actor', async () => {
    // A personal Athena run acts *as* its owner, so the ask would otherwise be self-excluded.
    const recipients = await resolveRecipients({} as never, {
      organizationId: 'org_1',
      kind: 'elicitation_requested',
      entity: null,
      directRecipients: new Map([['user_1', 'awaiting_you']]),
    });

    expect([...recipients]).toEqual([['user_1', 'awaiting_you']]);
  });

  test('lets a halt outrank an ordinary reason for the same user', async () => {
    const recipients = await resolveRecipients({} as never, {
      organizationId: 'org_1',
      kind: 'agent_blocked',
      entity: null,
      externalRecipients: new Map([['user_1', 'owned']]),
      directRecipients: new Map([['user_1', 'awaiting_you']]),
    });

    expect([...recipients]).toEqual([['user_1', 'awaiting_you']]);
  });

  test('keeps the stronger reason when a direct recipient is also relevant otherwise', async () => {
    const recipients = await resolveRecipients({} as never, {
      organizationId: 'org_1',
      kind: 'mention',
      entity: null,
      externalRecipients: new Map([['user_1', 'mention']]),
      directRecipients: new Map([['user_1', 'participant']]),
    });

    expect([...recipients]).toEqual([['user_1', 'mention']]);
  });

  test('routes a timer transition to the person tracking and to nobody else', async () => {
    const recipients = await resolveRecipients({} as never, {
      organizationId: 'org_1',
      kind: 'timer_started',
      // A tracked task with owners: they must NOT hear about someone else's stopwatch.
      entity: { kind: 'work_item', source: 'docket', externalId: 'task_1' },
      ownerUserId: 'integration_owner',
      externalRecipients: new Map([['user_2', 'owned']]),
      directRecipients: new Map([['user_1', 'owned']]),
    });

    expect([...recipients]).toEqual([['user_1', 'owned']]);
  });
});
