import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../src/primitives/hover-card';

/**
 * A hover card previewing an entity, mirroring the intended list-row usage. `openDelay={0}` removes
 * the hover dwell so the test does not depend on a timer.
 */
function IssuePreview(): React.JSX.Element {
  return (
    <HoverCard openDelay={0} closeDelay={0}>
      <HoverCardTrigger asChild>
        <a href="/issues/DKT-12">DKT-12</a>
      </HoverCardTrigger>
      <HoverCardContent className="card-x">
        <p>Fix timezone drift</p>
        <p>In Progress</p>
      </HoverCardContent>
    </HoverCard>
  );
}

describe('HoverCard family', () => {
  it('is closed until the trigger is hovered, then reveals its preview content', async () => {
    render(<IssuePreview />);
    expect(screen.queryByText('Fix timezone drift')).not.toBeInTheDocument();

    fireEvent.pointerEnter(screen.getByRole('link', { name: 'DKT-12' }));

    expect(await screen.findByText('Fix timezone drift')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('merges a custom class and applies the MD3 surface tone onto the content', async () => {
    render(<IssuePreview />);
    fireEvent.pointerEnter(screen.getByRole('link', { name: 'DKT-12' }));
    await screen.findByText('Fix timezone drift');

    const styled = document.querySelector('.card-x');
    expect(styled).not.toBeNull();
    expect(styled).toHaveClass('bg-surface', 'rounded-lg', 'w-64');
  });

  it('closes again when the pointer leaves the trigger', async () => {
    render(<IssuePreview />);
    const trigger = screen.getByRole('link', { name: 'DKT-12' });
    fireEvent.pointerEnter(trigger);
    await screen.findByText('Fix timezone drift');

    fireEvent.pointerLeave(trigger);
    await waitFor(() => {
      expect(screen.queryByText('Fix timezone drift')).not.toBeInTheDocument();
    });
  });
});
