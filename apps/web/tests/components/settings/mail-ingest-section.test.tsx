/**
 * Behavior tests for the email-to-task enablement section.
 *
 * @remarks
 * The section is the ONLY write surface for `config.emailToTask` — the strictly-opt-in
 * switch the ingest sweep reads. The critical behaviors: enabling submits BOTH fields
 * (`enabled` + an explicit numeric threshold — no hidden default) while preserving every
 * sibling config key this row doesn't manage, and disabling removes the key entirely
 * rather than writing `enabled: false` noise.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { patchIntegration } = vi.hoisted(() => ({
  patchIntegration: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': { integrations: { ':id': { $patch: patchIntegration } } },
      },
    },
  },
}));

import { MailIngestSection } from '../../../src/components/settings/mail-ingest-section';

/** A `Response`-like stub whose `ok`/`json()` the query layer reads. */
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** A connected Gmail integration row with sibling config keys the section must preserve. */
function gmailIntegration(over: Record<string, unknown> = {}): never {
  return {
    id: 'intg_1',
    organizationId: 'org_1',
    provider: 'gmail',
    pattern: 'connector',
    roles: ['signal'],
    status: 'connected',
    connection: { account: 'ada@example.com' },
    config: { teamId: 'team_9', listIds: ['a'] },
    syncMode: 'mirror',
    writeBack: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as never;
}

function renderSection(integration: never): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MailIngestSection orgId="org_1" canManage integrations={[integration]} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MailIngestSection', () => {
  it('enabling submits {enabled, threshold} and preserves sibling config keys', async () => {
    patchIntegration.mockResolvedValue(jsonResponse({ id: 'intg_1' }));
    renderSection(gmailIntegration());

    // Pick a non-default sensitivity first, then enable.
    fireEvent.change(screen.getByLabelText('Suggestion sensitivity'), {
      target: { value: '70' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    await waitFor(() => {
      expect(patchIntegration).toHaveBeenCalledTimes(1);
    });
    expect(patchIntegration).toHaveBeenCalledWith({
      param: { orgId: 'org_1', id: 'intg_1' },
      json: {
        config: {
          teamId: 'team_9',
          listIds: ['a'],
          emailToTask: { enabled: true, threshold: 70 },
        },
      },
    });
  });

  it('disabling removes the emailToTask key entirely (no enabled:false noise)', async () => {
    patchIntegration.mockResolvedValue(jsonResponse({ id: 'intg_1' }));
    renderSection(
      gmailIntegration({
        config: { teamId: 'team_9', emailToTask: { enabled: true, threshold: 50 } },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    await waitFor(() => {
      expect(patchIntegration).toHaveBeenCalledTimes(1);
    });
    const body = patchIntegration.mock.calls[0]?.[0] as {
      json: { config: Record<string, unknown> };
    };
    expect(body.json.config['emailToTask']).toBeUndefined();
    expect(body.json.config['teamId']).toBe('team_9'); // siblings preserved
  });

  it('renders nothing when the org has no connected mail integration', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MailIngestSection orgId="org_1" canManage integrations={[]} />
      </QueryClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });
});
