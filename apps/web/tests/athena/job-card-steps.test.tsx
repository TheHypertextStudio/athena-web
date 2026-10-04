/**
 * Behavior tests for {@link JobSteps}.
 *
 * @remarks
 * Steps are readable immediately and can be collapsed by the person. These also pin the step
 * renderer's own rules: the count is pluralised, the job's
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
  it('shows the native task comment preview immediately with its destination and review state', () => {
    renderSteps([
      {
        ...TOOL_STEP,
        approvalStatus: 'proposed',
        title: "Post Athena's result on the assigned task",
        technical: {
          toolName: 'comment',
          connection: 'docket',
          commentPreview: {
            body: '**Remaining work:** Ship the submit command.\n\nDone when a verified result returns.',
            orgId: 'org_1',
            subjectId: 'task_1',
            subjectType: 'task',
          },
        },
      },
    ]);

    const preview = screen.getByRole('region', { name: 'Comment preview' });
    expect(within(preview).getByText('Remaining work:')).toBeVisible();
    expect(within(preview).getByText('Done when a verified result returns.')).toBeVisible();
    expect(preview.querySelector('strong')).toHaveTextContent('Remaining work:');
    expect(screen.getByRole('link', { name: 'View task' })).toHaveAttribute(
      'href',
      '/orgs/org_1/tasks/task_1',
    );
    expect(screen.getByText('Needs review')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Details' })).not.toBeInTheDocument();
    expect(screen.queryByText('subjectId')).not.toBeInTheDocument();
    expect(screen.queryByText('org_1')).not.toBeInTheDocument();
  });

  it('keeps an external tool named comment in Details with its other arguments', () => {
    renderSteps([
      {
        ...TOOL_STEP,
        technical: {
          toolName: 'comment',
          connection: 'support',
          input: { body: 'Reply to the customer', recipient: 'Customer' },
          commentPreview: { body: 'Reply to the customer' },
        },
      },
    ]);
    expect(screen.queryByRole('region', { name: 'Comment preview' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Customer')).toBeVisible();
  });

  it('explains a bounded or redacted native preview instead of implying it is complete', () => {
    renderSteps([
      {
        ...TOOL_STEP,
        technical: {
          toolName: 'comment',
          connection: 'docket',
          commentPreview: { body: 'Beginning only.', truncated: true },
        },
      },
    ]);
    expect(screen.getByRole('region', { name: 'Comment preview' })).toHaveTextContent(
      'Approval posts the complete comment.',
    );
    cleanup();
    renderSteps([
      {
        ...TOOL_STEP,
        technical: {
          toolName: 'comment',
          connection: 'docket',
          commentPreview: { body: '', redacted: true },
        },
      },
    ]);
    expect(screen.getByRole('region', { name: 'Comment preview' })).toHaveTextContent(
      'Comment content is hidden because it contains credential-like text.',
    );
  });

  it('keeps malformed comment inputs in the generic disclosure', () => {
    renderSteps([{ ...TOOL_STEP, technical: { toolName: 'comment', input: { body: 42 } } }]);

    expect(screen.queryByRole('region', { name: 'Comment preview' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('42')).toBeVisible();
  });

  it('shows a dated action immediately and lets the person collapse it', () => {
    renderSteps([TOOL_STEP], true);

    expect(screen.getByRole('list', { name: 'Steps' })).toBeVisible();
    expect(screen.getByText('Done')).toBeVisible();
    expect(document.querySelector('time[datetime="2026-09-18T16:00:00.000Z"]')).toBeVisible();
    const trigger = screen.getByRole('button', { name: /^1 step$/ });
    expect(trigger).toHaveClass('min-h-10');

    fireEvent.click(trigger);
    expect(screen.queryByRole('list', { name: 'Steps' })).not.toBeInTheDocument();
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

    const item = within(screen.getByRole('list', { name: 'Steps' })).getByRole('listitem');
    expect(item).not.toHaveTextContent(narration.title);
    expect(item).toHaveTextContent(narration.detail ?? '');
  });

  it('opens Details as labelled rows of the call, never a raw dump', () => {
    renderSteps([TOOL_STEP]);

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

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByRole('list', { name: 'Steps' })).not.toHaveTextContent('provider said no');
  });
});
