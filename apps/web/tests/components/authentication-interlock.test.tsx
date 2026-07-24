import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AuthenticationInterlockProvider,
  useAuthenticationRecovery,
  useAuthenticationInterlock,
} from '../../src/components/authentication-interlock';
import { unwrap, useApiMutation } from '../../src/lib/query';
import { problemResponse } from '../support/query';

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

/** A user-intent control that requests authentication for an unsafe, cross-origin return path. */
function ProtectedActionWithUnsafeReturn(): JSX.Element {
  const { requireAuthentication } = useAuthenticationInterlock();
  return (
    <button
      type="button"
      onClick={() => {
        requireAuthentication('//evil.example');
      }}
    >
      Trigger unsafe redirect
    </button>
  );
}

/** A representative foreground mutation that discovers its session is unavailable. */
function ProtectedMutation(): JSX.Element {
  const mutation = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          Promise.resolve(
            problemResponse('private session diagnostic', 401, 'unauthorized') as never,
          ),
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
            Promise.resolve(
              problemResponse('private session diagnostic', 401, 'unauthorized') as never,
            ),
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

const originalLocation = window.location;

/** Replace `window.location` with a stub whose `assign` is spy-able (jsdom's own is not). */
function stubLocationAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: originalLocation.origin, assign },
  });
  return assign;
}

/** Restore the real `window.location` after a test that called {@link stubLocationAssign}. */
function restoreLocation(): void {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
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

  it('continues to sign-in with the exact protected path preserved', () => {
    const assign = stubLocationAssign();

    render(
      <AuthenticationInterlockProvider>
        <ProtectedAction />
      </AuthenticationInterlockProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to continue' }));

    expect(assign).toHaveBeenCalledWith(
      '/sign-in?callbackURL=%2Fexports%2F01JEXPORT%3Ffrom%3Demail',
    );
    restoreLocation();
  });

  it('falls back to /today rather than following a cross-origin return path', () => {
    const assign = stubLocationAssign();

    render(
      <AuthenticationInterlockProvider>
        <ProtectedActionWithUnsafeReturn />
      </AuthenticationInterlockProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger unsafe redirect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to continue' }));

    expect(assign).toHaveBeenCalledWith('/sign-in?callbackURL=%2Ftoday');
    restoreLocation();
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
