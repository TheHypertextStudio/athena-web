/**
 * Behavior tests for the onboarding orchestrator's create-then-connect flow.
 *
 * @remarks
 * The architectural promise: the workspace is created when the user *enters* the connect step
 * (not at the very end), so connect has a real org to mirror work into. These tests pin that
 * contract for both forks and both exits:
 *
 * - **Personal fork**: "Just me" → welcome → create the personal space (auto-named, no org-name
 *   prompt) → land on the live connect step bound to the new org id → "Skip for now" routes into
 *   that org's My Work. Back-nav disappears once the org exists (the user is committed).
 * - **Team fork**: "My team" → name → vocabulary → create the org → connect → enter.
 * - A failed create keeps the user on the setup step and shows the server's message rather than
 *   advancing to a connect step with no org behind it.
 *
 * The RPC client, auth session, and router are mocked so the flow is asserted without a live API
 * or real navigation. The connect step's own create/import calls are not exercised here (that is
 * covered in `onboarding-step-connect.test.tsx`); these tests drive the orchestrator only.
 */
import type { PublicConfigOut } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '../../../src/lib/query-keys';

// Hoisted so the mock factories (which Vitest lifts above imports) can reference them.
const { push, orgPost } = vi.hoisted(() => ({ push: vi.fn(), orgPost: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('../../../src/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'u1', name: 'Ada Lovelace' } } }),
}));

vi.mock('../../../src/lib/api', () => ({
  api: { v1: { orgs: { $post: orgPost } } },
}));

import OnboardingPage from '../../../src/app/onboarding/page';

/** A `Response`-like stub whose `ok`/`json()` the page reads. */
function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: async () => body } as Response;
}

/**
 * Render the page with a local-mode public config pre-seeded, so the connect step's
 * `usePublicConfig` resolves from cache (mock mode ⇒ every provider live) without a fetch.
 */
function renderPage(ui: ReactElement): ReturnType<typeof render> {
  const config: PublicConfigOut = {
    appMode: 'local',
    oauthProviders: [],
    connectors: [],
    mcpUrl: null,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.publicConfig(), config);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  push.mockReset();
  orgPost.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('OnboardingPage — personal fork', () => {
  it('creates the personal space on entering connect, then Skip routes into My Work', async () => {
    orgPost.mockResolvedValue(
      jsonResponse(true, { organization: { id: 'org_personal', name: "Ada's space" } }),
    );
    renderPage(<OnboardingPage />);

    // Step 1: choose "Just me" — no org-name prompt appears for the personal fork.
    fireEvent.click(screen.getByText('Just me'));
    expect(screen.queryByLabelText(/name/i)).toBeNull();

    // Leaving the welcome beat creates the personal space (auto-named after the user).
    fireEvent.click(screen.getByRole('button', { name: 'Create your space' }));
    await waitFor(() => {
      expect(orgPost).toHaveBeenCalledTimes(1);
    });
    expect(orgPost).toHaveBeenCalledWith({
      json: expect.objectContaining({ isPersonal: true, name: "Ada's space" }),
    });

    // We are now on the live connect step, bound to the created org.
    await waitFor(() => {
      expect(screen.getByText('Google Tasks')).toBeTruthy();
    });
    // Committed: back navigation is gone once the workspace exists.
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();

    // Skipping routes straight into Home (matches sign-in's landing).
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(push).toHaveBeenCalledWith('/today');
  });

  it('keeps the user on the setup step and shows the error when create fails', async () => {
    orgPost.mockResolvedValue(jsonResponse(false, { detail: 'Workspace limit reached.' }));
    renderPage(<OnboardingPage />);

    fireEvent.click(screen.getByText('Just me'));
    fireEvent.click(screen.getByRole('button', { name: 'Create your space' }));

    await waitFor(() => {
      expect(screen.getByText('Workspace limit reached.')).toBeTruthy();
    });
    // The connect step never appeared, and nothing navigated.
    expect(screen.queryByText('Google Tasks')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('OnboardingPage — team fork', () => {
  it('walks name → vocabulary → create, then connect → enter routes into Home', async () => {
    orgPost.mockResolvedValue(
      jsonResponse(true, { organization: { id: 'org_team', name: 'Acme' } }),
    );
    renderPage(<OnboardingPage />);

    // Step 1: choose the team fork.
    fireEvent.click(screen.getByText('My team or company'));

    // Step 2: name the org.
    const nameField = screen.getByLabelText(/name/i);
    fireEvent.change(nameField, { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 3: vocabulary → leaving it creates the org.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create workspace' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() => {
      expect(orgPost).toHaveBeenCalledTimes(1);
    });
    expect(orgPost).toHaveBeenCalledWith({
      json: expect.objectContaining({ isPersonal: false, name: 'Acme' }),
    });

    // Connect step is live and bound to the new org.
    await waitFor(() => {
      expect(screen.getByText('Linear')).toBeTruthy();
    });

    // The primary action enters the workspace.
    fireEvent.click(screen.getByRole('button', { name: 'Continue without connecting' }));
    expect(push).toHaveBeenCalledWith('/today');
  });
});
