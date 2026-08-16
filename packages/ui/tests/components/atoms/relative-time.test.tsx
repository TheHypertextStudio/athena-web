import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RelativeTime } from '../../../src/components/atoms/RelativeTime';

describe('RelativeTime', () => {
  const ISO = '2026-07-06T19:30:00.000Z';

  it('keeps the machine-readable instant beside the human phrasing', () => {
    // The whole point: a relative string has thrown the date away, so the instant has to survive
    // somewhere a reader — or a copy-paste — can still reach it.
    render(<RelativeTime iso={ISO}>3 days ago</RelativeTime>);

    const time = screen.getByText('3 days ago');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', ISO);
  });

  it('exposes an absolute form on hover', () => {
    render(<RelativeTime iso={ISO}>3 days ago</RelativeTime>);

    const title = screen.getByText('3 days ago').getAttribute('title');
    expect(title).toBeTruthy();
    // Rendered in the viewer's own locale, so assert it resolved to a real date rather than
    // pinning the exact formatting.
    expect(Number.isNaN(new Date(title ?? '').getTime())).toBe(false);
  });

  it('renders the caller phrasing without a title when the instant is unparseable', () => {
    // A bad timestamp inside a list must not throw the row away; it degrades to the phrasing.
    render(<RelativeTime iso="not-a-date">unknown</RelativeTime>);

    const time = screen.getByText('unknown');
    expect(time).not.toHaveAttribute('title');
  });

  it('renders the absolute form in an explicit zone when one is given', () => {
    render(
      <RelativeTime iso={ISO} timeZone="UTC">
        3 days ago
      </RelativeTime>,
    );

    expect(screen.getByText('3 days ago').getAttribute('title')).toContain('7:30');
  });
});
