import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { exportOptionsGet, exportGet, exportsGet, exportsPost, reauth } = vi.hoisted(() => ({
  exportOptionsGet: vi.fn(),
  exportGet: vi.fn(),
  exportsGet: vi.fn(),
  exportsPost: vi.fn(),
  reauth: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        account: {
          exports: {
            $get: exportsGet,
            $post: exportsPost,
            options: { $get: exportOptionsGet },
            ':exportId': { $get: exportGet },
          },
        },
      },
    },
  },
}));

vi.mock('../../../src/components/settings/use-reauth', () => ({ useReauth: () => reauth }));

import { ExportDataTab } from '../../../src/components/settings/export-data-tab';

/** A successful typed-RPC response, sufficient for the shared query wrapper. */
function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

const WORKSPACE_ONE = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const WORKSPACE_TWO = '01BX5ZZKBKACTAV9WEVGEMMVA';

function readyExport() {
  return {
    id: '01D78XYFJ1PRM1WPBCBT3VHMNV',
    status: 'ready' as const,
    origin: 'manual' as const,
    scope: {
      categories: ['account', 'personal', 'workspaces'] as const,
      workspaces: [
        { id: WORKSPACE_ONE, name: 'Personal' },
        { id: WORKSPACE_TWO, name: 'Design' },
      ],
      allWorkspaces: false,
    },
    requestedAt: '2026-07-12T00:00:00.000Z',
    readyAt: '2026-07-12T00:01:00.000Z',
    expiresAt: '2026-07-26T00:00:00.000Z',
    downloadUrl: '/v1/me/account/exports/01D78XYFJ1PRM1WPBCBT3VHMNV/file',
  };
}

function renderTab(focusedExportId?: string): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ExportDataTab focusedExportId={focusedExportId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  exportOptionsGet.mockReset().mockResolvedValue(
    okResponse({
      deliveryEmail: 'ada@example.com',
      workspaces: [
        { id: WORKSPACE_ONE, name: 'Personal' },
        { id: WORKSPACE_TWO, name: 'Design' },
      ],
    }),
  );
  exportsGet.mockReset().mockResolvedValue(okResponse({ items: [readyExport()] }));
  exportGet.mockReset().mockResolvedValue(okResponse(readyExport()));
  exportsPost.mockReset().mockResolvedValue(okResponse(readyExport()));
  reauth.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('ExportDataTab', () => {
  it('makes selected data, delivery, and a ready export understandable', async () => {
    renderTab();

    expect(await screen.findByRole('heading', { name: '1. Choose data to include' })).toBeVisible();
    expect(screen.getByText('ada@example.com')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Account information/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Personal Docket data/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Personal' })).toBeChecked();
    expect(screen.getByText('Your export is ready')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download your data' })).toBeVisible();
  });

  it('sends the selected categories and workspaces when creating an export', async () => {
    renderTab();

    await screen.findByRole('button', { name: 'Create export' });
    fireEvent.click(screen.getByRole('checkbox', { name: /Personal Docket data/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create export' }));

    await waitFor(() => {
      expect(exportsPost).toHaveBeenCalledWith({
        json: { categories: ['account', 'workspaces'], workspaceIds: [WORKSPACE_ONE] },
      });
    });
  });

  it('pins the export linked from email even when it is absent from recent history', async () => {
    const emailExport = { ...readyExport(), id: '01H00000000000000000000000' };
    exportsGet.mockResolvedValue(okResponse({ items: [] }));
    exportGet.mockResolvedValue(okResponse(emailExport));
    renderTab(emailExport.id);

    expect(await screen.findByText('Your export is ready')).toBeVisible();
    expect(exportGet).toHaveBeenCalledWith({ param: { exportId: emailExport.id } });
  });

  it('explains when an export linked from email is no longer available', async () => {
    const missingExportId = '01H00000000000000000000000';
    exportGet.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ title: 'Export not found', code: 'not_found' }),
    });
    renderTab(missingExportId);

    expect(
      await screen.findByText(
        'This export is no longer available. You can create a new export below.',
      ),
    ).toBeVisible();
  });
});
