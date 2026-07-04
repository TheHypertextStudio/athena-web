import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addPasskey, authFetch, push, signInPasskey } = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  authFetch: vi.fn(),
  push: vi.fn(),
  signInPasskey: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('../../../src/lib/auth-client', () => ({
  authClient: { $fetch: authFetch },
  passkey: { addPasskey },
  signIn: { passkey: signInPasskey },
}));

vi.mock('../../../src/app/(auth)/_components/oauth-buttons', () => ({
  OAuthButtons: () => null,
}));

vi.mock('../../../src/app/(auth)/_lib/webauthn', () => ({
  isWebAuthnSupported: () => true,
}));

import SignUpPage from '../../../src/app/(auth)/sign-up/page';

/** Drive step 1: enter name + email and request the code. */
function submitEmailStep(): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Lovelace' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue with email' }));
}

beforeEach(() => {
  addPasskey.mockReset();
  authFetch.mockReset();
  push.mockReset();
  signInPasskey.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('SignUpPage', () => {
  it('verifies the email before registering the passkey, then signs in', async () => {
    authFetch.mockImplementation((path: string) => {
      if (path === '/sign-up/request-code') return Promise.resolve({ data: { status: true } });
      if (path === '/sign-up/verify-code')
        return Promise.resolve({ data: { intent: 'signup-intent:tok' } });
      return Promise.resolve({});
    });
    addPasskey.mockResolvedValue({ error: null });
    signInPasskey.mockResolvedValue({ error: null });

    render(<SignUpPage />);

    submitEmailStep();

    // Advances to the code step.
    const codeInput = await screen.findByLabelText('Verification code');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create account' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/onboarding');
    });

    // The passkey is bound using the single-use intent from verify-code, and a session is minted.
    expect(authFetch).toHaveBeenCalledWith('/sign-up/request-code', expect.anything());
    expect(authFetch).toHaveBeenCalledWith('/sign-up/verify-code', expect.anything());
    expect(addPasskey).toHaveBeenCalledWith({
      name: 'ada@example.com',
      context: 'signup-intent:tok',
    });
    expect(signInPasskey).toHaveBeenCalledTimes(1);
  });

  it('surfaces a bad-code error and does not register a passkey', async () => {
    authFetch.mockImplementation((path: string) => {
      if (path === '/sign-up/request-code') return Promise.resolve({ data: { status: true } });
      if (path === '/sign-up/verify-code')
        return Promise.resolve({ error: { status: 400, message: 'That code is incorrect.' } });
      return Promise.resolve({});
    });

    render(<SignUpPage />);
    submitEmailStep();

    const codeInput = await screen.findByLabelText('Verification code');
    fireEvent.change(codeInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create account' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('That code is incorrect.');
    });
    expect(addPasskey).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
