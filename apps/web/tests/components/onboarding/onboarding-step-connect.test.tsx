/**
 * Behavior tests for the onboarding connect-and-mirror step.
 *
 * @remarks
 * This is the pivotal onboarding screen: the workspace already exists, and each provider card
 * genuinely connects (create integration → import) and reports how many items it mirrored. The
 * tests pin the user-visible contract the directive promises and the verifier walks live:
 *
 * - all three onboarding sources (Google Calendar, Google Tasks, Linear) render when live;
 * - clicking Connect runs the create+import pair and surfaces the mirrored count;
 * - several sources can be connected, and the running mirrored total is reported upward;
 * - in production a provider with no OAuth wired shows a disabled "Available soon" state
 *   instead of a dead button.
 *
 * The component's two network calls are injected as props (mirroring the real RPC signatures),
 * so these assert real behavior without touching the live API. `NEXT_PUBLIC_APP_MODE` is stubbed
 * per-test because it gates whether the mock backs every provider (dev) or only OAuth-wired ones
 * (prod).
 */
import type { PublicConfigOut } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  StepConnect,
  type OnboardingProvider,
} from '../../../src/components/onboarding/step-connect';
import { queryKeys } from '../../../src/lib/query-keys';

afterEach(() => {
  cleanup();
});

/** Local/mock config: every provider is connectable without OAuth (mirrors `APP_MODE=local`). */
const LOCAL_CONFIG: PublicConfigOut = {
  appMode: 'local',
  oauthProviders: [],
  connectors: [],
  mcpUrl: null,
};

/**
 * Render `ui` with the public config pre-seeded, so `usePublicConfig` resolves synchronously from
 * the cache (no fetch) — availability now comes from `/v1/config`, not the environment.
 */
function renderStep(config: PublicConfigOut, ui: ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.publicConfig(), config);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** A `Response`-like stub whose `ok`/`json()` the component reads. */
function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: async () => body } as Response;
}

/** A create-integration stub that returns a fixed integration id. */
function createOk(
  id = 'integ_1',
): (orgId: string, provider: OnboardingProvider) => Promise<Response> {
  return vi.fn(async () => jsonResponse(true, { id, provider: 'gtasks' }));
}

/** An import stub that returns `count` mirrored task items. */
function importOk(count: number): (orgId: string, integrationId: string) => Promise<Response> {
  const items = Array.from({ length: count }, (_, i) => ({ id: `task_${i}` }));
  return vi.fn(async () => jsonResponse(true, { items }));
}

describe('StepConnect (dev / mock mode)', () => {
  it('renders all three onboarding sources with a Connect affordance', () => {
    renderStep(
      LOCAL_CONFIG,
      <StepConnect orgId="org_1" createIntegration={createOk()} importWork={importOk(0)} />,
    );

    expect(screen.getByText('Google Calendar')).toBeTruthy();
    expect(screen.getByText('Google Tasks')).toBeTruthy();
    expect(screen.getByText('Linear')).toBeTruthy();

    // Every live provider offers a real Connect button (no dead/disabled affordances).
    expect(screen.getByRole('button', { name: 'Connect Google Calendar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Google Tasks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Linear' })).toBeTruthy();
  });

  it('connects a source: runs create+import and shows the mirrored count', async () => {
    const createIntegration = createOk('integ_gt');
    const importWork = importOk(3);
    renderStep(
      LOCAL_CONFIG,
      <StepConnect orgId="org_1" createIntegration={createIntegration} importWork={importWork} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect Google Tasks' }));

    await waitFor(() => {
      expect(screen.getByText('Mirrored 3 items from Google Tasks.')).toBeTruthy();
    });
    // The create call ran for the clicked provider, and the import ran for the new integration.
    expect(createIntegration).toHaveBeenCalledWith('org_1', 'gtasks');
    expect(importWork).toHaveBeenCalledWith('org_1', 'integ_gt');
  });

  it('reports the running mirrored total upward as sources are connected', async () => {
    const onMirroredTotalChange = vi.fn();
    renderStep(
      LOCAL_CONFIG,
      <StepConnect
        orgId="org_1"
        createIntegration={createOk()}
        importWork={importOk(2)}
        onMirroredTotalChange={onMirroredTotalChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect Linear' }));
    await waitFor(() => {
      expect(screen.getByText('Mirrored 2 items from Linear.')).toBeTruthy();
    });
    await waitFor(() => {
      expect(onMirroredTotalChange).toHaveBeenLastCalledWith(2);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Connect Google Calendar' }));
    await waitFor(() => {
      expect(screen.getByText('Mirrored 2 items from Google Calendar.')).toBeTruthy();
    });
    // Two sources at 2 items each ⇒ the upward total is the sum.
    await waitFor(() => {
      expect(onMirroredTotalChange).toHaveBeenLastCalledWith(4);
    });
  });

  it('stays honest when a re-import mirrors nothing new', async () => {
    renderStep(
      LOCAL_CONFIG,
      <StepConnect orgId="org_1" createIntegration={createOk()} importWork={importOk(0)} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect Linear' }));
    await waitFor(() => {
      expect(screen.getByText('Linear is connected — nothing new to bring in.')).toBeTruthy();
    });
  });

  it('surfaces a problem message and offers a retry when connecting fails', async () => {
    const createIntegration = vi.fn(async () =>
      jsonResponse(false, { detail: 'Provider is unavailable.' }),
    );
    renderStep(
      LOCAL_CONFIG,
      <StepConnect orgId="org_1" createIntegration={createIntegration} importWork={importOk(1)} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect Google Tasks' }));
    await waitFor(() => {
      expect(screen.getByText('Provider is unavailable.')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Retry connecting Google Tasks' })).toBeTruthy();
  });
});

describe('StepConnect (prod / OAuth gating)', () => {
  it('disables providers whose OAuth is not wired (no dead buttons)', () => {
    // Production mode with no configured connectors ⇒ nothing is connectable.
    const prodConfig: PublicConfigOut = {
      appMode: 'production',
      oauthProviders: [],
      connectors: [],
      mcpUrl: null,
    };
    renderStep(
      prodConfig,
      <StepConnect orgId="org_1" createIntegration={createOk()} importWork={importOk(1)} />,
    );

    expect(screen.queryByRole('button', { name: /Connect/ })).toBeNull();
    expect(screen.getAllByText('Available soon')).toHaveLength(3);
  });

  it('offers only the providers whose connector is configured server-side', () => {
    // Production with Google configured ⇒ its connectors (calendar, gtasks) are live; Linear is not.
    const prodConfig: PublicConfigOut = {
      appMode: 'production',
      oauthProviders: ['google'],
      connectors: ['drive', 'gmail', 'calendar', 'gtasks'],
      mcpUrl: null,
    };
    renderStep(
      prodConfig,
      <StepConnect orgId="org_1" createIntegration={createOk()} importWork={importOk(1)} />,
    );

    expect(screen.getByRole('button', { name: 'Connect Google Calendar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Google Tasks' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Linear' })).toBeNull();
    expect(screen.getAllByText('Available soon')).toHaveLength(1);
  });
});
