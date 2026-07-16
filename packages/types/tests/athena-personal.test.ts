import { describe, expect, it } from 'vitest';

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
