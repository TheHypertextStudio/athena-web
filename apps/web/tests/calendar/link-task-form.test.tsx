/**
 * Behavior tests for {@link import('../../src/components/calendar/item-drawer/task-forms')}.
 *
 * @remarks
 * The form has two ways to say something went wrong, and they must not be confused: a value that
 * is not a task link is a field error under the control, while a link the API refuses is a notice.
 */
import '@testing-library/jest-dom/vitest';

import { OrganizationId } from '@docket/identity-access/ids';
import { Toaster, dismissAllNotices } from '@docket/ui/components';
import { TaskId } from '@docket/work/ids';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeQueryWrapper, okResponse, problemResponse } from '../support/query';

const { itemTasksPost } = vi.hoisted(() => ({ itemTasksPost: vi.fn() }));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: { calendar: { items: { ':id': { tasks: { $post: itemTasksPost } } } } },
    },
  },
}));

import { ActiveOrgContext } from '../../src/components/active-org';
import { LinkTaskForm } from '../../src/components/calendar/item-drawer/task-forms';

const ORG_ID = OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const TASK_ID = TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA0');
const ITEM_ID = '01BX5ZZKBKACTAV9WEVGEMMVS1';

function renderForm(): { readonly onDone: ReturnType<typeof vi.fn> } {
  const { client } = makeQueryWrapper();
  const onDone = vi.fn();
  const wrapper = ({ children }: { readonly children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>
      <ActiveOrgContext
        orgs={[{ id: ORG_ID, name: 'Acme', slug: 'acme', avatar: null, isPersonal: false }]}
        activeOrgId={null}
        orgsError={null}
        orgsLoading={false}
      >
        {children}
        <Toaster />
      </ActiveOrgContext>
    </QueryClientProvider>
  );
  render(<LinkTaskForm itemId={ITEM_ID} onDone={onDone} />, { wrapper });
  return { onDone };
}

beforeEach(() => {
  itemTasksPost.mockReset();
});

afterEach(() => {
  dismissAllNotices();
  cleanup();
});

describe('LinkTaskForm', () => {
  it('marks a value that is not a task link as invalid, under the control', async () => {
    renderForm();
    const input = screen.getByLabelText('Task ID');

    await userEvent.type(input, 'not a task');

    const error = screen.getByRole('alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.id);
    expect(screen.getByRole('button', { name: 'Link task' })).toBeDisabled();

    await userEvent.clear(input);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('presents a refused link as a notice and keeps the form open', async () => {
    itemTasksPost.mockResolvedValue(problemResponse('server detail', 500, 'internal'));
    const { onDone } = renderForm();

    await userEvent.type(
      screen.getByLabelText('Task ID'),
      `https://docket.hypertext.studio/orgs/${ORG_ID}/tasks/${TASK_ID}`,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Link task' }));

    const notice = await screen.findByRole('alert');
    expect(notice).not.toHaveTextContent(/server detail/);
    expect(screen.getByRole('button', { name: 'Link task' })).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('closes after a link the API accepts', async () => {
    itemTasksPost.mockResolvedValue(okResponse({}));
    const { onDone } = renderForm();

    await userEvent.type(
      screen.getByLabelText('Task ID'),
      `https://docket.hypertext.studio/orgs/${ORG_ID}/tasks/${TASK_ID}`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Link task' }));

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
