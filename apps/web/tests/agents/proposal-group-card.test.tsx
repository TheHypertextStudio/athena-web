import '@testing-library/jest-dom/vitest';

import type { ProposalGroupOut, ProposalItemOut } from '@docket/athena/agent-contract';
import type { AgentSessionId, SessionActivityId } from '@docket/athena/ids';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { assertDefined } from '@docket/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProposalGroupCard } from '../../src/components/agents/proposal-group-card';

/** Cast a plain string to the branded {@link SessionActivityId} this test fixture needs. */
function activityId(value: string): SessionActivityId {
  return value as SessionActivityId;
}

function item(overrides: Partial<ProposalItemOut> = {}): ProposalItemOut {
  return {
    activityId: activityId('activity_1'),
    sessionId: 'session_1' as AgentSessionId,
    proposalGroupId: 'group_1',
    tool: 'update_task',
    summary: 'update the task',
    input: { taskId: '01HZ0000000000000000LN0001', state: 'in_progress' },
    mode: 'proposal',
    ghost: null,
    createdAt: '2026-07-15T16:00:00.000Z',
    ...overrides,
  };
}

function group(items: ProposalItemOut[]): ProposalGroupOut {
  return { proposalGroupId: 'group_1', sessionId: 'session_1' as AgentSessionId, items };
}

afterEach(() => {
  cleanup();
});

describe('ProposalGroupCard', () => {
  it('renders a single proposal as one plain-language row with no tool id and no checkbox', () => {
    const onDecide = vi.fn();
    const onEdit = vi.fn();
    render(
      <ProposalGroupCard
        group={group([item()])}
        canAct
        pending={false}
        onDecide={onDecide}
        onEdit={onEdit}
      />,
    );

    const section = screen.getByRole('region', { name: /Proposed changes/ });
    expect(within(section).getByText('1 change proposed')).toBeVisible();
    expect(within(section).getByText('Set state to In Progress')).toBeVisible();
    expect(within(section).queryByText('update_task')).not.toBeInTheDocument();
    expect(within(section).queryByRole('checkbox')).not.toBeInTheDocument();

    expect(within(section).getByRole('button', { name: 'Approve' })).toBeVisible();
    expect(within(section).getByRole('button', { name: 'Reject' })).toBeVisible();
  });

  it('approves the whole group when Approve is clicked with nothing checked', () => {
    const onDecide = vi.fn();
    render(
      <ProposalGroupCard
        group={group([item()])}
        canAct
        pending={false}
        onDecide={onDecide}
        onEdit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('group_1', 'approve');
  });

  it('renders a checkbox per row and an "Approve N" label once there is more than one item', () => {
    render(
      <ProposalGroupCard
        group={group([
          item({ activityId: activityId('activity_1') }),
          item({ activityId: activityId('activity_2'), input: { taskId: 'x', title: 'Ship it' } }),
        ])}
        canAct
        pending={false}
        onDecide={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    const section = screen.getByRole('region', { name: /Proposed changes/ });
    expect(within(section).getByText('2 changes proposed')).toBeVisible();
    expect(within(section).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(section).getByRole('button', { name: 'Approve 2' })).toBeVisible();
  });

  it('switches to "Approve selected (k)" and approves only the checked rows on a partial selection', () => {
    const onDecide = vi.fn();
    render(
      <ProposalGroupCard
        group={group([
          item({ activityId: activityId('activity_1') }),
          item({ activityId: activityId('activity_2'), input: { taskId: 'x', title: 'Ship it' } }),
        ])}
        canAct
        pending={false}
        onDecide={onDecide}
        onEdit={vi.fn()}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(assertDefined(checkboxes[0]));

    const approveButton = screen.getByRole('button', { name: 'Approve selected (1)' });
    fireEvent.click(approveButton);

    expect(onDecide).toHaveBeenCalledWith('group_1', 'approve', ['activity_1']);
  });

  it('rejects the whole group regardless of what is checked, and keeps the label "Reject"', () => {
    const onDecide = vi.fn();
    render(
      <ProposalGroupCard
        group={group([
          item({ activityId: activityId('activity_1') }),
          item({ activityId: activityId('activity_2'), input: { taskId: 'x', title: 'Ship it' } }),
        ])}
        canAct
        pending={false}
        onDecide={onDecide}
        onEdit={vi.fn()}
      />,
    );

    fireEvent.click(assertDefined(screen.getAllByRole('checkbox')[0]));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(onDecide).toHaveBeenCalledWith('group_1', 'reject');
  });

  it('keeps inline title editing for a ghost row and patches the stored input on commit', () => {
    const onEdit = vi.fn();
    render(
      <ProposalGroupCard
        group={group([
          item({
            tool: 'create_task',
            input: { title: 'Send the contractor agreement' },
            ghost: {
              title: 'Send the contractor agreement',
              teamId: null,
              projectId: null,
              dueDate: null,
            },
          }),
        ])}
        canAct
        pending={false}
        onDecide={vi.fn()}
        onEdit={onEdit}
      />,
    );

    fireEvent.click(screen.getByText('Create "Send the contractor agreement"'));
    const input = screen.getByRole('textbox', { name: 'Edit the proposed title' });
    fireEvent.change(input, { target: { value: 'Send the signed agreement' } });
    fireEvent.blur(input);

    expect(onEdit).toHaveBeenCalledWith('activity_1', {
      title: 'Send the signed agreement',
    });
  });

  it('renders no action row when the reviewer cannot act', () => {
    render(
      <ProposalGroupCard
        group={group([item()])}
        canAct={false}
        pending={false}
        onDecide={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });
});
