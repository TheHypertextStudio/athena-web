import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';
import { assertDefined } from '@docket/test-utils';

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

  it('renders omitted appearances as flat calendar-colour events in timed and all-day lanes', () => {
    const timed = { ...item('focus', 'Focus block'), color: '#316eb4' };
    const allDay = {
      ...item('offsite', 'Team offsite'),
      color: '#316eb4',
      allDay: true,
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-02T00:00:00.000Z',
    };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([timed, allDay])]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    const card = assertDefined(document.querySelector<HTMLElement>('[data-schedule-item="focus"]'));
    const surface = assertDefined(card.querySelector<HTMLElement>('[data-schedule-item-surface]'));
    const allDayItem = assertDefined(
      document.querySelector<HTMLElement>('[data-schedule-all-day-item="offsite"]'),
    );
    const allDaySurface = assertDefined(
      allDayItem.querySelector<HTMLElement>('[data-schedule-item-surface]'),
    );
    expect(card).toHaveAttribute('data-schedule-item-appearance', 'event');
    expect(allDayItem).toHaveAttribute('data-schedule-item-appearance', 'event');
    expect(surface).toHaveClass('bottom-px');
    expect(surface).toHaveClass('rounded-sm');
    expect(allDaySurface).toHaveClass('rounded-sm');
    expect(surface).toHaveStyle({ backgroundColor: '#316eb4' });
    expect(allDaySurface).toHaveStyle({ backgroundColor: '#316eb4' });
    expect(card.querySelector('[data-schedule-item-body]')).toHaveClass('text-on-primary');
    expect(allDayItem.querySelector('[data-schedule-item-body]')).toHaveClass('text-on-primary');
    expect(card.style.borderLeftWidth).toBe('');
    expect(card.querySelector('[data-schedule-item-accent]')).not.toBeInTheDocument();
    expect(allDayItem.querySelector('[data-schedule-item-accent]')).not.toBeInTheDocument();
    expect(card.className).not.toMatch(/shadow-/);
    expect(allDayItem.className).not.toMatch(/shadow-/);
  });

  it('uses a solid semantic event color when a consumer supplies no color', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([item('focus', 'Focus block')])]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    const surface = assertDefined(
      document.querySelector<HTMLElement>(
        '[data-schedule-item="focus"] [data-schedule-item-surface]',
      ),
    );
    expect(surface).toHaveStyle({ backgroundColor: 'var(--color-primary)' });
  });

  it('renders timeboxes as dashed provisional surfaces without changing timed or all-day gestures', () => {
    const dragObject = {
      kind: 'calendar_item' as const,
      itemId: 'timebox',
      title: 'Focus block',
    };
    const timed = {
      ...item('timebox', 'Focus block'),
      appearance: 'timebox' as const,
      color: '#316eb4',
      dragObject,
    };
    const allDay = {
      ...item('all-day-timebox', 'Planning day'),
      appearance: 'timebox' as const,
      color: '#316eb4',
      allDay: true,
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-02T00:00:00.000Z',
      dragObject: { ...dragObject, itemId: 'all-day-timebox', title: 'Planning day' },
    };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([timed, allDay])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={vi.fn()}
        onMoveItem={vi.fn()}
        onResizeItem={vi.fn()}
        onMoveAllDayItem={vi.fn()}
        onResizeAllDayItem={vi.fn()}
      />,
    );

    const card = assertDefined(
      document.querySelector<HTMLElement>('[data-schedule-item="timebox"]'),
    );
    const allDayItem = assertDefined(
      document.querySelector<HTMLElement>('[data-schedule-all-day-item="all-day-timebox"]'),
    );
    const surfaces = [
      assertDefined(card.querySelector<HTMLElement>('[data-schedule-item-surface]')),
      assertDefined(allDayItem.querySelector<HTMLElement>('[data-schedule-item-surface]')),
    ];
    for (const surface of surfaces) {
      expect(surface).toHaveClass('border', 'border-dashed');
      expect(surface.style.backgroundColor).toContain('color-mix');
      expect(surface).toHaveStyle({ borderLeftColor: 'var(--color-outline)' });
    }
    expect(card.querySelector('[data-schedule-item-accent]')).not.toBeInTheDocument();
    expect(allDayItem.querySelector('[data-schedule-item-accent]')).not.toBeInTheDocument();

    expect(card.querySelector('[data-schedule-resize-target="start"]')).toBeInTheDocument();
    expect(card.querySelector('[data-schedule-resize-target="end"]')).toBeInTheDocument();
    expect(card.querySelector('[aria-label="Move Focus block"]')).toBeInTheDocument();
    expect(
      card.querySelector('[aria-label="Drag Focus block to create a relationship"]'),
    ).toBeInTheDocument();
    expect(allDayItem.querySelector('[data-schedule-all-day-resize="start"]')).toBeInTheDocument();
    expect(allDayItem.querySelector('[data-schedule-all-day-resize="end"]')).toBeInTheDocument();
    expect(allDayItem.querySelector('[aria-label="Move Planning day"]')).toBeInTheDocument();
    expect(
      allDayItem.querySelector('[aria-label="Drag Planning day to create a relationship"]'),
    ).toBeInTheDocument();
  });

  it.each(['availability', 'busy'] as const)(
    'keeps %s surfaces subordinate without dimming their text',
    (appearance) => {
      const timed = {
        ...item(`${appearance}-timed`, appearance === 'busy' ? 'Busy' : 'Available'),
        appearance,
        color: '#316eb4',
        openable: false,
      };
      const allDay = {
        ...item(`${appearance}-all-day`, appearance === 'busy' ? 'Busy all day' : 'Available'),
        appearance,
        color: '#316eb4',
        openable: false,
        allDay: true,
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-07-02T00:00:00.000Z',
      };
      render(
        <SchedulingCanvas
          displayTimezone="UTC"
          lanes={[lane([timed, allDay])]}
          pixelsPerHour={60}
          viewportWidth={500}
        />,
      );

      const timedItem = assertDefined(
        document.querySelector<HTMLElement>(`[data-schedule-item="${appearance}-timed"]`),
      );
      const allDayItem = assertDefined(
        document.querySelector<HTMLElement>(`[data-schedule-all-day-item="${appearance}-all-day"]`),
      );
      for (const renderedItem of [timedItem, allDayItem]) {
        const surface = assertDefined(
          renderedItem.querySelector<HTMLElement>('[data-schedule-item-surface]'),
        );
        const body = assertDefined(
          renderedItem.querySelector<HTMLElement>('[data-schedule-item-body]'),
        );
        expect(renderedItem).toHaveAttribute('data-schedule-item-appearance', appearance);
        expect(surface).toHaveClass('border', 'border-outline-variant');
        expect(surface.style.backgroundColor).toContain('color-mix');
        expect(surface).not.toHaveStyle({ backgroundColor: '#316eb4' });
        expect(body).toHaveClass('text-on-surface');
        expect(renderedItem.className).not.toMatch(/\bopacity-/);
      }
    },
  );

  it('keeps read-only state accessible without painting ambient lock glyphs', () => {
    const timed = { ...item('focus', 'Focus block'), editable: false, readOnlyLabel: 'Read-only' };
    const allDay = {
      ...item('offsite', 'Team offsite'),
      editable: false,
      readOnlyLabel: 'Read-only',
      allDay: true,
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-02T00:00:00.000Z',
    };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([timed, allDay])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={vi.fn()}
      />,
    );

    expect(document.querySelector('[data-schedule-lock-icon]')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Focus block/ })).toHaveAccessibleDescription(
      'Read-only',
    );
    expect(screen.getByRole('button', { name: 'Team offsite' })).toHaveAccessibleDescription(
      'Read-only',
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

    // A live preview is marked by a primary ring and a raised tone — never a drop shadow.
    const preview = document.querySelector('[data-schedule-item="focus"]');
    expect(preview).toHaveClass('ring-2', 'ring-primary', 'z-40');
    expect(preview?.querySelector('[data-schedule-item-surface]')).toHaveClass(
      'bg-surface-container-high',
    );
    expect(
      preview?.querySelector<HTMLElement>('[data-schedule-item-surface]')?.style.backgroundColor,
    ).toBe('');
    expect(preview?.className).not.toMatch(/shadow-/);
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
