/**
 * Regression tests for the marketing site's auth-aware calls to action.
 *
 * @remarks
 * Every CTA on the site used to hardcode "Sign in" / "Get started". Someone with a live session who
 * opened Docket landed on `/` and was told to authenticate — and the obvious click took them into
 * `/sign-in`, which is where the passkey prompt is armed. The public surface was funnelling
 * already-signed-in people into the auth flow, which is half of why Docket felt like it kept asking
 * for credentials it did not need.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useSession } = vi.hoisted(() => ({
  useSession: vi.fn(),
}));

vi.mock('../../src/lib/auth-client', () => ({ useSession }));

import {
  CtaBandActions,
  FooterEntryLink,
  HeaderActions,
  HeroActions,
} from '../../src/components/marketing/marketing-cta';

/** The shape Better Auth's `useSession` really returns, `error` included. */
function session(state: 'authenticated' | 'signed-out' | 'pending' | 'unreachable'): {
  data: unknown;
  isPending: boolean;
  error: { status: number } | null;
} {
  switch (state) {
    case 'authenticated':
      return { data: { user: { id: 'u1' } }, isPending: false, error: null };
    case 'signed-out':
      return { data: null, isPending: false, error: null };
    case 'pending':
      return { data: null, isPending: true, error: null };
    case 'unreachable':
      return { data: null, isPending: false, error: { status: 500 } };
  }
}

beforeEach(() => {
  useSession.mockReset();
});

afterEach(cleanup);

describe('marketing CTAs', () => {
  describe('when a session is live', () => {
    beforeEach(() => {
      useSession.mockReturnValue(session('authenticated'));
    });

    it('offers the header a way into the app instead of a sign-in', () => {
      render(<HeaderActions />);

      expect(screen.getByRole('link', { name: 'Open Docket' }).getAttribute('href')).toBe('/today');
      expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Get started' })).toBeNull();
    });

    it('replaces the hero conversion pair with the workspace', () => {
      render(<HeroActions />);

      expect(screen.getByRole('link', { name: 'Open Docket' }).getAttribute('href')).toBe('/today');
      expect(screen.queryByRole('link', { name: /Get started/ })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    });

    it('stops the closing band asking for another sign-up', () => {
      render(<CtaBandActions />);

      expect(screen.getByRole('link', { name: 'Open Docket' }).getAttribute('href')).toBe('/today');
      expect(screen.queryByRole('link', { name: /Get started/ })).toBeNull();
    });

    it('stops the footer offering the account they already have', () => {
      // The last place on the page that still said "Get started" to a signed-in reader.
      render(<FooterEntryLink className="link" />);

      expect(screen.getByRole('link', { name: 'Open Docket' }).getAttribute('href')).toBe('/today');
    });
  });

  describe('when the server confirms there is no session', () => {
    beforeEach(() => {
      useSession.mockReturnValue(session('signed-out'));
    });

    it('invites a visitor to sign in or start', () => {
      render(<HeaderActions />);

      expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in');
      expect(screen.getByRole('link', { name: 'Get started' }).getAttribute('href')).toBe(
        '/sign-up',
      );
      expect(screen.queryByRole('link', { name: 'Open Docket' })).toBeNull();
    });

    it('keeps the conversion pair in the hero', () => {
      render(<HeroActions />);

      expect(screen.getByRole('link', { name: /Get started/ }).getAttribute('href')).toBe(
        '/sign-up',
      );
      expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in');
    });

    it('keeps the footer pointing a visitor at sign-up', () => {
      render(<FooterEntryLink className="link" />);

      expect(screen.getByRole('link', { name: 'Get started' }).getAttribute('href')).toBe(
        '/sign-up',
      );
    });
  });

  describe('before the session is known', () => {
    // The honest default for a statically-served public page: render the visitor treatment, so the
    // signed-in swap is additive rather than a visible correction. Both `pending` and `unreachable`
    // mean "we do not know" here — marketing has no offline surface to fall back to.
    it.each(['pending', 'unreachable'] as const)('renders the visitor treatment (%s)', (state) => {
      useSession.mockReturnValue(session(state));

      render(<HeaderActions />);

      expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Open Docket' })).toBeNull();
    });

    it('never claims a session an errored read did not confirm', () => {
      // Guards the same distinction `session-status.ts` exists for: a failed read is not a session.
      useSession.mockReturnValue(session('unreachable'));

      render(<HeroActions />);

      expect(screen.queryByRole('link', { name: 'Open Docket' })).toBeNull();
    });
  });
});
