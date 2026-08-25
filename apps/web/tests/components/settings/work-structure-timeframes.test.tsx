import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { settingsGet, settingsPatch } = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsPatch: vi.fn(),
}));

vi.mock('../../../src/lib/app-location', () => ({
  useTypedRoute: () => ({ params: { orgId: 'org_1' } }),
}));

vi.mock('../../../src/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canManage: true, loading: false }),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          settings: {
            'work-structure': { $get: settingsGet, $patch: settingsPatch },
          },
        },
      },
    },
  },
}));

import WorkStructureSettingsPage from '../../../src/app/(app)/orgs/[orgId]/settings/work-structure/page';
import { jsonResponse } from '../../support/http';

function wrapper(): ({ children }: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  settingsGet.mockReset().mockResolvedValue(
    jsonResponse(true, {
      initiativeMaxDepth: 2,
      autoCompleteParentTasks: true,
      estimationScale: 'fibonacci',
      fiscalYearStartMonth: 0,
    }),
  );
  settingsPatch.mockReset().mockImplementation(async ({ json }: { json: Record<string, unknown> }) =>
    jsonResponse(true, {
      initiativeMaxDepth: 2,
      autoCompleteParentTasks:
        typeof json['autoCompleteParentTasks'] === 'boolean'
          ? json['autoCompleteParentTasks']
          : true,
      estimationScale: 'fibonacci',
      fiscalYearStartMonth: 'fiscalYearStartMonth' in json ? json['fiscalYearStartMonth'] : 0,
    }),
  );
});

afterEach(cleanup);

describe('work structure planning calendar', () => {
  it('shows an explicit disabled parent completion policy as off', async () => {
    settingsGet.mockResolvedValueOnce(
      jsonResponse(true, {
        initiativeMaxDepth: 2,
        autoCompleteParentTasks: false,
        estimationScale: 'fibonacci',
        fiscalYearStartMonth: 0,
      }),
    );

    render(<WorkStructureSettingsPage />, { wrapper: wrapper() });

    const parentCompletion = await screen.findByRole('switch', {
      name: 'Complete parent tasks automatically',
    });
    expect(parentCompletion).toHaveAttribute('aria-checked', 'false');
    expect(parentCompletion).toHaveTextContent('Off');
  });

  it('restores the fetched parent completion policy when saving fails', async () => {
    const user = userEvent.setup();
    settingsPatch.mockResolvedValueOnce(jsonResponse(false, { detail: 'Server failure.' }));
    render(<WorkStructureSettingsPage />, { wrapper: wrapper() });

    const parentCompletion = await screen.findByRole('switch', {
      name: 'Complete parent tasks automatically',
    });
    await user.click(parentCompletion);

    await waitFor(() => {
      expect(parentCompletion).toHaveAttribute('aria-checked', 'true');
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save parent task completion.',
    );
  });

  it('defaults parent completion to on and lets a manager turn it off', async () => {
    const user = userEvent.setup();
    render(<WorkStructureSettingsPage />, { wrapper: wrapper() });

    const parentCompletion = await screen.findByRole('switch', {
      name: 'Complete parent tasks automatically',
    });
    expect(parentCompletion).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByText(
        'When every subtask is complete or canceled, automatically complete its parent. Reopening a subtask reopens a parent that this setting completed.',
      ),
    ).toBeVisible();

    await user.click(parentCompletion);
    await waitFor(() => {
      expect(settingsPatch).toHaveBeenCalledWith({
        param: { orgId: 'org_1' },
        json: { autoCompleteParentTasks: false },
      });
    });
  });

  it('changes the fiscal basis for new Project and Initiative timeframes only', async () => {
    const user = userEvent.setup();
    render(<WorkStructureSettingsPage />, { wrapper: wrapper() });

    const fiscalMonth = await screen.findByLabelText('Fiscal year starts');
    expect(fiscalMonth).toHaveValue('0');
    expect(
      screen.getByText(
        'This changes new Project and Initiative quarters, halves, and years. Saved timeframes do not move.',
      ),
    ).toBeVisible();

    await user.selectOptions(fiscalMonth, '6');
    await waitFor(() => {
      expect(settingsPatch).toHaveBeenCalledWith({
        param: { orgId: 'org_1' },
        json: { fiscalYearStartMonth: 6 },
      });
    });
  });
});
