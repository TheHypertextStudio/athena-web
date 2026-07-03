/**
 * Behavior tests for {@link IntegrationConfigPanel} on a Linear integration.
 *
 * @remarks
 * Two things are new for Linear on this panel and are what these tests pin:
 *
 * - the team-mapping picker: each external Linear team (from `GET /:id/lists`) gets its own
 *   Docket-team select, defaulting to "Not synced", and saving sends the FULL current `config`
 *   (spread) plus the new `teamMappings` array — never a partial patch that would silently drop
 *   `config.listIds`/`defaultListId` (the PATCH endpoint wholesale-replaces `config`);
 * - the two-way write-scope 409: flipping to "Two-way" and saving, when the server rejects with
 *   the write-scope conflict, renders an inline re-auth notice with a "Re-authorize Linear"
 *   button wired to the caller's `onReauthorize`, rather than a bare error string.
 *
 * The RPC client is mocked so these assert real behavior without touching the live API.
 */
import {
  IntegrationId,
  OrganizationId,
  TeamId,
  type IntegrationOut,
  type TeamOut,
} from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the mock factory (lifted above imports) can reference them.
const { listsGet, integrationPatch } = vi.hoisted(() => ({
  listsGet: vi.fn(),
  integrationPatch: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          integrations: {
            ':id': {
              lists: { $get: listsGet },
              $patch: integrationPatch,
            },
          },
        },
      },
    },
  },
}));

import { IntegrationConfigPanel } from '../../../src/components/settings/integration-config-panel';

/** A `Response`-like stub whose `ok`/`json()` the panel reads. */
function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: async () => body } as Response;
}

/** The `json` body of a mocked RPC spy's Nth call (default: first). */
function nthJson(spy: ReturnType<typeof vi.fn>, n = 0): Record<string, unknown> {
  const call = spy.mock.calls[n] as unknown[] | undefined;
  if (!call) throw new Error('expected the RPC spy to have been called');
  return (call[0] as { json: Record<string, unknown> }).json;
}

const ORG_ID = OrganizationId.parse('0RG00000000000000000000001');
const INTEGRATION_ID = IntegrationId.parse('0CNCT000000000000000000001');
const TEAM_ENG_ID = TeamId.parse('TEAM0000000000000000000002');
const TEAM_OPS_ID = TeamId.parse('TEAM0000000000000000000003');

const ORG_TEAMS: readonly TeamOut[] = [
  { id: TEAM_ENG_ID, organizationId: ORG_ID, name: 'Engineering', key: 'ENG', triageEnabled: true },
  { id: TEAM_OPS_ID, organizationId: ORG_ID, name: 'Ops', key: 'OPS', triageEnabled: true },
];

const LINEAR_TEAMS = [
  { id: 'lin-team-eng', title: 'Engineering' },
  { id: 'lin-team-ops', title: 'Ops' },
];

/** A connected, read-only Linear integration with no team mappings yet. */
function linearIntegration(overrides: Partial<IntegrationOut> = {}): IntegrationOut {
  return {
    id: INTEGRATION_ID,
    organizationId: ORG_ID,
    provider: 'linear',
    pattern: 'connector',
    roles: ['work'],
    connection: { account: 'mock-linear' },
    status: 'connected',
    config: {},
    externalAccountId: null,
    syncMode: 'mirror',
    writeBack: false,
    lastSyncStatus: null,
    lastSyncedAt: null,
    lastError: null,
    lastErrorAt: null,
    syncCadenceMinutes: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  listsGet.mockReset().mockResolvedValue(jsonResponse(true, { resources: LINEAR_TEAMS }));
  integrationPatch.mockReset();
});

afterEach(() => {
  cleanup();
});

function renderPanel(
  integration: IntegrationOut,
  overrides: Partial<Parameters<typeof IntegrationConfigPanel>[0]> = {},
) {
  const onReauthorize = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <IntegrationConfigPanel
        orgId={ORG_ID}
        integration={integration}
        teams={ORG_TEAMS}
        onReauthorize={onReauthorize}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { onReauthorize };
}

describe('IntegrationConfigPanel — Linear team-mapping picker', () => {
  it('renders one Docket-team select per Linear team, defaulting to "Not synced"', async () => {
    renderPanel(linearIntegration());

    await waitFor(() => {
      expect(listsGet).toHaveBeenCalled();
    });

    const engSelect = await screen.findByLabelText<HTMLSelectElement>(
      'Docket team for Engineering',
    );
    const opsSelect = screen.getByLabelText<HTMLSelectElement>('Docket team for Ops');
    expect(engSelect.value).toBe('');
    expect(opsSelect.value).toBe('');
    expect(screen.getAllByText('Not synced')).toHaveLength(2);
  });

  it('shows an honest empty state when the account genuinely has no teams (no dummy rows)', async () => {
    listsGet.mockResolvedValue(jsonResponse(true, { resources: [] }));
    renderPanel(linearIntegration());

    expect(await screen.findByText('No teams found for this account.')).toBeTruthy();
  });

  it('saves the full current config (spread) plus the new teamMappings — never a partial patch', async () => {
    integrationPatch.mockResolvedValue(
      jsonResponse(true, linearIntegration({ config: { defaultListId: 'keep-me' } })),
    );
    renderPanel(
      linearIntegration({
        // Pre-existing config this UI doesn't manage — must survive the save (wholesale-replace).
        config: { defaultListId: 'keep-me', pushNativeTasks: true },
      }),
    );

    const engSelect = await screen.findByLabelText('Docket team for Engineering');
    fireEvent.change(engSelect, { target: { value: TEAM_ENG_ID } });

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(integrationPatch).toHaveBeenCalledTimes(1);
    });
    const body = nthJson(integrationPatch);
    expect(body['writeBack']).toBe(false);
    expect(body['config']).toMatchObject({
      defaultListId: 'keep-me',
      pushNativeTasks: true,
      teamMappings: [{ externalTeamId: 'lin-team-eng', teamId: TEAM_ENG_ID }],
    });
  });

  it('omits an external team from teamMappings entirely when it stays "Not synced"', async () => {
    integrationPatch.mockResolvedValue(jsonResponse(true, linearIntegration()));
    renderPanel(linearIntegration());

    const engSelect = await screen.findByLabelText('Docket team for Engineering');
    fireEvent.change(engSelect, { target: { value: TEAM_ENG_ID } });
    // Ops stays unmapped.
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(integrationPatch).toHaveBeenCalledTimes(1);
    });
    const body = nthJson(integrationPatch);
    expect(body['config']).toMatchObject({
      teamMappings: [{ externalTeamId: 'lin-team-eng', teamId: TEAM_ENG_ID }],
    });
    // Ops must not appear at all — an external team absent from teamMappings is "not synced".
    const mappings = (body['config'] as { teamMappings: unknown[] }).teamMappings;
    expect(mappings).toHaveLength(1);
  });

  it('preselects an already-mapped team from `config.teamMappings`', async () => {
    renderPanel(
      linearIntegration({
        config: { teamMappings: [{ externalTeamId: 'lin-team-ops', teamId: TEAM_OPS_ID }] },
      }),
    );

    const opsSelect = await screen.findByLabelText<HTMLSelectElement>('Docket team for Ops');
    expect(opsSelect.value).toBe(TEAM_OPS_ID);
  });
});

describe('IntegrationConfigPanel — two-way write-scope re-auth', () => {
  it('renders no re-auth notice when read-only saves fail for an unrelated reason (no nagging)', async () => {
    integrationPatch.mockResolvedValue(jsonResponse(false, { detail: 'Something else broke.' }));
    renderPanel(linearIntegration());

    await waitFor(() => {
      expect(listsGet).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Something else broke.');
    expect(screen.queryByRole('button', { name: 'Re-authorize Linear' })).toBeNull();
  });

  it('shows the re-auth notice and a working "Re-authorize Linear" button on a 409 write-scope conflict', async () => {
    integrationPatch.mockResolvedValue(
      jsonResponse(false, {
        detail: 'Reconnect Linear to grant write access — two-way sync needs the write scope.',
      }),
    );
    const { onReauthorize } = renderPanel(linearIntegration());

    await waitFor(() => {
      expect(listsGet).toHaveBeenCalled();
    });

    // Flip to Two-way, then save.
    fireEvent.click(screen.getByRole('radio', { name: /Two-way/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('grant write access');

    const reauthButton = screen.getByRole('button', { name: 'Re-authorize Linear' });
    fireEvent.click(reauthButton);
    expect(onReauthorize).toHaveBeenCalledTimes(1);

    // The PATCH really did attempt writeBack: true (this is what triggers server-side scope gating).
    const body = nthJson(integrationPatch);
    expect(body['writeBack']).toBe(true);
  });
});
