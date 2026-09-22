/**
 * The task search every relationship control opens.
 *
 * @remarks
 * It reads the org search route for tasks only, never offers an excluded task, and hands back the
 * chosen task with enough of it to show on the page at once.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { okResponse, makeQueryWrapper } from '../support/query';

const { searchGet } = vi.hoisted(() => ({ searchGet: vi.fn() }));

vi.mock('../../src/lib/api', () => ({
  api: { v1: { orgs: { ':orgId': { search: { $get: searchGet } } } } },
}));

const { TaskSearchPopover } = await import('../../src/components/task-detail/task-search-popover');

const SELF = '01BX5ZZKBKACTAV9WEVGEMMVA0';
const OTHER = '01BX5ZZKBKACTAV9WEVGEMMVA1';
const PROJECT = '01BX5ZZKBKACTAV9WEVGEMMVJ1';

function hit(entityId: string, title: string) {
  return {
    kind: 'task',
    entityId,
    title,
    facets: { state: 'todo', projectId: PROJECT },
  };
}

beforeEach(() => {
  searchGet.mockReset();
  searchGet.mockResolvedValue(
    okResponse({
      query: '',
      items: [hit(SELF, 'This task'), hit(OTHER, 'Book the venue')],
      facets: [],
    }),
  );
});

afterEach(() => {
  cleanup();
});

function renderSearch(overrides: { clear?: { label: string; onClear: () => void } } = {}) {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  const { wrapper } = makeQueryWrapper();
  render(
    <TaskSearchPopover
      orgId="org_1"
      open
      onOpenChange={onOpenChange}
      anchor="trigger"
      exclude={new Set([SELF])}
      onPick={onPick}
      projectName={() => 'Launch'}
      searchPlaceholder="Find a task…"
      ariaLabel="Task that blocks this one"
      {...overrides}
    >
      <button type="button">Open</button>
    </TaskSearchPopover>,
    { wrapper },
  );
  return { onPick, onOpenChange };
}

describe('TaskSearchPopover', () => {
  it('searches tasks only, and never offers an excluded task', async () => {
    renderSearch();

    expect(await screen.findByRole('button', { name: /Book the venue/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /This task/ })).not.toBeInTheDocument();
    expect(searchGet).toHaveBeenCalledWith(
      expect.objectContaining({
        param: { orgId: 'org_1' },
        query: expect.objectContaining({ kinds: 'task' }),
      }),
    );
  });

  it('sends what is typed as the search term', async () => {
    renderSearch();
    await screen.findByRole('button', { name: /Book the venue/ });

    fireEvent.change(screen.getByPlaceholderText('Find a task…'), { target: { value: 'venue' } });

    await waitFor(() => {
      expect(searchGet).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: expect.objectContaining({ q: 'venue' }) }),
      );
    });
  });

  it('hands back the chosen task with its title, state, and project, then closes', async () => {
    const { onPick, onOpenChange } = renderSearch();

    fireEvent.click(await screen.findByRole('button', { name: /Book the venue/ }));

    expect(onPick).toHaveBeenCalledWith({
      id: OTHER,
      title: 'Book the venue',
      state: 'todo',
      projectId: PROJECT,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('offers a clear row when the control has one', async () => {
    const onClear = vi.fn();
    renderSearch({ clear: { label: 'No parent', onClear } });

    fireEvent.click(await screen.findByRole('button', { name: 'No parent' }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
