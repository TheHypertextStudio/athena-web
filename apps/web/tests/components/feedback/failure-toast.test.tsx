import '@testing-library/jest-dom/vitest';

import { Toaster, dismissAllNotices } from '@docket/ui/components';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { presentFailure } from '@/components/feedback/failure-toast';
import { ApiRequestError } from '@/lib/query-core';
import { readProblemError } from '@/lib/problem';

afterEach(() => {
  dismissAllNotices();
  cleanup();
});

/** Present inside React's act so the toaster commits the notice. */
async function present(run: () => void): Promise<HTMLElement> {
  await act(async () => {
    run();
  });
  return screen.findByRole('alert');
}

describe('presentFailure', () => {
  it('tells the person their selected Lattice computer is unavailable', async () => {
    render(<Toaster />);
    const error = await readProblemError(
      new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'Selected Lattice computer unavailable',
          status: 503,
          code: 'lattice_unavailable',
        }),
        { status: 503, headers: { 'content-type': 'application/problem+json' } },
      ),
      'Athena could not answer right now.',
    );

    const alert = await present(() => presentFailure(error, 'Could not send your message.'));
    expect(alert).toHaveTextContent(/Lattice computer.*unavailable/i);
    expect(alert).toHaveTextContent(/wake.*computer/i);
  });

  it('never shows an exception message, only application-owned copy', async () => {
    render(<Toaster />);

    const alert = await present(() => {
      presentFailure(new Error('provider secret text'), 'Could not save the task.');
    });

    expect(alert).not.toHaveTextContent(/provider secret/);
    expect(alert).toHaveTextContent(/./);
  });

  it('offers Try again for a failure retrying can fix', async () => {
    const retry = vi.fn();
    render(<Toaster />);

    await present(() => {
      presentFailure(
        new ApiRequestError({ message: 'Could not save.', status: 500, code: 'internal' }),
        'Could not save.',
        { retry },
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('offers the destination that resolves a refusal retrying cannot', async () => {
    render(<Toaster />);

    const alert = await present(() => {
      presentFailure(
        new ApiRequestError({ message: 'Could not save.', status: 403, code: 'forbidden' }),
        'Could not save.',
        { retry: vi.fn() },
      );
    });

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(alert).toHaveTextContent(/permission/i);
    expect(screen.getByRole('link')).toHaveAttribute('href', expect.stringMatching(/^\//));
  });
});
