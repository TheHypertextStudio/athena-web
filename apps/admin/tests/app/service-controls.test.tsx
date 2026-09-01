// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { readonly children: ReactNode; readonly href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/api', () => ({
  api: { admin: { 'service-controls': { $get: mocks.get, $patch: mocks.patch } } },
}));

import SettingsPage from '@/app/(admin)/settings/page';
import { withQueryClient } from '../support/query-harness';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SUBMISSIONS = '#lattice-submissions-enabled';
const POLLING = '#lattice-polling-enabled';

/** A minimal stand-in for a successful JSON API response. */
function jsonOk(body: unknown): { ok: true; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** A minimal stand-in for a rejected API response carrying a Problem body. */
function jsonFailure(
  status: number,
  body: unknown,
): { ok: false; status: number; json: () => Promise<unknown> } {
  return { ok: false, status, json: () => Promise.resolve(body) };
}

/** The checkbox rendered for one control, or a failure when the screen did not render it. */
function checkbox(container: HTMLElement, selector: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`Expected the settings screen to render ${selector}.`);
  return input;
}

describe('Service settings screen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  /**
   * Let every pending promise and the query cache's own scheduling settle.
   *
   * @remarks
   * A read goes through TanStack Query rather than straight to `fetch`, so resolving the mocked
   * response is not enough on its own — the cache notifies its observers on a later turn. Yielding
   * to the macrotask queue inside `act` lets that notification and the re-render it causes land
   * before anything is asserted.
   */
  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** Mount the screen and settle the initial read. */
  async function mount(): Promise<void> {
    await act(async () => {
      root.render(withQueryClient(<SettingsPage />));
    });
    await settle();
  }

  it('renders a labelled checkbox per control reflecting the loaded state', async () => {
    mocks.get.mockResolvedValue(
      jsonOk({ latticeSubmissionsEnabled: true, latticePollingEnabled: false }),
    );

    await mount();

    const submissions = checkbox(container, SUBMISSIONS);
    const polling = checkbox(container, POLLING);
    expect(submissions.type).toBe('checkbox');
    expect(polling.type).toBe('checkbox');
    expect(submissions.checked).toBe(true);
    expect(polling.checked).toBe(false);
    for (const input of [submissions, polling]) {
      expect(container.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)).not.toBeNull();
    }
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('sends only the changed control and adopts the state the API confirms', async () => {
    // A stored state both verbs read from, so the confirming re-read after a write agrees with what
    // the write returned — a static GET mock would look like the server forgetting the change.
    let stored = { latticeSubmissionsEnabled: true, latticePollingEnabled: true };
    mocks.get.mockImplementation(() => Promise.resolve(jsonOk(stored)));
    mocks.patch.mockImplementation(() => {
      stored = { latticeSubmissionsEnabled: false, latticePollingEnabled: true };
      return Promise.resolve(jsonOk(stored));
    });

    await mount();
    await act(async () => {
      checkbox(container, SUBMISSIONS).click();
    });
    await settle();

    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledWith({ json: { latticeSubmissionsEnabled: false } });
    expect(checkbox(container, SUBMISSIONS).checked).toBe(false);
    expect(checkbox(container, POLLING).checked).toBe(true);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('disables both controls while a change is in flight', async () => {
    let stored = { latticeSubmissionsEnabled: true, latticePollingEnabled: true };
    mocks.get.mockImplementation(() => Promise.resolve(jsonOk(stored)));
    let resolvePatch: () => void = () => {
      throw new Error('Expected the screen to have started the update before it was settled.');
    };
    mocks.patch.mockReturnValue(
      new Promise((resolve) => {
        resolvePatch = () => {
          stored = { latticeSubmissionsEnabled: true, latticePollingEnabled: false };
          resolve(jsonOk(stored));
        };
      }),
    );

    await mount();
    await act(async () => {
      checkbox(container, POLLING).click();
    });
    // The in-flight flag is read from the mutation rather than mirrored in local state, so it
    // lands on the next React pass rather than inside the click handler.
    await settle();

    expect(checkbox(container, SUBMISSIONS).disabled).toBe(true);
    expect(checkbox(container, POLLING).disabled).toBe(true);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => {
      resolvePatch();
    });
    await settle();

    expect(checkbox(container, POLLING).disabled).toBe(false);
    expect(checkbox(container, POLLING).checked).toBe(false);
  });

  it('surfaces an owned failure and leaves the control where it was', async () => {
    mocks.get.mockResolvedValue(
      jsonOk({ latticeSubmissionsEnabled: true, latticePollingEnabled: true }),
    );
    mocks.patch.mockResolvedValue(
      jsonFailure(403, {
        type: 'about:blank',
        title: 'provider detail that must stay private',
        status: 403,
        detail: 'provider detail that must stay private',
        code: 'forbidden',
      }),
    );

    await mount();
    await act(async () => {
      checkbox(container, SUBMISSIONS).click();
    });
    await settle();

    // The banner renders nothing without a failure, so its presence is the assertion that owned
    // failure copy reached the operator.
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).not.toContain('provider detail that must stay private');
    expect(checkbox(container, SUBMISSIONS).checked).toBe(true);
    expect(checkbox(container, POLLING).checked).toBe(true);
    expect(checkbox(container, SUBMISSIONS).disabled).toBe(false);
  });

  it('surfaces a recovery action when the read is rejected for a non-operator', async () => {
    mocks.get.mockResolvedValue(jsonFailure(403, { code: 'forbidden' }));

    await mount();

    expect(container.querySelector(SUBMISSIONS)).toBeNull();
    const banner = container.querySelector('[role="status"]');
    if (!banner) throw new Error('Expected a failure banner for a non-operator session.');

    // Asserted as behaviour rather than markup: the recovery control must actually take the
    // operator somewhere they can sign in with a staff account.
    const recovery = banner.querySelector('button');
    if (!recovery) throw new Error('Expected the banner to offer a recovery control.');
    await act(async () => {
      recovery.click();
    });
    expect(mocks.push).toHaveBeenCalledWith('/sign-in');
  });
});
