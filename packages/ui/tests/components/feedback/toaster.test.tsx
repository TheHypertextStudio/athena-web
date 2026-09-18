import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast as sonner } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Toaster } from '../../../src/components/feedback/Toaster';
import { dismissNotice, notify, notifyFailure } from '../../../src/components/feedback/toast';

// Sonner keeps its notices in module state, so each test starts from an empty stack.
afterEach(() => {
  sonner.dismiss();
  cleanup();
});

/** Sonner unmounts a dismissed notice after its exit animation, so removal is not immediate. */
const REMOVAL = { timeout: 2_000 };

/** Show a notice inside React's act so the toaster commits it. */
async function show(run: () => string): Promise<string> {
  let id = '';
  await act(async () => {
    id = run();
  });
  return id;
}

describe('Toaster', () => {
  it('announces a failure as an alert with its detail and a retry action', async () => {
    const retry = vi.fn();
    render(<Toaster />);

    await show(() =>
      notifyFailure({
        title: 'That change did not save.',
        detail: 'Check your connection and try again.',
        action: { label: 'Try again', onSelect: retry },
      }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-toast-tone', 'critical');
    expect(alert).toHaveTextContent('That change did not save.');
    expect(alert).toHaveTextContent('Check your connection and try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('announces an ordinary notice politely and can be dismissed', async () => {
    render(<Toaster />);

    const id = await show(() => notify({ title: 'Saved on this device' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Saved on this device');
    await act(async () => {
      dismissNotice(id);
    });
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    }, REMOVAL);
  });

  it('replaces a notice sharing a dedupe key instead of stacking', async () => {
    render(<Toaster />);

    await show(() => notifyFailure({ title: 'First', dedupeKey: 'internal' }));
    await show(() => notifyFailure({ title: 'Second', dedupeKey: 'internal' }));

    await waitFor(() => {
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Second');
  });

  it('renders a destination action as a link', async () => {
    render(<Toaster />);

    await show(() =>
      notifyFailure({
        title: 'You no longer have access.',
        action: { label: 'Open settings', href: '/settings' },
      }),
    );

    expect(await screen.findByRole('link', { name: 'Open settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('removes a notice from its own dismiss control', async () => {
    render(<Toaster />);
    await show(() => notify({ title: 'Draft saved' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    }, REMOVAL);
  });
});
