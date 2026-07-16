import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from '../../src/agent/system-prompt';

const BASE = {
  agentName: 'Athena',
  executorKind: 'athena' as const,
  contextName: 'Operations',
  approvalPolicy: 'autonomous' as const,
  personalInstructions: null,
  guidance: null,
};

describe('buildSystemPrompt user-owned preferences', () => {
  it('frames Athena as the user’s personal chief of staff with workspace context only', () => {
    const prompt = buildSystemPrompt({ ...BASE, personalApprovalMode: 'ask_before_acting' });

    expect(prompt).toContain('your personal chief of staff');
    expect(prompt).toContain('current workspace context is "Operations"');
    expect(prompt).not.toContain('resident');
    expect(prompt).not.toContain('inside the organization');
  });

  it('places the principal instructions in every workspace session', () => {
    const prompt = buildSystemPrompt({
      ...BASE,
      personalApprovalMode: 'ask_before_acting',
      personalInstructions: 'Keep updates concise and call out deadlines.',
      guidance: 'Use the operations vocabulary.',
    });

    expect(prompt).toContain('Personal instructions from the human principal:');
    expect(prompt).toContain('Keep updates concise and call out deadlines.');
    expect(prompt).toContain('Workspace guidance for this agent:');
  });

  it('describes the same personal approval ceiling enforced by the tool loop', () => {
    expect(buildSystemPrompt({ ...BASE, personalApprovalMode: 'suggest_only' })).toContain(
      'RECORDED AS SUGGESTIONS',
    );
    expect(buildSystemPrompt({ ...BASE, personalApprovalMode: 'ask_before_acting' })).toContain(
      'QUEUED FOR HUMAN APPROVAL',
    );
    const routine = buildSystemPrompt({ ...BASE, personalApprovalMode: 'routine_autonomy' });
    expect(routine).toContain('routine writes may EXECUTE IMMEDIATELY');
    expect(routine).toContain('external services are QUEUED FOR HUMAN APPROVAL');
  });

  it('keeps a restrictive workspace agent stricter than routine autonomy', () => {
    const prompt = buildSystemPrompt({
      ...BASE,
      approvalPolicy: 'suggest',
      personalApprovalMode: 'routine_autonomy',
    });
    expect(prompt).toContain('RECORDED AS SUGGESTIONS');
  });
});
