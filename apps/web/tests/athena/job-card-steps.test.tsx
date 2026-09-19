/**
 * Behavior tests for {@link JobSteps}.
 *
 * @remarks
 * Steps stay collapsed behind their count in every lifecycle state and only a person's own click
 * opens them. These also pin the step renderer's own rules: the count is pluralised, the job's
 * initiating message is dropped (the objective already carries it as the entry's title), a later
 * message from the person is kept, a narration carries no label above it, and Details renders
 * labelled rows rather than a raw dump.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobSteps } from '../../src/components/athena/job-card-steps';
import type { AthenaActivityPresentation } from '../../src/lib/athena/presentation';

const TOOL_STEP: AthenaActivityPresentation = {
  id: 'tool_1',
  kind: 'tool',
  title: 'Protected focus time',
  detail: 'Added 2 blocks to Thursday',
  createdAt: '2026-09-18T16:00:00.000Z',
  technical: { toolName: 'protect_time', input: { hours: 2, day: 'Thursday' } },
};

afterEach(() => {
  cleanup();
});

function renderSteps(activities: readonly AthenaActivityPresentation[], isFinished = false): void {
  render(
    <JobSteps
      activities={activities}
      isFinished={isFinished}
      undoneChangeSetIds={new Set()}
      undoPending={false}
      onUndo={vi.fn()}
    />,
  );
}

describe('JobSteps', () => {
  it('stays collapsed until clicked, behind a singular count for one step', () => {
    renderSteps([TOOL_STEP], true);

    expect(screen.queryByRole('list', { name: 'Steps' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: /^1 step$/ });
    expect(trigger).toHaveClass('min-h-10');

    fireEvent.click(trigger);
    expect(
      within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem'),
    ).toHaveLength(1);
  });

  it('drops the initiating message and keeps a later one, counted among the steps', () => {
    renderSteps([
      {
        id: 'message_1',
        kind: 'message',
        title: 'You asked',
        detail: 'Protect two hours for the launch review',
        createdAt: '2026-09-18T15:59:00.000Z',
      },
      TOOL_STEP,
      {
        id: 'message_2',
        kind: 'message',
        title: 'You asked',
        detail: 'Actually, make it three hours.',
        createdAt: '2026-09-18T16:01:00.000Z',
      },
    ]);

    fireEvent.click(screen.getByRole('button', { name: /^2 steps$/ }));

    const list = screen.getByRole('list', { name: 'Steps' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list).not.toHaveTextContent('Protect two hours for the launch review');
    expect(list).toHaveTextContent('Actually, make it three hours.');
  });

  it('renders a narration as its own sentence, with no label line above it', () => {
    const narration: AthenaActivityPresentation = {
      id: 'progress_1',
      kind: 'progress',
      title: 'Progress',
      detail: 'Checking the calendar for conflicts',
      createdAt: '2026-09-18T16:00:00.000Z',
    };
    renderSteps([narration]);

    fireEvent.click(screen.getByRole('button', { name: /^1 step$/ }));

    const item = within(screen.getByRole('list', { name: 'Steps' })).getByRole('listitem');
    expect(item.querySelectorAll('p')).toHaveLength(1);
    expect(item).not.toHaveTextContent(narration.title);
  });

  it('opens Details as labelled rows of the call, never a raw dump', () => {
    renderSteps([TOOL_STEP]);

    fireEvent.click(screen.getByRole('button', { name: /^1 step$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    const item = within(screen.getByRole('list', { name: 'Steps' })).getByRole('listitem');
    expect(item.querySelector('pre')).toBeNull();
    const terms = Array.from(item.querySelectorAll('dt')).map((term) => term.textContent);
    expect(terms).toEqual(['tool', 'hours', 'day']);
  });

  it('keeps a failed step’s result text out of Details', () => {
    renderSteps([
      {
        ...TOOL_STEP,
        failed: true,
        technical: { ...TOOL_STEP.technical, output: 'provider said no' },
      },
    ]);

    fireEvent.click(screen.getByRole('button', { name: /^1 step$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByRole('list', { name: 'Steps' })).not.toHaveTextContent('provider said no');
  });
});
