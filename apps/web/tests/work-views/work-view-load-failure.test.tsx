import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkViewLoadFailure } from '../../src/components/work-views/work-view-load-failure';

describe('WorkViewLoadFailure', () => {
  it('names the failed roster and offers a concise retry action', () => {
    const retry = vi.fn();

    render(<WorkViewLoadFailure title="Projects" retrying={false} onRetry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Projects could not load');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/filters and display settings/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/Try loading this list again/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('prevents duplicate retries while a request is running', () => {
    render(<WorkViewLoadFailure title="Tasks" retrying onRetry={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Retrying' })).toBeDisabled();
  });
});
