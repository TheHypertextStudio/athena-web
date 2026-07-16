import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AthenaWorkbench } from '../../src/components/athena/athena-workbench';
import type { PersonalAthenaSessionDetail } from '../../src/lib/athena/presentation';

const session: PersonalAthenaSessionDetail = {
  id: 'session_1',
  objective: 'Protect two hours for the launch review',
  status: 'awaiting_approval',
  queueState: 'needs_you',
  workspace: { id: 'workspace_1', name: 'Hypertext Studio' },
  context: {
    workspaceId: 'workspace_1',
    source: { type: 'project', id: 'project_1', label: 'Athena launch' },
  },
  createdAt: '2026-07-15T15:00:00.000Z',
  updatedAt: '2026-07-15T16:00:00.000Z',
  decision: {
    kind: 'approval',
    id: 'proposal_1',
    title: 'Move the launch review',
    description: 'Shift the review to Thursday at 2:00 PM.',
    private: true,
    options: [
      { id: 'approve', label: 'Approve' },
      { id: 'reject', label: 'Keep current time' },
    ],
  },
  activities: [
    {
      id: 'reasoning_1',
      type: 'reasoning',
      createdAt: '2026-07-15T16:00:00.000Z',
      text: 'Private chain of thought',
    },
    {
      id: 'tool_1',
      type: 'tool',
      createdAt: '2026-07-15T16:02:00.000Z',
      service: 'Sunsama',
      action: 'Protected focus time',
      outcome: 'Added 2 blocks to Thursday',
      technical: { toolName: 'sunsama_create_task', input: { duration: 120 } },
    },
  ],
  result: null,
};

describe('AthenaWorkbench', () => {
  it('renders objective, private approval, and structured tool activity without chat or reasoning', () => {
    render(<AthenaWorkbench session={session} />);

    expect(screen.getByRole('heading', { name: session.objective })).toBeVisible();
    expect(screen.getByText('Waiting for your approval')).toBeVisible();
    expect(screen.getByText('Only you can see this decision')).toBeVisible();
    expect(screen.getByText('Sunsama · Protected focus time')).toBeVisible();
    expect(screen.getByText('Added 2 blocks to Thursday')).toBeVisible();
    expect(screen.getByText('Athena launch').parentElement).toHaveClass('whitespace-nowrap');
    expect(screen.queryByText('Private chain of thought')).not.toBeInTheDocument();
    expect(screen.queryByText('sunsama_create_task')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Technical details'));
    expect(screen.getByText(/sunsama_create_task/)).toBeVisible();
  });

  it('emits structured decisions, lifecycle control, and state-aware steering', () => {
    const onDecision = vi.fn();
    const onLifecycle = vi.fn();
    const onMessage = vi.fn();
    render(
      <AthenaWorkbench
        session={session}
        onDecision={onDecision}
        onLifecycle={onLifecycle}
        onMessage={onMessage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecision).toHaveBeenCalledWith('proposal_1', 'approve');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel work' }));
    expect(onLifecycle).toHaveBeenCalledWith('cancel');

    fireEvent.change(screen.getByLabelText('Add context or answer'), {
      target: { value: 'Keep the attendee list unchanged.' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Steer Athena' }));
    expect(onMessage).toHaveBeenCalledWith('Keep the attendee list unchanged.');
  });

  it('submits an optionless Athena question as an activity reply instead of a steering message', () => {
    const onDecision = vi.fn();
    const onMessage = vi.fn();
    render(
      <AthenaWorkbench
        session={{
          ...session,
          status: 'awaiting_input',
          decision: {
            kind: 'question',
            id: 'elicitation_1',
            title: 'Which launch task should I update?',
            private: true,
            options: [],
          },
        }}
        onDecision={onDecision}
        onMessage={onMessage}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer Athena' }), {
      target: { value: 'Update the launch checklist.' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Answer Athena' }));

    expect(onDecision).toHaveBeenCalledWith('elicitation_1', 'Update the launch checklist.');
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('owns enabled foreground tokens for primary and secondary workbench actions', () => {
    const { rerender } = render(<AthenaWorkbench session={session} />);

    const actions = [
      screen.getByRole('button', { name: 'Approve' }),
      screen.getByRole('button', { name: 'Keep current time' }),
      screen.getByRole('button', { name: 'Cancel work' }),
    ];
    expect(actions[0]).toHaveClass('text-primary-foreground');
    expect(actions[1]).toHaveClass('text-on-surface');
    expect(actions[2]).toHaveClass('text-on-surface');
    for (const action of actions) {
      expect(action).toBeEnabled();
      expect(action).toHaveClass('focus-visible:ring-ring', 'disabled:opacity-50');
    }

    rerender(<AthenaWorkbench session={session} pending />);
    for (const action of actions) expect(action).toBeDisabled();
  });
});
