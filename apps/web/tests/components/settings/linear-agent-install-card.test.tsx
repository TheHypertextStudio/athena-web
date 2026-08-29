/**
 * Behavior tests for the one-click Athena installation ceremony in Linear.
 *
 * @remarks
 * This is a workspace-level app install, not the ordinary per-user Linear connector. These tests
 * keep the two paths separate and pin the exact browser redirect that starts the Agent OAuth flow.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeQueryWrapper, okResponse } from '../../support/query';

const { integrationsGet, installGet } = vi.hoisted(() => ({
  integrationsGet: vi.fn(),
  installGet: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          integrations: {
            $get: integrationsGet,
            'linear-agent': { install: { $get: installGet } },
          },
        },
      },
    },
  },
}));

vi.mock('../../../src/lib/app-location', () => ({
  useAppSearchParams: () => new URLSearchParams(),
}));

import { LinearAgentInstallCard } from '../../../src/components/settings/linear-agent-install-card';

const ORG_ID = '01KY1N724K30F3MCPQMRC7GVD3';
const INSTALL_URL =
  'https://linear.app/oauth/authorize?client_id=athena&actor=app&state=signed-install-state';
const originalLocation = window.location;
let assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  integrationsGet.mockResolvedValue(okResponse({ items: [] }));
  installGet.mockResolvedValue(okResponse({ url: INSTALL_URL }));
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: originalLocation.origin, assign },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('LinearAgentInstallCard', () => {
  it('starts the workspace Agent install and navigates to the signed Linear URL', async () => {
    const { wrapper } = makeQueryWrapper();
    render(<LinearAgentInstallCard orgId={ORG_ID} canManage />, { wrapper });

    const button = await screen.findByRole('button', { name: 'Install' });
    expect(screen.getAllByRole('button', { name: 'Install' })).toHaveLength(1);
    fireEvent.click(button);

    await waitFor(() => {
      expect(installGet).toHaveBeenCalledWith({ param: { orgId: ORG_ID } });
      expect(assign).toHaveBeenCalledWith(INSTALL_URL);
    });
  });

  it('does not expose the workspace install action to a member without manage access', () => {
    const { wrapper } = makeQueryWrapper();
    render(<LinearAgentInstallCard orgId={ORG_ID} canManage={false} />, { wrapper });

    expect(screen.queryByText('Athena as a Linear Agent')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });

  it('shows the installed workspace without offering a duplicate install', async () => {
    integrationsGet.mockResolvedValue(
      okResponse({
        items: [
          {
            id: '01M04MDQ20DB0N3QCN0AA9KQKN',
            organizationId: ORG_ID,
            provider: 'linear_agent',
            pattern: 'agent',
            roles: ['work'],
            connection: {
              externalWorkspaceId: 'linear-hypertext-studio',
              externalWorkspaceName: 'Hypertext Studio',
            },
            status: 'connected',
            config: {},
            externalAccountId: null,
            syncMode: 'mirror',
            writeBack: false,
            lastSyncStatus: null,
            lastSyncedAt: null,
            lastError: null,
            lastErrorAt: null,
            lastErrorKind: null,
            syncCadenceMinutes: null,
            createdAt: '2026-08-29T00:00:00.000Z',
          },
        ],
      }),
    );
    const { wrapper } = makeQueryWrapper();
    render(<LinearAgentInstallCard orgId={ORG_ID} canManage />, { wrapper });

    expect(await screen.findByText('Installed to Hypertext Studio')).toBeVisible();
    expect(screen.getByText('Installed')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(installGet).not.toHaveBeenCalled();
  });
});
