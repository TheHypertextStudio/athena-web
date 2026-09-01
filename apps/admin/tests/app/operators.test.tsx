// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { admin: { staff: { $get: mocks.get } } } }));

import OperatorsPage from '@/app/(admin)/operators/page';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Fields a case overrides on the default roster row. */
type OperatorOverrides = Partial<Record<string, unknown>> & { userEmail?: string };

/** One roster row, defaulting to a manually granted superadmin. */
function operator(overrides: OperatorOverrides = {}): Record<string, unknown> {
  return {
    id: `staff-${overrides.userEmail ?? 'a'}`,
    userId: 'user-1',
    role: 'superadmin',
    userName: 'Ada Lovelace',
    userEmail: 'ada@example.com',
    createdAt: '2026-08-01T00:00:00.000Z',
    managedBy: 'manual',
    groupsSyncedAt: null,
    ...overrides,
  };
}

/** A successful roster response. */
function rosterOk(items: readonly unknown[]): unknown {
  return { ok: true, status: 200, json: () => Promise.resolve({ items, total: items.length }) };
}

describe('operator roster', () => {
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

  /** Render and settle the roster fetch. */
  async function render(): Promise<void> {
    await act(async () => {
      root.render(<OperatorsPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('distinguishes a manual grant from one the Workspace sync owns', async () => {
    mocks.get.mockResolvedValue(
      rosterOk([
        operator(),
        operator({
          userEmail: 'ops@example.com',
          role: 'support',
          managedBy: 'google_group',
          groupsSyncedAt: '2026-09-01T00:00:00.000Z',
        }),
      ]),
    );

    await render();

    // Provenance is the column this screen exists for: a synced row's tier follows its group,
    // so revoking it here would be undone within minutes.
    const rows = Array.from(container.querySelectorAll('li'));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Granted here');
    expect(rows[1]?.textContent).toContain('Workspace group');
  });

  it('warns when no manually granted superadmin is left to recover with', async () => {
    mocks.get.mockResolvedValue(
      rosterOk([
        operator({ managedBy: 'google_group', groupsSyncedAt: '2026-09-01T00:00:00.000Z' }),
      ]),
    );

    await render();

    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it('stays quiet while a break-glass superadmin remains', async () => {
    mocks.get.mockResolvedValue(rosterOk([operator()]));

    await render();

    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('surfaces owned copy when the roster is refused, without leaking provider detail', async () => {
    mocks.get.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ detail: 'provider detail that must stay private' }),
    });

    await render();

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain('provider detail that must stay private');
  });
});
