import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkViewLoadFailure } from '../../src/components/work-views/work-view-load-failure';

describe('WorkViewLoadFailure', () => {
  it('explains the preserved view and retries the failed roster request', () => {
    const retry = vi.fn();

    render(<WorkViewLoadFailure title="Projects" retrying={false} onRetry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Projects could not load');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your filters and display settings are safe.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('prevents duplicate retries while a request is running', () => {
    render(<WorkViewLoadFailure title="Tasks" retrying onRetry={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Trying again' })).toBeDisabled();
  });
});
