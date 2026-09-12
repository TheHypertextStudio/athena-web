import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkViewLoadFailure } from '../../src/components/work-views/work-view-load-failure';
import { ApiRequestError, OfflineError } from '../../src/lib/query-core';

describe('WorkViewLoadFailure', () => {
  it('offers recovery for a failure that retrying can actually resolve', () => {
    const retry = vi.fn();

    render(
      <WorkViewLoadFailure
        title="Projects"
        error={new ApiRequestError({ message: 'Could not load projects.', status: 0 })}
        retrying={false}
        onRetry={retry}
      />,
    );

    const recovery = screen.getByRole('alert');
    expect(recovery).toBeInTheDocument();
    expect(recovery).not.toHaveTextContent(/could not load projects/i);
    fireEvent.click(screen.getByRole('button'));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('withholds retry when the same request cannot succeed', () => {
    render(
      <WorkViewLoadFailure
        title="Projects"
        error={
          new ApiRequestError({
            message: 'Could not load projects.',
            status: 403,
            code: 'forbidden',
          })
        }
        retrying={false}
        onRetry={vi.fn()}
      />,
    );

    // Pressing a button that cannot change a permission answer tells the person the surface does
    // not know what happened.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/permission/i);
  });

  it('names the connection rather than the operation when nothing was reached', () => {
    render(
      <WorkViewLoadFailure
        title="Projects"
        error={new OfflineError()}
        retrying={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/offline/i);
  });

  it('distinguishes a server failure from a permission one', () => {
    const server = render(
      <WorkViewLoadFailure
        title="Projects"
        error={new ApiRequestError({ message: 'x', status: 500, code: 'internal' })}
        retrying={false}
        onRetry={vi.fn()}
      />,
    );
    const serverText = screen.getByRole('alert').textContent;
    server.unmount();

    render(
      <WorkViewLoadFailure
        title="Projects"
        error={new ApiRequestError({ message: 'x', status: 403, code: 'forbidden' })}
        retrying={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert').textContent).not.toBe(serverText);
  });

  it('prevents duplicate retries while a request is running', () => {
    render(
      <WorkViewLoadFailure
        title="Tasks"
        error={new ApiRequestError({ message: 'x', status: 0 })}
        retrying
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('does not replace cached roster rows after a local failure', () => {
    const { container } = render(
      <WorkViewLoadFailure
        title="Tasks"
        error={new ApiRequestError({ message: 'x', status: 0 })}
        retrying={false}
        hasCachedRows
        onRetry={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
