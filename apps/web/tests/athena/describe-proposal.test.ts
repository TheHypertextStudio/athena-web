import type { ProposalItemOut } from '@docket/athena/agent-contract';
import type { AgentSessionId, SessionActivityId } from '@docket/athena/ids';
import { describe, expect, it } from 'vitest';

import {
  capitalizeFirst,
  describeProposal,
  describeToolActivity,
  isOutwardProposal,
  isOutwardTool,
} from '../../src/lib/athena/describe-proposal';

function proposal(overrides: Partial<ProposalItemOut> = {}): ProposalItemOut {
  return {
    activityId: 'activity_1' as SessionActivityId,
    sessionId: 'session_1' as AgentSessionId,
    proposalGroupId: 'group_1',
    tool: 'update_task',
    connection: null,
    summary: 'update the task',
    input: {},
    mode: 'proposal',
    ghost: null,
    createdAt: '2026-07-15T16:00:00.000Z',
    ...overrides,
  };
}

describe('describeProposal', () => {
  it('names the task for a create_task proposal with a ghost', () => {
    const item = proposal({
      tool: 'create_task',
      input: { title: 'Send the contractor agreement' },
      ghost: {
        title: 'Send the contractor agreement',
        teamId: null,
        projectId: null,
        dueDate: null,
      },
    });

    expect(describeProposal(item)).toBe('Create "Send the contractor agreement"');
  });

  it('falls back to the raw input title for a create_task proposal with no ghost', () => {
    const item = proposal({
      tool: 'create_task',
      input: { title: 'Book the venue' },
      ghost: null,
    });

    expect(describeProposal(item)).toBe('Create "Book the venue"');
  });

  it('describes a state change with its plain-language label', () => {
    const item = proposal({
      tool: 'update_task',
      input: { taskId: '01HZ0000000000000000LN0001', state: 'in_progress' },
    });

    expect(describeProposal(item)).toBe('Set state to In Progress');
  });

  it('humanizes a state key it does not recognize', () => {
    const item = proposal({
      tool: 'update_task',
      input: { taskId: '01HZ0000000000000000LN0001', state: 'blocked_on_review' },
    });

    expect(describeProposal(item)).toBe('Set state to Blocked On Review');
  });

  it('describes a title change', () => {
    const item = proposal({
      tool: 'update_task',
      input: { taskId: '01HZ0000000000000000LN0001', title: 'Ship the launch checklist' },
    });

    expect(describeProposal(item)).toBe('Rename to "Ship the launch checklist"');
  });

  it('describes a due-date change', () => {
    const item = proposal({
      tool: 'update_task',
      input: { taskId: '01HZ0000000000000000LN0001', dueDate: '2026-08-01' },
    });

    expect(describeProposal(item)).toBe('Due 2026-08-01');
  });

  it.each([
    ['assigneeId', 'assignee'],
    ['teamId', 'team'],
    ['projectId', 'project'],
  ] as const)('describes a %s change as moving to another %s', (field, noun) => {
    const item = proposal({
      tool: 'update_task',
      input: { taskId: '01HZ0000000000000000LN0001', [field]: '01HZ0000000000000000LN0002' },
    });

    expect(describeProposal(item)).toBe(`Move to another ${noun}`);
  });

  it('joins several changed fields with a middle dot, in a fixed order', () => {
    const item = proposal({
      tool: 'update_task',
      input: {
        taskId: '01HZ0000000000000000LN0001',
        dueDate: '2026-08-01',
        state: 'done',
        title: 'Ship the launch checklist',
      },
    });

    expect(describeProposal(item)).toBe(
      'Set state to Done · Rename to "Ship the launch checklist" · Due 2026-08-01',
    );
  });

  it('falls back to the capitalized summary for an update_task with no recognized field', () => {
    const item = proposal({
      tool: 'update_task',
      summary: 'update the task',
      input: { taskId: '01HZ0000000000000000LN0001' },
    });

    expect(describeProposal(item)).toBe('Update the task');
  });

  it('falls back to the capitalized summary for any other tool, never the raw tool id', () => {
    const item = proposal({
      tool: 'organize',
      summary: 'organized 3 tasks into a plan',
      input: { items: [] },
    });

    expect(describeProposal(item)).toBe('Organized 3 tasks into a plan');
  });
});

describe('describeToolActivity', () => {
  it('describes a recognized update_task call the same way describeProposal does', () => {
    const activity = {
      action: 'update task',
      technical: { toolName: 'update_task', input: { state: 'in_progress' } },
    };

    expect(describeToolActivity(activity)).toBe('Set state to In Progress');
  });

  it('names the created task for a recognized create_task call', () => {
    const activity = {
      action: 'create task',
      technical: { toolName: 'create_task', input: { title: 'Book the venue' } },
    };

    expect(describeToolActivity(activity)).toBe('Create "Book the venue"');
  });

  it('falls back to the capitalized action when the tool call carries no recognized field', () => {
    const activity = {
      action: 'update task',
      technical: { toolName: 'update_task', input: { taskId: '01HZ0000000000000000LN0001' } },
    };

    expect(describeToolActivity(activity)).toBe('Update task');
  });

  it('falls back to the capitalized action for a tool this module does not recognize', () => {
    const activity = {
      action: 'sent 3 emails',
      technical: { toolName: 'gmail_send', input: { to: 'a@example.com' } },
    };

    expect(describeToolActivity(activity)).toBe('Sent 3 emails');
  });

  it('falls back to the capitalized action when there is no raw tool call at all', () => {
    expect(describeToolActivity({ action: 'protected focus time' })).toBe('Protected focus time');
  });
});

describe('isOutwardProposal', () => {
  it('is outward on a non-null connection alone, whatever the tool is named', () => {
    expect(isOutwardProposal(proposal({ tool: 'update_task', connection: 'linear' }))).toBe(true);
  });

  it('falls back to the tool-name match when connection is null', () => {
    expect(isOutwardProposal(proposal({ tool: 'send_email', connection: null }))).toBe(true);
    expect(isOutwardProposal(proposal({ tool: 'update_task', connection: null }))).toBe(false);
  });

  it('still matches on the tool name alone for a caller with no connection to read', () => {
    expect(isOutwardProposal({ tool: 'send_email' })).toBe(true);
    expect(isOutwardProposal({ tool: 'update_task' })).toBe(false);
  });
});

describe('isOutwardTool', () => {
  it('matches only on the tool name, unaware of any connection', () => {
    expect(isOutwardTool('send_email')).toBe(true);
    expect(isOutwardTool('update_task')).toBe(false);
  });
});

describe('capitalizeFirst', () => {
  it('capitalizes the first letter and leaves the rest alone', () => {
    expect(capitalizeFirst('searched tasks')).toBe('Searched tasks');
  });

  it('returns an empty string unchanged', () => {
    expect(capitalizeFirst('')).toBe('');
  });
});
