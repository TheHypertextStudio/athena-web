import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
      <TaskActivitySession group={group} />
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
    expect(screen.getByText('Revised brief')).toBeVisible();
    expect(screen.getByRole('button', { name: 'updated the description' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '1 change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2 execution details' })).not.toBeInTheDocument();
    expect(screen.queryByText('Checking the brief.')).not.toBeInTheDocument();
    expect(screen.queryByText('Proposed publishing.')).not.toBeInTheDocument();
    expect(screen.queryByText('3 changes to this task')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'updated the description' }));
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
  it('shows short changes without opening a count disclosure', () => {
    show([
      entry('priority', {
        type: 'updated',
        category: 'task',
        change: { field: 'priority', label: 'Priority', from: 'Normal', to: 'High' },
      }),
    ]);
    expect(
      screen.getByRole('button', { name: /changed Priority from Normal to High/ }),
    ).toBeVisible();
    expect(screen.queryByText('1 change')).not.toBeInTheDocument();
  });
  it('consolidates repeated scalar edits into visible current values without losing their history', () => {
    show([
      entry('first', {
        change: { field: 'priority', label: 'Priority', from: 'Normal', to: 'High' },
      }),
      entry('second', {
        change: { field: 'priority', label: 'Priority', from: 'High', to: 'Urgent' },
      }),
    ]);
    expect(screen.getByRole('button', { name: /Urgent/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Normal/ })).toBeVisible();
    expect(screen.queryByText('High')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /2 edits/ }));
    expect(screen.getAllByText('High')).toHaveLength(2);
  });
  it('shows concrete relationship changes without merging different links', () => {
    show([
      entry('one', {
        change: {
          field: 'dependency',
          label: 'Dependency',
          from: null,
          to: 'Blocks November announcement',
        },
      }),
      entry('two', {
        change: {
          field: 'dependency',
          label: 'Dependency',
          from: null,
          to: 'Blocked by Venue confirmation',
        },
      }),
    ]);
    expect(screen.getByRole('button', { name: /November announcement\b/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Venue confirmation\b/ })).toBeVisible();

    expect(screen.getAllByRole('button', { name: /Blocks|Blocked by/ })).toHaveLength(2);
  });

  it('shows a recorded activity window without implying session completion or task ownership', () => {
    show([
      entry('first', {
        createdAt: '2026-10-25T12:01:00.000Z',
        change: { field: 'priority', label: 'Priority', from: 'Normal', to: 'High' },
      }),
      entry('second', {
        createdAt: '2026-10-25T12:06:00.000Z',
        change: { field: 'priority', label: 'Priority', from: 'High', to: 'Urgent' },
      }),
    ]);
    expect(screen.getByLabelText(/Recorded activity from/)).toBeVisible();
    expect(screen.queryByText(/Completed|Finished|Owner|Delegated by/)).not.toBeInTheDocument();
  });
  it('labels a legacy connection without claiming a delegated work session', () => {
    show([
      entry('one', {
        session: { id: 'connection', kind: 'connection', title: 'Codex connection' },
        change: { field: 'priority', label: 'Priority', from: 'Normal', to: 'High' },
      }),
    ]);
    expect(screen.getByText('connection')).toBeVisible();
    expect(screen.queryByText(/Owner|Delegated by/)).not.toBeInTheDocument();
  });
  it('keeps a newly edited field among the latest visible changes in a long session', () => {
    const edits = Array.from({ length: 12 }, (_, index) =>
      entry(String(index), {
        change:
          index === 3
            ? { field: 'priority', label: 'Priority', from: 'Normal', to: 'High' }
            : { field: `field${index}`, label: `Field ${index}`, from: null, to: 'Set' },
      }),
    );
    edits.push(
      entry('latest', {
        change: { field: 'priority', label: 'Priority', from: 'High', to: 'Urgent' },
      }),
    );
    show(edits);
    expect(screen.getByRole('button', { name: /Urgent/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Field 5\b/ })).not.toBeInTheDocument();
  });
  it('shows every action in an ordinary five-change session', () => {
    show(
      Array.from({ length: 5 }, (_, index) =>
        entry(String(index), {
          type: 'updated',
          category: 'task',
          change: { field: `field${index}`, label: `Field ${index + 1}`, from: null, to: 'High' },
        }),
      ),
    );
    expect(screen.getByRole('button', { name: /Field 4\b/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Field 5\b/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /more changes/ })).not.toBeInTheDocument();
  });
  it('keeps ordinary change lists open and folds only the middle of long sequences', () => {
    show(
      Array.from({ length: 12 }, (_, index) =>
        entry(String(index), {
          type: 'updated',
          category: 'task',
          change: { field: `field${index}`, label: `Field ${index + 1}`, from: null, to: 'High' },
        }),
      ),
    );
    expect(screen.getByRole('button', { name: /Field 1\b/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Field 12\b/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Field 4\b/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 6 more changes' }));
    expect(screen.getByRole('button', { name: /Field 4\b/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Field 9\b/ })).toBeVisible();
  });
  it('keeps authored updates and mutations in recorded order and offers full source activity', () => {
    show([
      entry('comment-one', { type: 'comment', body: 'Starting with the reusable kit.' }),
      entry('edit-one', {
        change: { field: 'priority', label: 'Priority', from: 'Normal', to: 'High' },
      }),
      entry('comment-two', { type: 'comment', body: 'The venue is still open.' }),
      entry('edit-two', {
        change: { field: 'priority', label: 'Priority', from: 'High', to: 'Urgent' },
      }),
    ]);
    const article = screen.getByRole('article');
    const rows = within(article).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Starting with the reusable kit.');
    expect(rows[1]).toHaveTextContent('The venue is still open.');
    expect(rows[2]).toHaveTextContent('Urgent');
    expect(screen.queryByText('for Willie')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open full session' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View session activity' }));
    const detail = screen.getByRole('dialog');
    expect(within(detail).getAllByText('High')).toHaveLength(2);
    expect(within(detail).getByText('Starting with the reusable kit.')).toBeVisible();
    expect(within(detail).getByText('The venue is still open.')).toBeVisible();
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
