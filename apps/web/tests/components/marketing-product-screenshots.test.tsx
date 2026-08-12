import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentsStrip } from '@/components/marketing/agents-strip';
import { FeatureBand } from '@/components/marketing/feature-band';
import { FeatureSplit } from '@/components/marketing/feature-split';
import { Hero } from '@/components/marketing/hero';
import { OrganizationsPair } from '@/components/marketing/organizations-pair';

vi.mock('@/components/marketing/marketing-cta', () => ({
  HeroActions: () => <a href="/sign-up">Create free account</a>,
}));

describe('marketing product screenshots', () => {
  it.each([
    'today.jpg',
    'task-detail.jpg',
    'program.jpg',
    'initiative.jpg',
    'civic-studio.jpg',
    'neighborhood-fund.jpg',
    'portfolio.jpg',
    'calendar.jpg',
    'connected-apps.jpg',
  ])('ships the captured product asset %s', (file) => {
    const bytes = readFileSync(resolve(process.cwd(), 'public/marketing', file));
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('shows a real Today capture in the hero and labels its disposable data', () => {
    render(<Hero />);

    expect(
      screen.getByRole('img', { name: 'Today with estimated, scheduled, and tracked tasks' }),
    ).toHaveAttribute('loading', 'eager');
    expect(screen.getByText('Example data')).toBeInTheDocument();
  });

  it('renders split and band media as product screenshots', () => {
    const { rerender } = render(
      <FeatureSplit
        title="Track tasks"
        description="Tasks keep estimates, schedules, and tracked time together."
        side="right"
        surface="/marketing/task-detail.jpg"
      />,
    );

    const taskImage = screen.getByRole('img', { name: 'Track tasks' });
    expect(decodeURIComponent(taskImage.getAttribute('src') ?? '')).toContain(
      '/marketing/task-detail.jpg',
    );

    rerender(
      <FeatureBand
        title="Place tasks on the calendar"
        description="Calendar placement shows whether planned work fits."
        surface="/marketing/calendar.jpg"
        tone="ink"
      />,
    );

    const calendarImage = screen.getByRole('img', { name: 'Place tasks on the calendar' });
    expect(decodeURIComponent(calendarImage.getAttribute('src') ?? '')).toContain(
      '/marketing/calendar.jpg',
    );
  });

  it('uses three product captures to explain separate organizations and the combined view', () => {
    render(<OrganizationsPair />);

    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getByRole('img', { name: 'Civic Studio projects' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Neighborhood Fund projects' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Portfolio across both organizations' }),
    ).toBeInTheDocument();
  });

  it('shows a connected MCP app without implying a client approval program', () => {
    render(<AgentsStrip />);

    expect(
      screen.getByRole('img', { name: 'A connected MCP app in Docket settings' }),
    ).toBeInTheDocument();
  });
});
