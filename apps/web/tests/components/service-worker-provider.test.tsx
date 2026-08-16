import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ServiceWorkerProvider,
  UpdateCard,
  useServiceWorkerUpdate,
} from '../../src/components/service-worker-provider';

/**
 * The page half of the update handshake.
 *
 * @remarks
 * jsdom implements no service worker, so these run against a small fake of exactly the surface the
 * provider touches. The invariants under test are the ones whose absence shipped as "the Reload
 * button does nothing": an accepted update must visibly enter its applying phase, a missed
 * `controllerchange` must still end in a reload, and a handshake that cannot start must offer an
 * application-owned retry instead of silently retaining a dead primary action.
 */

type Listener = (event: Event) => void;

class FakeEventTarget {
  readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(name: string, listener: Listener): void {
    const set = this.listeners.get(name) ?? new Set();
    set.add(listener);
    this.listeners.set(name, set);
  }

  removeEventListener(name: string, listener: Listener): void {
    this.listeners.get(name)?.delete(listener);
  }

  emit(name: string): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(new Event(name));
    }
  }

  count(name: string): number {
    return this.listeners.get(name)?.size ?? 0;
  }
}

class FakeWorker extends FakeEventTarget {
  state = 'installed';
  readonly postMessage = vi.fn();

  become(state: string): void {
    this.state = state;
    this.emit('statechange');
  }
}

class FakeRegistration extends FakeEventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  readonly update = vi.fn(() => Promise.resolve());
}

class FakeContainer extends FakeEventTarget {
  controller: object | null = {};
  readonly registration = new FakeRegistration();
  readonly register = vi.fn(() => Promise.resolve(this.registration));
}

let container: FakeContainer;
const reload = vi.fn();
const originalLocation = window.location;

/** Renders the update card exactly as the shell does: only when an update is applicable. */
function Probe(): React.JSX.Element {
  const { applyUpdate } = useServiceWorkerUpdate();
  if (!applyUpdate) {
    return <div data-testid="no-update" />;
  }
  return <UpdateCard onApply={applyUpdate} />;
}

async function mount(): Promise<ReturnType<typeof render>> {
  const view = render(
    <ServiceWorkerProvider>
      <Probe />
    </ServiceWorkerProvider>,
  );
  // Registration resolves over microtasks; flush them so offers land before assertions.
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  container = new FakeContainer();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  // No spread: Location is a class instance whose properties don't enumerate onto a literal.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: originalLocation.href, origin: originalLocation.origin, reload },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  reload.mockClear();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('ServiceWorkerProvider', () => {
  it('offers no reload on a first install — nothing on screen is stale', async () => {
    container.controller = null;
    container.registration.waiting = new FakeWorker();
    await mount();
    expect(screen.getByTestId('no-update')).toBeInTheDocument();
  });

  it('renders the ready update title, supporting copy, and action for a waiting worker', async () => {
    container.registration.waiting = new FakeWorker();
    await mount();
    expect(screen.getByRole('status')).toHaveTextContent('Update available');
    expect(screen.getByRole('status')).toHaveTextContent('Reload to use the latest version');
    expect(screen.getByRole('button', { name: 'Reload now' })).toBeInTheDocument();
  });

  it('offers a reload when an update installs mid-session', async () => {
    await mount();
    const installing = new FakeWorker();
    installing.state = 'installing';
    container.registration.installing = installing;
    act(() => {
      container.registration.emit('updatefound');
      installing.become('installed');
    });
    expect(screen.getByRole('button', { name: 'Reload now' })).toBeInTheDocument();
  });

  it('immediately replaces the ready card with an applying, busy, blocked trigger', async () => {
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;
    await mount();
    const card = screen.getByRole('status');
    const readyMarkup = card.innerHTML;
    fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    // Keep the provider mounted and prove the activation changes the actual rendered card.
    expect(card.innerHTML).not.toBe(readyMarkup);
    expect(card).toHaveAttribute('aria-busy', 'true');
    expect(card).toHaveTextContent('Applying update…');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('reloads exactly once when the new worker takes over', async () => {
    container.registration.waiting = new FakeWorker();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));
    act(() => {
      container.emit('controllerchange');
      container.emit('controllerchange');
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('announces reloading before the four-second fallback reload when controllerchange never arrives', async () => {
    container.registration.waiting = new FakeWorker();
    await mount();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));
    expect(reload).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_750);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Reloading…');
    expect(reload).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('skips the fallback when the controllerchange reload already happened', async () => {
    container.registration.waiting = new FakeWorker();
    await mount();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));
    act(() => {
      container.emit('controllerchange');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps recovery visible when the waiting worker disappears through statechange', async () => {
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;
    await mount();
    expect(screen.getByRole('button', { name: 'Reload now' })).toBeInTheDocument();
    act(() => {
      waiting.become('redundant');
    });
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t apply update');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps a newer waiting offer ready when its superseded worker becomes redundant', async () => {
    const superseded = new FakeWorker();
    container.registration.waiting = superseded;
    await mount();
    const replacement = new FakeWorker();
    replacement.state = 'installing';
    container.registration.installing = replacement;
    act(() => {
      container.registration.emit('updatefound');
      replacement.become('installed');
      superseded.become('redundant');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Update available');
    expect(screen.getByRole('button', { name: 'Reload now' })).toBeInTheDocument();
  });

  it('shows recovery when the waiting worker disappears before activation can start', async () => {
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;
    await mount();
    // The state flips without the statechange event landing first — the exact race applyUpdate
    // guards against.
    waiting.state = 'redundant';
    fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t apply update');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows recovery when postMessage throws synchronously and retries the same worker', async () => {
    const waiting = new FakeWorker();
    waiting.postMessage.mockImplementationOnce(() => {
      throw new Error('closed');
    });
    container.registration.waiting = waiting;
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t apply update');
    expect(screen.getByRole('status')).not.toHaveTextContent('Reload to use the latest version');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(waiting.postMessage).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('Applying update…');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('removes every listener it added on unmount', async () => {
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;
    const view = await mount();
    expect(container.count('controllerchange')).toBe(1);
    expect(container.registration.count('updatefound')).toBe(1);
    expect(waiting.count('statechange')).toBe(1);
    view.unmount();
    expect(container.count('controllerchange')).toBe(0);
    expect(container.registration.count('updatefound')).toBe(0);
    expect(waiting.count('statechange')).toBe(0);
  });
});
