import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Timeline, TimelineItem, TimelineMarker } from '../../src/primitives/timeline';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../src/primitives/collapsible';

describe('Timeline', () => {
  it('retains ordered semantics and an independently operable disclosure inside a connected group', () => {
    render(
      <Timeline aria-label="Work activity">
        <TimelineItem node={<span>A</span>}>
          <p>A person commented.</p>
        </TimelineItem>
        <TimelineItem connector node={<TimelineMarker />}>
          <Collapsible>
            <CollapsibleTrigger>Show changes</CollapsibleTrigger>
            <CollapsibleContent>Exact edit</CollapsibleContent>
          </Collapsible>
        </TimelineItem>
      </Timeline>,
    );
    const timeline = screen.getByRole('list', { name: 'Work activity' });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(2);
    expect(within(timeline).getByText('A person commented.')).toBeVisible();
    const button = screen.getByRole('button', { name: 'Show changes' });
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(screen.getByText('Exact edit')).toBeVisible();
    expect(timeline.querySelector('[data-timeline-node]')).toHaveAttribute('aria-hidden', 'true');
  });
});
