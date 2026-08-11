import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AgendaDayContextStrip from '@/components/agenda/agenda-day-context-strip';

describe('AgendaDayContextStrip', () => {
  it('renders working location as quiet day context rather than an event', () => {
    render(
      <AgendaDayContextStrip
        items={[{ id: 'location-1', kind: 'working_location', label: 'Home', color: '#2563eb' }]}
      />,
    );

    expect(screen.getByRole('group', { name: 'Day context' })).toHaveTextContent('Home');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('renders nothing when the day has no semantic context', () => {
    const { container } = render(<AgendaDayContextStrip items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
