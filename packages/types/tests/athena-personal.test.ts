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

  it('requires application-owned display metadata on personal work summaries', async () => {
    const types = await import('../src/index');
    const schema = Reflect.get(types, 'AthenaSessionSummaryOut') as
      | { safeParse(value: unknown): { success: boolean } }
      | undefined;
    const summary = {
      id: ID,
      kind: 'job',
      status: 'running',
      queueState: 'working',
      objective: 'Prepare the launch plan',
      context: {
        workspaceId: ID,
        source: { type: 'project', id: ID, label: 'Athena launch' },
      },
      workspace: { id: ID, name: 'Hypertext Studio' },
      startedAt: null,
      endedAt: null,
      createdAt: '2026-07-16T12:00:00.000Z',
    };

    expect(schema?.safeParse(summary).success).toBe(true);
    expect(
      schema?.safeParse({
        ...summary,
        context: { workspaceId: ID, source: { type: 'project', id: ID } },
      }).success,
    ).toBe(false);
    expect(schema?.safeParse({ ...summary, workspace: undefined }).success).toBe(false);
  });

  it('defines a compact pulse that cannot carry personal session history', async () => {
    const types = await import('../src/index');
    const schema = Reflect.get(types, 'AthenaPulseOut') as
      | { safeParse(value: unknown): { success: boolean } }
      | undefined;

    expect(schema).toBeDefined();
    expect(schema?.safeParse({ needsYou: 2, working: 3 }).success).toBe(true);
    expect(
      schema?.safeParse({ needsYou: 2, working: 3, sessions: [{ id: 'private-history' }] }).success,
    ).toBe(false);
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
