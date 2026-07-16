import { describe, expect, it } from 'vitest';

import {
  AthenaAssignmentCreate,
  AthenaTriggerCreate,
  PersonalMcpConnectionCreate,
  PersonalMcpConnectionUpdate,
} from '../src/athena';

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('personal Athena API contracts', () => {
  it('defines invocation context without accepting an owner id', async () => {
    const types = await import('../src/index');
    const schema = Reflect.get(types, 'AthenaSessionCreateBody') as
      | { safeParse(value: unknown): { success: boolean } }
      | undefined;

    expect(schema).toBeDefined();
    expect(
      schema?.safeParse({
        prompt: 'Prepare the launch plan',
        context: {
          workspaceId: '01H00000000000000000000000',
          source: { type: 'project', id: 'project_1' },
        },
      }).success,
    ).toBe(true);
    expect(schema?.safeParse({ prompt: 'Prepare it', ownerUserId: 'user_other' }).success).toBe(
      false,
    );
  });

  it('groups personal work into product queue states', async () => {
    const types = await import('../src/index');
    const schema = Reflect.get(types, 'AthenaOverviewOut') as
      | { safeParse(value: unknown): { success: boolean } }
      | undefined;

    expect(schema).toBeDefined();
    expect(
      schema?.safeParse({
        counts: { needsYou: 1, working: 2, finished: 3 },
        currentChat: null,
        sessions: { needsYou: [], working: [], finished: [] },
      }).success,
    ).toBe(true);
  });
});

describe('personal Athena contracts', () => {
  it('keeps the discovered connection name visible and editable', () => {
    const created = PersonalMcpConnectionCreate.parse({
      url: 'https://mcp.sunsama.com/mcp',
      name: 'Sunsama',
      alias: 'sunsama',
      authMode: 'none',
    });
    expect(created.name).toBe('Sunsama');
    expect(PersonalMcpConnectionUpdate.parse({ name: 'Planning' })).toEqual({
      name: 'Planning',
    });
    expect(
      PersonalMcpConnectionCreate.safeParse({
        url: 'https://mcp.sunsama.com/mcp',
        alias: 'sunsama',
        authMode: 'none',
      }).success,
    ).toBe(false);
  });

  it('accepts initiative, project, and task assignment targets', () => {
    for (const entityType of ['initiative', 'project', 'task'] as const) {
      expect(
        AthenaAssignmentCreate.parse({
          organizationId: ID,
          entityType,
          entityId: ID,
          objective: 'Keep this work moving.',
        }).entityType,
      ).toBe(entityType);
    }
  });

  it('requires scheduled triggers to run no faster than every five minutes', () => {
    expect(AthenaTriggerCreate.safeParse({ type: 'scheduled', scheduleMinutes: 4 }).success).toBe(
      false,
    );
    expect(AthenaTriggerCreate.parse({ type: 'scheduled', scheduleMinutes: 5 })).toMatchObject({
      type: 'scheduled',
      scheduleMinutes: 5,
      cooldownMinutes: 5,
    });
    expect(
      AthenaTriggerCreate.parse({ type: 'event', eventKinds: ['status_change'] }),
    ).toMatchObject({ type: 'event', cooldownMinutes: 5 });
  });
});
