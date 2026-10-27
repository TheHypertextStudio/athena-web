import { expect, it } from 'vitest';
import type { AgentTurnRuntime } from '@docket/athena/turn';
import { assessDailyPlan } from '../../../src/services/daily-plan-assessment';
import { meterTurnRuntime, type AiCallRecord } from '../../../src/services/usage-cost/direct-calls';

it('drains the assessment stream after the tool result so terminal usage is retained', async () => {
  const records: AiCallRecord[] = [];
  const runtime: AgentTurnRuntime = {
    async *streamTurn() {
      yield {
        type: 'tool_use',
        id: 'result',
        name: 'return_daily_plan_assessment',
        input: { assessment: null, suggestions: [] },
      };
      yield {
        type: 'turn_end',
        stopReason: 'tool_use',
        message: { role: 'assistant', content: [] },
        usage: {
          model: 'test',
          inputTokens: 7,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      };
    },
  };
  await assessDailyPlan(
    meterTurnRuntime(
      runtime,
      { source: 'daily_assessment', userId: 'person', organizationId: null },
      async (record) => {
        records.push(record);
      },
    ),
    {
      draft: {
        date: '2026-10-26',
        finishAt: '2026-10-27T00:00:00.000Z',
        mainTaskId: null,
        tasks: [],
        sessions: [],
      },
      tasks: [],
      events: [],
      actual: [],
      projects: [],
    },
    'revision',
  );
  expect(records).toEqual([
    expect.objectContaining({ source: 'daily_assessment', inputTokens: 7, outputTokens: 2 }),
  ]);
});
