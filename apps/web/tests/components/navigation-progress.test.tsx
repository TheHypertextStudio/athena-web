/**
 * The acknowledgement a click on a document gets before its route arrives.
 *
 * @remarks
 * Until the route payload returns, the previous screen is unchanged — indistinguishable from a
 * click that never registered, which is what made the app feel unresponsive where it was merely
 * busy. These tests pin both halves: a navigation that stays pending is reported, and one that
 * resolves quickly produces no chrome at all, so the bar is feedback rather than flicker.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The provider resolves Next's router for its own fallback transport; these tests supply an
// explicit `navigate`, so the router is never used — it only has to exist.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { NavigationProgress } from '../../src/components/navigation-progress';
import {
  ResponsiveNavigationProvider,
  useResponsiveRouter,
} from '../../src/lib/interactions/navigation';

/** The bar's element, or `null` when it is not showing. */
function bar(): Element | null {
  return document.querySelector('[data-navigation-progress]');
}

/**
 * A control that requests a navigation, from inside the provider's own subtree.
 *
 * @remarks
 * Clicked rather than fired from an effect on purpose: a request made during the initial mount
 * commit is settled by the provider's own mount effect, which is not how a click behaves.
 */
function Navigate({ href }: { href: string }): JSX.Element {
  const router = useResponsiveRouter();
  return (
    <button
      type="button"
      onClick={() => {
        router.push(href);
      }}
    >
      go
    </button>
  );
}

/**
 * Mount the bar with a committed route, optionally requesting a different one.
 *
 * @param canonicalHref - The route Next has committed.
 * @param requestHref - A destination to request, which `navigate` never commits — so the request
 *   stays open, standing in for a route whose payload has not arrived.
 */
function mount(canonicalHref: string, requestHref?: string): JSX.Element {
  return (
    <ResponsiveNavigationProvider canonicalHref={canonicalHref} navigate={() => undefined}>
      <NavigationProgress />
      {requestHref === undefined ? null : <Navigate href={requestHref} />}
    </ResponsiveNavigationProvider>
  );
}

/** Click the request control, if one is mounted. */
function requestNavigation(): void {
  fireEvent.click(screen.getByRole('button', { name: 'go' }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NavigationProgress', () => {
  it('shows nothing while no navigation is pending', async () => {
    render(mount('/today'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(bar()).toBeNull();
  });

  it('reports a navigation still waiting on its route', async () => {
    render(mount('/today', '/orgs/o1/projects/p1'));

    requestNavigation();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Without this the screen is identical before and after the click, which is why people click
    // the same row twice.
    expect(bar()).not.toBeNull();
  });

  it('stays out of the way while a fast navigation is still within the delay', async () => {
    render(mount('/today', '/orgs/o1/projects/p1'));

    requestNavigation();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Most navigations resolve inside this window, especially against a warm cache. Chrome that
    // blinks on every click is noise, not feedback.
    expect(bar()).toBeNull();
  });

  it('goes away once the requested route becomes the committed one', async () => {
    const view = render(mount('/today', '/orgs/o1/projects/p1'));
    requestNavigation();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(bar()).not.toBeNull();

    view.rerender(mount('/orgs/o1/projects/p1'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(bar()).toBeNull();
  });

  it('keeps counting across a superseding navigation', async () => {
    render(
      <ResponsiveNavigationProvider canonicalHref="/today" navigate={() => undefined}>
        <NavigationProgress />
        <Navigate href="/orgs/o1/projects/p1" />
        <Navigate href="/orgs/o1/projects/p2" />
      </ResponsiveNavigationProvider>,
    );

    const [first, second] = screen.getAllByRole('button', { name: 'go' });
    fireEvent.click(first!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    fireEvent.click(second!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    // 180ms of continuous waiting, split across two requests. Restarting the countdown on each
    // one meant a run of quick clicks could keep the bar hidden through a wait of any length —
    // exactly the case it exists for.
    expect(bar()).not.toBeNull();
  });

  it('is hidden from assistive technology', async () => {
    render(mount('/today', '/orgs/o1/projects/p1'));
    requestNavigation();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // The new route announces itself when it lands; a live region here would talk over it.
    expect(bar()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders without a navigation provider above it', () => {
    // The bar belongs to the shell, but mounting shell chrome in isolation must not throw.
    expect(() => render(<NavigationProgress />)).not.toThrow();
  });
});
