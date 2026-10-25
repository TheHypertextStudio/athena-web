import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskActivityOut } from '@docket/connections/activity-contract';
import { TaskActivitySession } from '../../src/components/task-detail/task-activity-session';
import { activitySessionGroups } from '../../src/components/task-detail/activity-session-groups';

const session = { id: 'work', kind: 'work', title: 'Codex session' } as const;
/** Build one explicit contribution without involving transport queries. */
function entry(id: string, detail: Partial<TaskActivityOut>): TaskActivityOut {
  return {
    id,
    taskId: 'task' as TaskActivityOut['taskId'],
    actorId: null,
    actorName: null,
    type: 'session',
    category: 'automation',
    body: null,
    change: null,
    origin: null,
    subjectTaskId: null,
    subjectTaskTitle: null,
    session,
    createdAt: '2026-10-25T12:01:00.000Z',
    ...detail,
  };
}
function show(entries: TaskActivityOut[]): void {
  const group = activitySessionGroups(entries)[0];
  if (!group) throw new Error('Missing contribution');
  render(
    <ol>
      <TaskActivitySession
        group={group}
        renderEntry={(item) => <li key={item.id}>{item.body}</li>}
      />
    </ol>,
  );
}
afterEach(cleanup);

describe('session presentation', () => {
  it('keeps internal execution details out of the task timeline', () => {
    show([
      entry('thought', { body: 'Checking the brief.', sessionEvent: 'change' }),
      entry('proposal', { body: 'Proposed publishing.', sessionEvent: 'change' }),
      entry('mutation', {
        type: 'updated',
        category: 'task',
        change: {
          field: 'description',
          label: 'Description',
          from: 'Original brief',
          to: 'Revised brief',
        },
      }),
    ]);
    expect(screen.getByRole('button', { name: '1 change' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2 execution details' })).not.toBeInTheDocument();
    expect(screen.queryByText('Checking the brief.')).not.toBeInTheDocument();
    expect(screen.queryByText('Proposed publishing.')).not.toBeInTheDocument();
    expect(screen.queryByText('3 changes to this task')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1 change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Description revised' }));
    expect(screen.getByText('Original brief')).toBeVisible();
    expect(
      screen.getByText(
        new Date('2026-10-25T12:01:00.000Z').toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'medium',
        }),
      ),
    ).toBeVisible();
    expect(
      document.querySelector('time[datetime="2026-10-25T12:01:00.000Z"][data-entry-time]'),
    ).not.toBeNull();
  });
  it('does not render transcript-only sessions as task contributions', () => {
    show([entry('thought', { body: 'Internal thought.', sessionEvent: 'change' })]);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('does not manufacture a zero-change summary for a question-only session', () => {
    show([entry('question', { body: 'Which venue?', sessionEvent: 'question' })]);
    expect(screen.getByText('Which venue?')).toBeVisible();
    expect(screen.queryByText(/0 changes/)).not.toBeInTheDocument();
  });
});
