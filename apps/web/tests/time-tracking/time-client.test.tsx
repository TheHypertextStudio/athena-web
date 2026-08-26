import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/time-tracking', () => ({
  TimeAnalytics: () => <p>Time analytics</p>,
  TimeSharePanel: () => <p>Time sharing</p>,
}));

import TimeClient from '@/app/(app)/time/time-client';

describe('TimeClient', () => {
  it('keeps the server document independent of runtime time settings', () => {
    const html = renderToStaticMarkup(<TimeClient />);

    expect(html).toContain('Loading time review');
    expect(html).not.toContain('Time analytics');
    expect(html).not.toContain('Time sharing');
  });

  it('mounts the review after hydration', async () => {
    render(<TimeClient />);

    expect(await screen.findByText('Time analytics')).toBeInTheDocument();
    expect(screen.getByText('Time sharing')).toBeInTheDocument();
  });
});
