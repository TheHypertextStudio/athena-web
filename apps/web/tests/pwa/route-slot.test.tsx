import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// The outlet loads a route's chunk and reads the query cache; neither is what this file is about.
vi.mock('../../src/components/pwa/offline-route-outlet', () => ({
  default: function OfflineRouteOutletStub(): React.JSX.Element {
    return <div>outlet</div>;
  },
}));

const { AppLocationProvider } = await import('../../src/lib/app-location');
const RouteSlot = (await import('../../src/components/pwa/route-slot')).default;

/**
 * Whether a document is being used for its own route, or replayed under another one.
 *
 * @remarks
 * This is the whole offline-shell mechanism in one comparison. Getting it wrong in the permissive
 * direction leaves the previous page on screen under a URL that names something else — a lie the
 * person has no way to detect.
 */
function at(path: string): void {
  window.history.replaceState(null, '', path);
}

beforeEach(() => {
  at('/today');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RouteSlot', () => {
  it('renders the page when the document is being used for its own route', () => {
    at('/today');
    render(
      <AppLocationProvider serverPath="/today">
        <RouteSlot serverPath="/today">
          <div>the real page</div>
        </RouteSlot>
      </AppLocationProvider>,
    );

    expect(screen.getByText('the real page')).toBeInTheDocument();
  });

  it('ignores the query string when comparing', () => {
    // `/today` and `/today?tab=all` are the same document; the worker stores them under one key.
    at('/today?tab=all');
    render(
      <AppLocationProvider serverPath="/today?ref=email">
        <RouteSlot serverPath="/today?ref=email">
          <div>the real page</div>
        </RouteSlot>
      </AppLocationProvider>,
    );

    expect(screen.getByText('the real page')).toBeInTheDocument();
  });

  it('renders the requested route when the document was replayed under another URL', () => {
    at('/orgs/o1/tasks/t1');
    render(
      <AppLocationProvider serverPath="/today">
        <RouteSlot serverPath="/today">
          <div>the real page</div>
        </RouteSlot>
      </AppLocationProvider>,
    );

    expect(screen.getByText('outlet')).toBeInTheDocument();
    expect(screen.queryByText('the real page')).not.toBeInTheDocument();
  });

  it('trusts the document when the proxy named no path', () => {
    // Nothing can be compared, so the document is taken at face value — exactly the behaviour that
    // existed before any of this, rather than a guess.
    at('/orgs/o1/tasks/t1');
    render(
      <AppLocationProvider serverPath={null}>
        <RouteSlot serverPath={null}>
          <div>the real page</div>
        </RouteSlot>
      </AppLocationProvider>,
    );

    expect(screen.getByText('the real page')).toBeInTheDocument();
  });
});
