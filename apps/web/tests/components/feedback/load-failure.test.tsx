import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LoadFailure } from '@/components/feedback/load-failure';
import { ApiRequestError, OfflineError } from '@/lib/query-core';

describe('LoadFailure', () => {
  it('offers recovery for a failure that retrying can actually resolve', () => {
    const retry = vi.fn();

    render(
      <LoadFailure
        title="Projects"
        error={new ApiRequestError({ message: 'Could not load projects.', status: 0 })}
        onRetry={retry}
      />,
    );

    const recovery = screen.getByRole('alert');
    expect(recovery).not.toHaveTextContent(/could not load projects/i);
    fireEvent.click(screen.getByRole('button'));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('withholds retry when the same request cannot succeed', () => {
    render(
      <LoadFailure
        title="Projects"
        error={
          new ApiRequestError({
            message: 'Could not load projects.',
            status: 403,
            code: 'forbidden',
          })
        }
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/permission/i);
    expect(screen.getByRole('link')).toBeInTheDocument();
  });

  it('names the connection rather than the operation when nothing was reached', () => {
    render(<LoadFailure title="Projects" error={new OfflineError()} onRetry={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent(/offline/i);
  });

  it('shrinks to a panel for a rail or card', () => {
    render(<LoadFailure title="Today" error={new OfflineError()} size="panel" />);

    expect(screen.getByRole('alert')).toHaveClass('min-h-32');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
