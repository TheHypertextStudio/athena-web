/**
 * The moved time-estimate popover: it shows the estimate the tasks share, saves a choice to every
 * task, closes, and reports a rejected save as a failure notice.
 */
import '@testing-library/jest-dom/vitest';

import { OrganizationId } from '@docket/identity-access/ids';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EstimateTimePickerOverlay } from '@/components/pickers/estimate-time-picker-overlay';
import type { EstimateTimePickerRequest } from '@/components/pickers/picker-overlay';
import { makeQueryWrapper } from '../../support/query';

const { TASK_GET, TASK_PATCH, PRESENT_FAILURE } = vi.hoisted(() => ({
  TASK_GET: vi.fn(),
  TASK_PATCH: vi.fn(),
  PRESENT_FAILURE: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    v1: { orgs: { ':orgId': { tasks: { ':id': { $get: TASK_GET, $patch: TASK_PATCH } } } } },
  },
}));

vi.mock('@/components/feedback/failure-toast', () => ({ presentFailure: PRESENT_FAILURE }));

const ORG = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2H');
const TASK_A = { kind: 'task' as const, id: 'task_a', organizationId: ORG, title: 'A' };
const TASK_B = { kind: 'task' as const, id: 'task_b', organizationId: ORG, title: 'B' };

/** Render the overlay for a request, returning its close spy. */
function renderOverlay(request: Omit<EstimateTimePickerRequest, 'kind'>): () => void {
  const onClose = vi.fn();
  const { wrapper } = makeQueryWrapper();
  render(
    <EstimateTimePickerOverlay request={{ kind: 'estimate-time', ...request }} onClose={onClose} />,
    { wrapper },
  );
  return onClose;
}

/** Choose the duration row whose label matches. */
async function choose(label: RegExp): Promise<void> {
  const option = await screen.findByRole('option', { name: label });
  fireEvent.click(within(option).getByRole('button'));
}

beforeEach(() => {
  vi.clearAllMocks();
  TASK_PATCH.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
});

describe('EstimateTimePickerOverlay', () => {
  it('checks the estimate every task shares', async () => {
    renderOverlay({
      objects: [TASK_A, TASK_B],
      current: new Map([
        ['task:task_a', 30],
        ['task:task_b', 30],
      ]),
    });

    expect(await screen.findByRole('option', { name: /0:30/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('reads the estimate from the task when the caller has none', async () => {
    TASK_GET.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'task_a', organizationId: ORG, estimateMinutes: 90 }),
    });
    renderOverlay({ objects: [TASK_A] });

    await waitFor(async () => {
      expect(await screen.findByRole('option', { name: /1:30/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    expect(TASK_GET).toHaveBeenCalledWith({ param: { orgId: ORG, id: 'task_a' } });
  });

  it('says so when the current estimate cannot be read, and still offers the list', async () => {
    TASK_GET.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ code: 'internal' }),
    });
    renderOverlay({ objects: [TASK_A] });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /0:30/ })).toBeInTheDocument();
  });

  it('checks nothing when the tasks differ', async () => {
    renderOverlay({
      objects: [TASK_A, TASK_B],
      current: new Map([
        ['task:task_a', 30],
        ['task:task_b', 60],
      ]),
    });

    const options = await screen.findAllByRole('option');
    for (const option of options) expect(option).not.toHaveAttribute('aria-selected', 'true');
  });

  it('saves the choice to every task and closes', async () => {
    const onClose = renderOverlay({
      objects: [TASK_A, TASK_B],
      current: new Map([
        ['task:task_a', null],
        ['task:task_b', null],
      ]),
    });

    await choose(/1:00/);

    await waitFor(() => {
      expect(TASK_PATCH).toHaveBeenCalledTimes(2);
    });
    expect(TASK_PATCH).toHaveBeenCalledWith({
      param: { orgId: ORG, id: 'task_a' },
      json: { estimateMinutes: 60 },
    });
    expect(TASK_PATCH).toHaveBeenCalledWith({
      param: { orgId: ORG, id: 'task_b' },
      json: { estimateMinutes: 60 },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('reports a rejected save as a failure notice', async () => {
    TASK_PATCH.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ code: 'forbidden' }),
    });
    renderOverlay({ objects: [TASK_A], current: new Map([['task:task_a', 45]]) });

    await choose(/0:30/);

    await waitFor(() => {
      expect(PRESENT_FAILURE).toHaveBeenCalledTimes(1);
    });
  });
});
