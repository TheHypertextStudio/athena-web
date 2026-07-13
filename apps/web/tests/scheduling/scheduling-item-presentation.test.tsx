import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';

function item(id: string, title: string): ScheduleItem {
  return {
    id,
    title,
    startsAt: '2026-07-01T09:00:00.000Z',
    endsAt: '2026-07-01T10:00:00.000Z',
  };
}

function lane(items: readonly ScheduleItem[]): ScheduleLane {
  return { id: 'date', label: 'Wed, Jul 1', date: '2026-07-01', items };
}

afterEach(cleanup);

describe('SchedulingCanvas item presentation', () => {
  it('lets each consumer own the available calendar height', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([])]}
        pixelsPerHour={60}
        viewportWidth={500}
        viewportHeight="100%"
      />,
    );

    const viewport = screen.getByRole('region', { name: 'Schedule' });
    expect(viewport).toHaveStyle({ height: '100%' });
    expect(viewport).not.toHaveClass('h-[clamp(20rem,68dvh,48rem)]');
  });

  it('opens near the live time when today is visible and no scroll target is provided', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([])]}
        now="2026-07-01T21:30:00Z"
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(screen.getByRole('region', { name: 'Schedule' }).scrollTop).toBe(1_182);
  });

  it('uses collision width as well as height to choose readable card density', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([item('a', 'Alpha'), item('b', 'Beta'), item('c', 'Gamma')])]}
        pixelsPerHour={60}
        viewportWidth={360}
      />,
    );

    for (const id of ['a', 'b', 'c']) {
      expect(document.querySelector(`[data-schedule-item="${id}"]`)).toHaveAttribute(
        'data-item-density',
        'compact',
      );
    }
  });

  it('keeps exact item details discoverable on every visual density', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([item('focus', 'Focus block')])]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(screen.getByRole('button', { name: /^Focus block/ })).toHaveAttribute(
      'title',
      'Focus block · 9:00 AM – 10:00 AM',
    );
  });

  it('makes an active direct-manipulation preview visually distinct', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([item('focus', 'Focus block')])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={vi.fn()}
      />,
    );
    const body = screen.getByRole('button', { name: /^Focus block/ });

    fireEvent.pointerDown(body, { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 100, clientY: 115 });

    expect(document.querySelector('[data-schedule-item="focus"]')).toHaveClass(
      'ring-2',
      'shadow-lg',
      'z-40',
    );
  });

  it('uses recognizable, touch-sized move and relationship affordances', () => {
    const linked = {
      ...item('focus', 'Focus block'),
      dragObject: { kind: 'calendar_item' as const, itemId: 'focus', title: 'Focus block' },
    };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([linked])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={vi.fn()}
      />,
    );

    const move = screen.getByRole('button', { name: 'Move Focus block' });
    const relationship = screen.getByRole('button', {
      name: 'Drag Focus block to create a relationship',
    });
    for (const control of [move, relationship]) {
      expect(control).toHaveClass('size-6', '[@media(pointer:coarse)]:size-11');
    }
    expect(move.querySelector('[data-schedule-grip-icon]')).toBeInTheDocument();
    expect(relationship.querySelector('[data-schedule-link-icon]')).toBeInTheDocument();
    expect(move).not.toHaveTextContent('⋮');
    expect(relationship).not.toHaveTextContent('↗');
  });

  it('keeps all-day bodies and relationship affordances touch-sized on coarse pointers', () => {
    const linked = {
      ...item('offsite', 'Team offsite'),
      allDay: true,
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-02T00:00:00.000Z',
      dragObject: { kind: 'calendar_item' as const, itemId: 'offsite', title: 'Team offsite' },
    };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([linked])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Team offsite' })).toHaveClass(
      'touch-none',
      '[@media(pointer:coarse)]:min-h-10',
    );
    expect(
      screen.getByRole('button', {
        name: 'Drag Team offsite to create a relationship',
      }),
    ).toHaveClass('[@media(pointer:coarse)]:size-10');
  });
});
