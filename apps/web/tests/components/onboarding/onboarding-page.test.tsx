/**
 * Behavior tests for the onboarding orchestrator's create-then-connect flow.
 *
 * @remarks
 * The architectural promise: the workspace is created when the user *enters* the connect step
 * (not at the very end), so connect has a real org to mirror work into. These tests pin that
 * contract for both forks and both exits:
 *
 * - **Personal fork**: "Just me" creates the personal space (auto-named, no org-name prompt), then
 *   lands on the live connect step bound to the new org id. "Skip for now" retains the starter handoff, whose skip enters Home. Back-nav disappears once the org exists (the user is committed).
 * - **Team fork**: "My team" → name/create → connect → enter with standard terminology.
 * - A failed create keeps the user on the setup step and shows the server's message rather than
 *   advancing to a connect step with no org behind it.
 *
 * The RPC client, auth session, and router are mocked so the flow is asserted without a live API
 * or real navigation. The connect step's own create/import calls are not exercised here (that is
 * covered in `onboarding-step-connect.test.tsx`); these tests drive the orchestrator only.
 */
import type { PublicConfigOut } from '@docket/identity-access/public-config-contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '../../../src/lib/query-keys';
import { AuthenticationInterlockProvider } from '../../../src/components/authentication-interlock';

// Hoisted so the mock factories (which Vitest lifts above imports) can reference them.
const { push, orgPost, listUserPasskeys, addPasskey } = vi.hoisted(() => ({
  push: vi.fn(),
  orgPost: vi.fn(),
  listUserPasskeys: vi.fn(),
  addPasskey: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('../../../src/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'u1', name: 'Ada Lovelace' } } }),
  passkey: { addPasskey },
}));

vi.mock('../../../src/lib/api', () => ({
  api: { v1: { orgs: { $post: orgPost }, me: { passkeys: { $get: listUserPasskeys } } } },
}));

import OnboardingPage from '../../../src/app/onboarding/page';
import { jsonResponse } from '../../support/http';

/**
 * Render the page with a local-mode public config pre-seeded, so the connect step's
 * `usePublicConfig` resolves from cache (mock mode ⇒ every provider live) without a fetch.
 */
function renderPage(
  ui: ReactElement,
  appMode: PublicConfigOut['appMode'] = 'local',
): ReturnType<typeof render> {
  const config: PublicConfigOut = {
    appMode,
    oauthProviders: [],
    appleAppClientId: null,
    passkeyRpId: null,
    legacyPasskeyRpId: null,
    googleServerClientId: null,
    connectors: [],
    mcpUrl: null,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.publicConfig(), config);
  return render(
    <AuthenticationInterlockProvider>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </AuthenticationInterlockProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  push.mockReset();
  orgPost.mockReset();
  addPasskey.mockReset();
  // Default: the account already has a passkey, so the optional passkey beat stays off and connect
  // advances directly to the optional starter handoff.
  listUserPasskeys.mockReset();
  listUserPasskeys.mockResolvedValue(jsonResponse(true, { items: [{ id: 'pk_1' }] }));
});

afterEach(() => {
  cleanup();
});

describe('OnboardingPage — personal fork', () => {
  it('creates the personal space on entering connect, then offers optional starters before Home', async () => {
    orgPost.mockResolvedValue(
      jsonResponse(true, {
        organization: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: "Ada's space" },
      }),
    );
    renderPage(<OnboardingPage />);

    // Choosing "Just me" creates the personal workspace without a separate welcome action.
    fireEvent.click(screen.getByText('Just me'));
    expect(screen.queryByLabelText(/name/i)).toBeNull();
    await waitFor(() => {
      expect(orgPost).toHaveBeenCalledTimes(1);
    });
    expect(orgPost).toHaveBeenCalledWith({
      json: expect.objectContaining({ isPersonal: true, intent: 'personal' }),
    });

    // We are now on the live connect step, bound to the created org.
    await waitFor(() => {
      expect(screen.getByText('Google Tasks')).toBeTruthy();
    });
    expect(screen.getByRole('heading', { name: 'Bring in your work' })).toHaveFocus();
    // Committed: back navigation is gone once the workspace exists.
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();

    // Connecting is optional, and starting work remains available without it.
    fireEvent.click(screen.getByRole('button', { name: 'Continue without connecting' }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Choose starting work' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(push).toHaveBeenCalledWith('/today');
  });

  it('keeps the user on the setup step and shows safe copy when create fails', async () => {
    orgPost.mockResolvedValue(jsonResponse(false, { detail: 'Workspace limit reached.' }));
    renderPage(<OnboardingPage />);

    fireEvent.click(screen.getByText('Just me'));

    await waitFor(() => {
      expect(
        screen.getByText('Could not finish setting up your workspace. Please try again.'),
      ).toBeTruthy();
    });
    // The connect step never appeared, and nothing navigated.
    expect(screen.queryByText('Google Tasks')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('OnboardingPage — team fork', () => {
  it('creates from the name step with standard terminology, then offers the ordinary gallery', async () => {
    orgPost.mockResolvedValue(
      jsonResponse(true, { organization: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', name: 'Acme' } }),
    );
    renderPage(<OnboardingPage />);

    // Step 1: choose the team fork.
    fireEvent.click(screen.getByText('My team or company'));

    // Step 2: naming the org is now the complete creation form.
    const nameField = screen.getByLabelText(/name/i);
    fireEvent.change(nameField, { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() => {
      expect(orgPost).toHaveBeenCalledTimes(1);
    });
    expect(orgPost).toHaveBeenCalledWith({
      json: expect.objectContaining({
        isPersonal: false,
        name: 'Acme',
        vocabulary: 'startup',
      }),
    });
    expect(screen.queryByText(/speaks your world/i)).toBeNull();

    // Connect step is live and bound to the new org.
    await waitFor(() => {
      expect(screen.getByText('Linear')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Continue without connecting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose starting work' }));
    expect(push).toHaveBeenCalledWith(
      '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAW/work-templates/gallery?fork=startup',
    );
    expect(orgPost).toHaveBeenCalledTimes(1);
    expect(orgPost.mock.calls[0]?.[0].json.intent).toBe('startup');
  });
});

describe('OnboardingPage — passkey enrollment (social sign-up)', () => {
  it('offers a passkey beat after connect when the account has none, then enrolls before offering starters', async () => {
    // A social sign-up: no passkey yet, so the optional enrollment beat is appended.
    listUserPasskeys.mockResolvedValue(jsonResponse(true, { items: [] }));
    addPasskey.mockResolvedValue({ data: { id: 'pk_new' }, error: null });
    orgPost.mockResolvedValue(
      jsonResponse(true, {
        organization: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: "Ada's space" },
      }),
    );
    renderPage(<OnboardingPage />);

    fireEvent.click(screen.getByText('Just me'));

    // On the connect step, leaving it now advances to the passkey beat instead of navigating.
    await waitFor(() => {
      expect(screen.getByText('Google Tasks')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue without connecting' }));

    // The passkey step appears; enrolling runs the add ceremony, then enters the workspace.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add a passkey' })).toBeTruthy();
    });
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));

    await waitFor(() => {
      expect(addPasskey).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Choose starting work' })).toBeVisible();
    });
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(push).toHaveBeenCalledWith('/today');
  });

  it('lets the user skip the passkey beat and then skip starters into Home', async () => {
    listUserPasskeys.mockResolvedValue(jsonResponse(true, { items: [] }));
    orgPost.mockResolvedValue(
      jsonResponse(true, {
        organization: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: "Ada's space" },
      }),
    );
    renderPage(<OnboardingPage />);

    fireEvent.click(screen.getByText('Just me'));

    await waitFor(() => {
      expect(screen.getByText('Google Tasks')).toBeTruthy();
    });
    // Skip the tool connection → passkey beat.
    fireEvent.click(screen.getByRole('button', { name: 'Continue without connecting' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add a passkey' })).toBeTruthy();
    });

    // Passkey skip preserves the manual starter choice, with no add ceremony.
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByRole('button', { name: 'Choose starting work' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(push).toHaveBeenCalledWith('/today');
    expect(addPasskey).not.toHaveBeenCalled();
  });
  it('keeps a failed passkey ceremony retryable and clears its error when skipping to starters', async () => {
    listUserPasskeys.mockResolvedValue(jsonResponse(true, { items: [] }));
    addPasskey.mockResolvedValue({ error: { message: 'private authenticator failure' } });
    orgPost.mockResolvedValue(
      jsonResponse(true, {
        organization: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: "Ada's space" },
      }),
    );
    renderPage(<OnboardingPage />);
    fireEvent.click(screen.getByText('Just me'));
    await screen.findByText('Google Tasks');
    fireEvent.click(screen.getByRole('button', { name: 'Continue without connecting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('private authenticator failure')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a passkey' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Choose starting work' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByRole('button', { name: 'Choose starting work' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('OnboardingPage — manual starter handoff', () => {
  it('hands nonprofit starting work to the ordinary gallery only after a workspace exists', async () => {
    orgPost.mockResolvedValue(
      jsonResponse(true, { organization: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAX', name: 'Neighbors' } }),
    );
    renderPage(<OnboardingPage />, 'production');
    expect(screen.queryByRole('button', { name: 'Choose starting work' })).toBeNull();
    fireEvent.click(screen.getByText('A nonprofit'));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Neighbors' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await screen.findByText('Google Tasks');
    fireEvent.click(screen.getByRole('button', { name: 'Continue without connecting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose starting work' }));
    expect(push).toHaveBeenCalledWith(
      '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAX/work-templates/gallery?fork=nonprofit',
    );
  });
});
