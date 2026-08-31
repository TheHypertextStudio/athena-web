// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
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

  /** Mount the screen and settle the initial read. */
  async function mount(): Promise<void> {
    await act(async () => {
      root.render(<SettingsPage />);
    });
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
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('sends only the changed control and adopts the state the API confirms', async () => {
    mocks.get.mockResolvedValue(
      jsonOk({ latticeSubmissionsEnabled: true, latticePollingEnabled: true }),
    );
    mocks.patch.mockResolvedValue(
      jsonOk({ latticeSubmissionsEnabled: false, latticePollingEnabled: true }),
    );

    await mount();
    await act(async () => {
      checkbox(container, SUBMISSIONS).click();
    });

    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledWith({ json: { latticeSubmissionsEnabled: false } });
    expect(checkbox(container, SUBMISSIONS).checked).toBe(false);
    expect(checkbox(container, POLLING).checked).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('disables both controls while a change is in flight', async () => {
    mocks.get.mockResolvedValue(
      jsonOk({ latticeSubmissionsEnabled: true, latticePollingEnabled: true }),
    );
    let settle: () => void = () => {
      throw new Error('Expected the screen to have started the update before it was settled.');
    };
    mocks.patch.mockReturnValue(
      new Promise((resolve) => {
        settle = () => {
          resolve(jsonOk({ latticeSubmissionsEnabled: true, latticePollingEnabled: false }));
        };
      }),
    );

    await mount();
    await act(async () => {
      checkbox(container, POLLING).click();
    });

    expect(checkbox(container, SUBMISSIONS).disabled).toBe(true);
    expect(checkbox(container, POLLING).disabled).toBe(true);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => {
      settle();
    });

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

    // `ErrorBanner` renders nothing without a message, so the banner's presence is the
    // assertion that owned failure copy reached the operator.
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain('provider detail that must stay private');
    expect(checkbox(container, SUBMISSIONS).checked).toBe(true);
    expect(checkbox(container, POLLING).checked).toBe(true);
    expect(checkbox(container, SUBMISSIONS).disabled).toBe(false);
  });

  it('surfaces a recovery action when the read is rejected for a non-operator', async () => {
    mocks.get.mockResolvedValue(jsonFailure(403, { code: 'forbidden' }));

    await mount();

    expect(container.querySelector(SUBMISSIONS)).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"] a[href="/sign-in"]')).not.toBeNull();
  });
});
