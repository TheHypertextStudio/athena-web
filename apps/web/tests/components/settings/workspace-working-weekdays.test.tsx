import '@testing-library/jest-dom/vitest';
import { Toaster, dismissAllNotices } from '@docket/ui/components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../support/http';

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  workspaceGet: vi.fn(),
  workspacePatch: vi.fn(),
  canManage: true,
}));
vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          $get: transport.workspaceGet,
          $patch: transport.workspacePatch,
          settings: { 'work-structure': { $get: transport.get, $patch: transport.patch } },
        },
      },
    },
  },
}));
vi.mock('../../../src/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canManage: transport.canManage, loading: false }),
}));
vi.mock('../../../src/components/settings/settings-image-picker', () => ({
  SettingsImagePicker: () => null,
}));

import { WorkspaceGeneralSettings } from '../../../src/components/settings/workspace-general-settings';

let weekdays: number[];
let workspaceName: string;
const settings = () => ({
  initiativeMaxDepth: 2,
  autoCompleteParentTasks: true,
  estimationScale: 'fibonacci',
  fiscalYearStartMonth: 0,
  workingWeekdays: weekdays,
});

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    );
  }
  return render(<WorkspaceGeneralSettings orgId="org_1" />, { wrapper: Wrapper });
}

beforeEach(() => {
  weekdays = [1, 2, 3, 4, 5];
  workspaceName = 'Community';
  transport.canManage = true;
  transport.workspaceGet.mockReset().mockImplementation(async () =>
    jsonResponse(true, {
      id: 'org_1',
      name: workspaceName,
      purpose: null,
      avatar: null,
      vocabulary: { preset: 'nonprofit' },
    }),
  );
  transport.workspacePatch
    .mockReset()
    .mockImplementation(async ({ json }: { json: { name: string } }) => {
      workspaceName = json.name;
      return jsonResponse(true, {
        id: 'org_1',
        name: workspaceName,
        purpose: null,
        avatar: null,
        vocabulary: { preset: 'nonprofit' },
      });
    });
  transport.get.mockReset().mockImplementation(async () => jsonResponse(true, settings()));
  transport.patch
    .mockReset()
    .mockImplementation(async ({ json }: { json: { workingWeekdays: number[] } }) => {
      weekdays = json.workingWeekdays;
      return jsonResponse(true, settings());
    });
});
afterEach(() => {
  cleanup();
  dismissAllNotices();
});

describe('General workspace working weekdays', () => {
  it('keeps workspace identity autosaves independent of the working calendar', async () => {
    weekdays = [2, 4];
    const user = userEvent.setup();
    mount();
    const name = await screen.findByRole('textbox', { name: 'Workspace name' });
    await user.clear(name);
    await user.type(name, 'Partners');
    await waitFor(() => {
      expect(transport.workspacePatch).toHaveBeenCalledWith({
        param: { orgId: 'org_1' },
        json: { name: 'Partners' },
      });
    });
    expect(screen.getByRole('checkbox', { name: 'Tuesday' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Monday' })).not.toBeChecked();
    expect(transport.patch).not.toHaveBeenCalled();
  });
  it('shows the saved workspace calendar in Monday through Sunday order', async () => {
    mount();
    expect(await screen.findByRole('group', { name: 'Working weekdays' })).toBeVisible();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(7);
    for (const [index, name] of [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ].entries()) {
      expect(boxes[index]).toHaveAccessibleName(name);
      if (index < 5) expect(boxes[index]).toBeChecked();
      else expect(boxes[index]).not.toBeChecked();
    }
  });

  it('saves sorted weekdays through click and keyboard changes', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('checkbox', { name: 'Sunday' }));
    await waitFor(() => {
      expect(transport.patch).toHaveBeenCalledWith({
        param: { orgId: 'org_1' },
        json: { workingWeekdays: [1, 2, 3, 4, 5, 7] },
      });
    });
    const saturday = screen.getByRole('checkbox', { name: 'Saturday' });
    await waitFor(() => expect(saturday).toBeEnabled());
    saturday.focus();
    await user.keyboard(' ');
    await waitFor(() => {
      expect(transport.patch).toHaveBeenLastCalledWith({
        param: { orgId: 'org_1' },
        json: { workingWeekdays: [1, 2, 3, 4, 5, 6, 7] },
      });
    });
    expect(screen.getByRole('checkbox', { name: 'Sunday' })).toBeChecked();
  });

  it('keeps at least one selected day while allowing a different sole day', async () => {
    weekdays = [3];
    const user = userEvent.setup();
    mount();
    const wednesday = await screen.findByRole('checkbox', { name: 'Wednesday' });
    expect(wednesday).toBeChecked();
    expect(wednesday).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Thursday' }));
    await waitFor(() => expect(wednesday).toBeEnabled());
    await user.click(wednesday);
    await waitFor(() => {
      expect(transport.patch).toHaveBeenLastCalledWith({
        param: { orgId: 'org_1' },
        json: { workingWeekdays: [4] },
      });
    });
    expect(screen.getByRole('checkbox', { name: 'Thursday' })).toBeDisabled();
  });

  it('shows the calendar read-only for a member without management rights', async () => {
    transport.canManage = false;
    mount();
    await screen.findByRole('checkbox', { name: 'Monday' });
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(transport.patch).not.toHaveBeenCalled();
  });

  it('restores the saved selection and shows owned error copy when saving fails', async () => {
    transport.patch.mockResolvedValueOnce(
      jsonResponse(false, { detail: 'PRIVATE PROVIDER DETAIL' }),
    );
    const user = userEvent.setup();
    mount();
    const saturday = await screen.findByRole('checkbox', { name: 'Saturday' });
    await user.click(saturday);
    await waitFor(() => expect(saturday).not.toBeChecked());
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByText('PRIVATE PROVIDER DETAIL')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Monday' })).toBeChecked();
  });
});
