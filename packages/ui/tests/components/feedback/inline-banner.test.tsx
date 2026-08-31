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
    expect(screen.getByRole('status')).toHaveTextContent(
      'Keep a second way back into your account.',
    );
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

  it('gives the icon its own column and indents the action beneath the message', () => {
    render(
      <InlineBanner
        tone="warning"
        title="Sync is behind"
        icon={<svg data-testid="banner-icon" />}
        action={{ label: 'Retry', onSelect: vi.fn() }}
      >
        Some calendars have not updated.
      </InlineBanner>,
    );

    // With an icon present the message keeps a single column and the action lines up under it,
    // rather than both spanning the full width as they do in the icon-less layout.
    expect(screen.getByTestId('banner-icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('col-start-2');
  });

  it('offers no dismissal without a handler for it', () => {
    render(
      <InlineBanner tone="info" title="Heads up" dismissLabel="Dismiss">
        Nothing to do yet.
      </InlineBanner>,
    );

    // A dismiss label with no handler would render a control that does nothing when pressed.
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });
});
