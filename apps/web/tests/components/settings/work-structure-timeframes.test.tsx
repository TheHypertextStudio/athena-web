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
      estimationScale: 'fibonacci',
      fiscalYearStartMonth: 0,
    }),
  );
  settingsPatch.mockReset().mockImplementation(async ({ json }: { json: object }) =>
    jsonResponse(true, {
      initiativeMaxDepth: 2,
      estimationScale: 'fibonacci',
      fiscalYearStartMonth: 'fiscalYearStartMonth' in json ? json.fiscalYearStartMonth : 0,
    }),
  );
});

afterEach(cleanup);

describe('work structure planning calendar', () => {
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
