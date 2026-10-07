import { describe, expect, it } from 'vitest';
import {
  MockAgentTurnRuntime,
  type AgentTurnRuntime,
  type TurnEvent,
  type TurnInput,
} from '@docket/athena/turn';
import { assessDailyPlan } from '../../src/services/daily-plan-assessment';

const context = {
  draft: {
    date: '2026-10-06',
    finishAt: '2026-10-07T00:00:00.000Z',
    mainTaskId: null,
    tasks: [],
    sessions: [],
  },
  tasks: [],
  events: [],
  actual: [],
  projects: [
    {
      id: 'visible',
      organizationId: 'org',
      name: 'Launch',
      milestones: [{ name: 'Release', targetDate: '2026-10-07' }],
      tasks: [],
    },
  ],
};

function runtime(reply: unknown, capture?: (input: TurnInput) => void): AgentTurnRuntime {
  return {
    async *streamTurn(input): AsyncIterable<TurnEvent> {
      capture?.(input);
      yield { type: 'tool_use', id: 'reply', name: 'return_daily_plan_assessment', input: reply };
    },
  };
}

describe('grounded daily plan assessment', () => {
  it('accepts structured model output and keeps project identity grounded', async () => {
    const result = await assessDailyPlan(
      runtime({
        assessment: 'The afternoon leaves room for release preparation.',
        suggestions: [
          {
            projectId: 'visible',
            organizationId: 'org',
            title: 'Prepare release checklist',
            reason: 'Release is tomorrow.',
          },
        ],
      }),
      context,
      'revision',
    );
    expect(result).toEqual({
      proposalFingerprint: 'revision',
      assessment: 'The afternoon leaves room for release preparation.',
      suggestions: [
        {
          projectId: 'visible',
          organizationId: 'org',
          projectName: 'Launch',
          title: 'Prepare release checklist',
          reason: 'Release is tomorrow.',
        },
      ],
    });
  });

  it('drops proposed tasks outside the visible project context', async () => {
    const result = await assessDailyPlan(
      runtime({
        assessment: null,
        suggestions: [
          {
            projectId: 'private',
            organizationId: 'org',
            title: 'Hidden work',
            reason: 'Not grounded.',
          },
          {
            projectId: 'visible',
            organizationId: 'other-org',
            title: 'Wrong workspace',
            reason: 'Not grounded.',
          },
        ],
      }),
      context,
      'revision',
    );
    expect(result.suggestions).toEqual([]);
  });

  it('never presents deterministic runtime output as Athena judgment', async () => {
    expect(await assessDailyPlan(new MockAgentTurnRuntime(), context, 'revision')).toEqual({
      proposalFingerprint: 'revision',
      assessment: null,
      suggestions: [],
    });
  });

  it('drops speculative tasks without an approaching visible milestone', async () => {
    const result = await assessDailyPlan(
      runtime({
        assessment: null,
        suggestions: [
          {
            projectId: 'visible',
            organizationId: 'org',
            title: 'Speculative task',
            reason: 'Model guessed.',
          },
        ],
      }),
      {
        ...context,
        projects: [
          { id: 'visible', organizationId: 'org', name: 'Launch', milestones: [], tasks: [] },
        ],
      },
      'revision',
    );
    expect(result.suggestions).toEqual([]);
  });

  it('fails quietly for unavailable or malformed model output', async () => {
    const unavailable: AgentTurnRuntime = {
      streamTurn() {
        throw new Error('private provider detail');
      },
    };
    expect(await assessDailyPlan(unavailable, context, 'revision')).toMatchObject({
      assessment: null,
      suggestions: [],
    });
    expect(
      await assessDailyPlan(
        runtime({ assessment: 'A'.repeat(1000), suggestions: [] }),
        context,
        'revision',
      ),
    ).toMatchObject({ assessment: null, suggestions: [] });
  });

  it('exposes only the return tool and treats input context as reference data', async () => {
    let tools: readonly string[] = [];
    await assessDailyPlan(
      runtime({ assessment: null, suggestions: [] }, (input) => {
        tools = input.tools.map((tool) => tool.name);
        expect(input.system).toContain('reference data');
      }),
      context,
      'revision',
    );
    expect(tools).toEqual(['return_daily_plan_assessment']);
  });
});
