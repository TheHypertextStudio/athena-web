/**
 * The landing page's entry controls must never advertise an auth-funnel destination.
 *
 * @remarks
 * The regression lock for a measured defect: sampling the header CTA every 25ms from navigation
 * commit showed `href="/sign-up"` at 39ms and only `/today` at 345ms, because the destination was
 * derived from a client session read. Anyone clicking inside that window — the normal case — was
 * routed into `/sign-up`, watched it paint, and was bounced back out.
 *
 * The fix separates the two concerns, and this file pins the separation: the *label* may still lag
 * the session read (it is cosmetic and additive), but the *destination* is `/open` in every state,
 * resolved on the server. The `'unknown'` case is the one that actually shipped the bug, so it is
 * asserted explicitly rather than folded into a loop.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useMarketingAuthState } = vi.hoisted(() => ({ useMarketingAuthState: vi.fn() }));

vi.mock('../../src/components/marketing/use-marketing-auth', () => ({ useMarketingAuthState }));

import {
  CtaBandActions,
  FooterEntryLink,
  HeaderActions,
  HeroActions,
} from '../../src/components/marketing/marketing-cta';
import type { MarketingAuthState } from '../../src/components/marketing/use-marketing-auth';

/** Every cluster that owns a primary entry control, rendered the way the marketing pages do. */
const CLUSTERS = [
  { name: 'HeaderActions', render: () => <HeaderActions /> },
  { name: 'HeroActions', render: () => <HeroActions /> },
  { name: 'CtaBandActions', render: () => <CtaBandActions /> },
  { name: 'FooterEntryLink', render: () => <FooterEntryLink className="footer-link" /> },
] as const;

const STATES: readonly MarketingAuthState[] = ['unknown', 'signed-in', 'signed-out'];

/** Every `href` on the rendered tree. */
function renderedHrefs(): string[] {
  return Array.from(document.querySelectorAll('a')).map(
    (anchor) => anchor.getAttribute('href') ?? '',
  );
}

beforeEach(() => {
  useMarketingAuthState.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('marketing entry controls', () => {
  for (const cluster of CLUSTERS) {
    for (const state of STATES) {
      it(`${cluster.name} points its primary control at /open while ${state}`, () => {
        useMarketingAuthState.mockReturnValue(state);

        render(cluster.render());

        const entry = screen.getByTestId('open-app');
        expect(entry.getAttribute('href')).toBe('/open');
      });
    }
  }

  it.each(CLUSTERS)(
    '$name never routes its primary control into the auth funnel while the read is unknown',
    ({ render: renderCluster }) => {
      // The exact window the defect lived in: the CTA rendered the visitor treatment, and the
      // visitor treatment used to mean href="/sign-up".
      useMarketingAuthState.mockReturnValue('unknown');

      render(renderCluster());

      expect(screen.getByTestId('open-app').getAttribute('href')).not.toBe('/sign-up');
      expect(screen.getByTestId('open-app').getAttribute('href')).not.toBe('/sign-in');
      // No cluster may reach the auth funnel or hardcode the in-app destination anywhere — the one
      // deliberate exception is the secondary "Sign in" ghost link, asserted separately below.
      expect(renderedHrefs()).not.toContain('/sign-up');
      expect(renderedHrefs()).not.toContain('/today');
    },
  );

  it('keeps the secondary "Sign in" link, which is now safe to offer', () => {
    // /sign-in server-redirects an authenticated visitor with zero paint, so a returning user who
    // deliberately reaches for it is not punished for it.
    useMarketingAuthState.mockReturnValue('unknown');

    render(<HeaderActions />);

    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in');
  });

  it('still swaps the label once the session is known, since only the label was ever cosmetic', () => {
    useMarketingAuthState.mockReturnValue('signed-in');
    render(<HeroActions />);
    expect(screen.getByTestId('open-app').textContent).toBe('Open Docket');
    cleanup();

    useMarketingAuthState.mockReturnValue('unknown');
    render(<HeroActions />);
    expect(screen.getByTestId('open-app').textContent).toBe('Create free account');
  });
});
