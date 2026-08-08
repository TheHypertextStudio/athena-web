import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ServiceWorkerProvider,
  UpdateBanner,
  useServiceWorkerUpdate,
} from '../../src/components/service-worker-provider';

/**
 * The page half of the update handshake.
 *
 * @remarks
 * jsdom implements no service worker, so these run against a small fake of exactly the surface the
 * provider touches. The invariants under test are the ones whose absence shipped as "the Reload
 * button does nothing": accepting an update must never optimistically dismiss the banner, a
 * missed `controllerchange` must still end in a reload, and an offer whose worker went redundant
 * must withdraw itself.
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

/** Renders the banner exactly as the shell does: only when an update is actually applicable. */
function Probe(): React.JSX.Element {
  const { applyUpdate } = useServiceWorkerUpdate();
  if (!applyUpdate) {
    return <div data-testid="no-update" />;
  }
  return <UpdateBanner onApply={applyUpdate} />;
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

  it('offers a reload when a worker is waiting behind a live controller', async () => {
    container.registration.waiting = new FakeWorker();
    await mount();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('keeps the banner up after accepting — the reload is what dismisses it', async () => {
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    // No optimistic dismissal: a handshake that stalls must not silently swallow the prompt.
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('reloads exactly once when the new worker takes over', async () => {
    container.registration.waiting = new FakeWorker();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    act(() => {
      container.emit('controllerchange');
      container.emit('controllerchange');
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('falls back to reloading when controllerchange never arrives', async () => {
    container.registration.waiting = new FakeWorker();
    await mount();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('skips the fallback when the controllerchange reload already happened', async () => {
    container.registration.waiting = new FakeWorker();
    await mount();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    act(() => {
      container.emit('controllerchange');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('withdraws the offer when the waiting worker goes redundant', async () => {
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;
    await mount();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    act(() => {
      waiting.become('redundant');
    });
    expect(screen.getByTestId('no-update')).toBeInTheDocument();
  });

  it('accepting a worker that raced to redundant clears the offer instead of posting', async () => {
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;
    await mount();
    // The state flips without the statechange event landing first — the exact race applyUpdate
    // guards against.
    waiting.state = 'redundant';
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('no-update')).toBeInTheDocument();
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
