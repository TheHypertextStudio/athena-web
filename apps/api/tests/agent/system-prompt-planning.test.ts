import { describe, expect, it } from 'vitest';

import {
  PLANNING_SYSTEM_RULE,
  activePlanLine,
  buildSystemPrompt,
} from '../../src/agent/system-prompt';

const BASE = {
  agentName: 'Athena',
  executorKind: 'athena' as const,
  contextName: 'Operations',
  approvalPolicy: 'act_with_approval' as const,
  personalApprovalMode: 'ask_before_acting' as const,
  personalInstructions: null,
  guidance: null,
};

describe('buildSystemPrompt planning guidance', () => {
  it('teaches every session to offer the canvas for initiative-sized work', () => {
    const prompt = buildSystemPrompt(BASE);
    expect(prompt).toContain(PLANNING_SYSTEM_RULE);
    expect(prompt).toContain('`plan_start`');
    expect(prompt).toContain('ONE `plan_draft` call per turn');
    expect(prompt).not.toContain('Active plan:');
  });

  it('names the open plan, its revision, and its counts so Athena reads before editing', () => {
    const activePlan = {
      id: 'plan_1',
      title: 'Spring campaign',
      revision: 4,
      counts: { projects: 3, tasks: 7, draft: 5 },
    };
    const prompt = buildSystemPrompt({ ...BASE, activePlan });
    expect(prompt).toContain(activePlanLine(activePlan));
    expect(prompt).toContain('id plan_1, revision 4');
    expect(prompt).toContain('3 projects, 7 tasks, 5 draft');
    expect(prompt.indexOf('Active plan:')).toBeGreaterThan(prompt.indexOf(PLANNING_SYSTEM_RULE));
  });

  it('places the active plan before the personal instructions', () => {
    const prompt = buildSystemPrompt({
      ...BASE,
      personalInstructions: 'Keep it short.',
      activePlan: {
        id: 'plan_2',
        title: 'Launch',
        revision: 0,
        counts: { projects: 0, tasks: 0, draft: 0 },
      },
    });
    expect(prompt.indexOf('Active plan:')).toBeLessThan(prompt.indexOf('Personal instructions'));
  });
});
