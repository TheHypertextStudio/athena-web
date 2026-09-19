import { describe, expect, it } from 'vitest';

import { presentAthenaActivity } from '../../src/lib/athena/presentation';

describe('personal Athena presentation', () => {
  it('removes model reasoning and titles a non-Docket tool activity with the service plus outcome as detail', () => {
    const visible = [
      presentAthenaActivity({
        id: 'tool_1',
        type: 'tool',
        createdAt: '2026-07-15T16:02:00.000Z',
        service: 'Sunsama',
        action: 'Protected focus time',
        outcome: 'Added 2 blocks to Thursday',
        // Not a recognized tool shape (only `update_task`/`create_task` are), so the title falls
        // back to the reported action rather than a field-to-words sentence.
        technical: { toolName: 'sunsama_create_task', input: { duration: 120 } },
      }),
      presentAthenaActivity({
        id: 'reasoning_1',
        type: 'reasoning',
        createdAt: '2026-07-15T16:01:00.000Z',
        text: 'Private chain of thought',
      }),
    ].filter((entry) => entry !== null);

    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      kind: 'tool',
      title: 'Protected focus time',
      detail: 'Sunsama · Added 2 blocks to Thursday',
      technical: { toolName: 'sunsama_create_task' },
    });
    expect(JSON.stringify(visible)).not.toContain('Private chain of thought');
  });

  it('titles a recognized Docket tool call with what changed, and drops the service from its detail', () => {
    const presented = presentAthenaActivity({
      id: 'tool_2',
      type: 'tool',
      createdAt: '2026-07-15T16:03:00.000Z',
      service: 'Docket',
      action: 'update task',
      outcome: 'Task moved to In Progress',
      technical: { toolName: 'update_task', input: { state: 'in_progress' } },
    });

    expect(presented).toMatchObject({
      kind: 'tool',
      title: 'Set state to In Progress',
      detail: 'Task moved to In Progress',
    });
  });

  it('falls back to the humanised action when a Docket tool call carries no recognized fields', () => {
    const presented = presentAthenaActivity({
      id: 'tool_3',
      type: 'tool',
      createdAt: '2026-07-15T16:04:00.000Z',
      service: 'Docket',
      action: 'update task',
      technical: { toolName: 'update_task', input: { taskId: 'task_1' } },
    });

    expect(presented).toMatchObject({ kind: 'tool', title: 'Update task' });
    expect(presented).not.toHaveProperty('detail');
  });

  it('titles a user message as what they asked, not that they steered the work', () => {
    const presented = presentAthenaActivity({
      id: 'message_1',
      type: 'message',
      createdAt: '2026-07-15T16:00:00.000Z',
      text: 'Protect two hours on Thursday for the launch review',
      author: 'user',
    });

    expect(presented).toMatchObject({
      title: 'You asked',
      detail: 'Protect two hours on Thursday for the launch review',
    });
  });
});
