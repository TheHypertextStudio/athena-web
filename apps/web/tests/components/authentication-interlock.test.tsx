import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AuthenticationInterlockProvider,
  useAuthenticationRecovery,
  useAuthenticationInterlock,
} from '../../src/components/authentication-interlock';
import { unwrap, useApiMutation } from '../../src/lib/query';

/** A user-intent control that requests authentication for one protected deep link. */
function ProtectedAction(): JSX.Element {
  const { requireAuthentication } = useAuthenticationInterlock();
  return (
    <button
      type="button"
      onClick={() => {
        requireAuthentication('/exports/01JEXPORT?from=email');
      }}
    >
      Download export
    </button>
  );
}

/** A representative foreground mutation that discovers its session is unavailable. */
function ProtectedMutation(): JSX.Element {
  const mutation = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ code: 'unauthorized' }),
          }),
        'Could not save.',
      ),
  });
  return (
    <button
      type="button"
      onClick={() => {
        mutation.mutate(undefined);
      }}
    >
      Save changes
    </button>
  );
}

/** A direct user action outside TanStack Mutation that still receives the auth recovery contract. */
function DirectProtectedAction(): JSX.Element {
  const recoverAuthentication = useAuthenticationRecovery();

  async function run(): Promise<void> {
    try {
      await recoverAuthentication(() =>
        unwrap(
          () =>
            Promise.resolve({
              ok: false,
              status: 401,
              json: () => Promise.resolve({ code: 'unauthorized' }),
            }),
          'Could not connect.',
        ),
      );
    } catch {
      // The original error is intentionally rethrown for local cleanup after opening the interlock.
    }
  }

  return (
    <button
      type="button"
      onClick={() => {
        void run();
      }}
    >
      Connect account
    </button>
  );
}

afterEach(cleanup);

describe('AuthenticationInterlockProvider', () => {
  it('keeps the dialog open when Escape is pressed', () => {
    render(
      <AuthenticationInterlockProvider>
        <ProtectedAction />
      </AuthenticationInterlockProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

    const dialog = screen.getByRole('dialog');
    expect(screen.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in to continue' })).toBeVisible();

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('opens for a user-initiated mutation with code unauthorized', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <AuthenticationInterlockProvider>
        <QueryClientProvider client={client}>
          <ProtectedMutation />
        </QueryClientProvider>
      </AuthenticationInterlockProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeVisible();
    });
    client.clear();
  });

  it('opens for an imperative user action that is not a TanStack mutation', async () => {
    render(
      <AuthenticationInterlockProvider>
        <DirectProtectedAction />
      </AuthenticationInterlockProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeVisible();
    });
  });
});
