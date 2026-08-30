import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InlineBanner } from '../../../src/components/feedback/InlineBanner';

describe('InlineBanner', () => {
  it('announces its title and message without optional controls', () => {
    render(
      <InlineBanner tone="info" title="Recovery codes needed">
        Keep a second way back into your account.
      </InlineBanner>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Recovery codes needed');
    expect(screen.getByRole('status')).toHaveTextContent('Keep a second way back into your account.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the action and dismiss control independently reachable', () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    render(
      <InlineBanner
        tone="critical"
        title="Recovery codes needed"
        action={{ label: 'Set up', onSelect }}
        dismissLabel="Dismiss recovery reminder"
        onDismiss={onDismiss}
      >
        Keep a second way back into your account.
      </InlineBanner>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss recovery reminder' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
