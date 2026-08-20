import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';
import { assertDefined } from '@docket/test-utils';

import {
  SCHEDULE_TEST_THEMES,
  scheduleSurfaceContrast,
} from './scheduling-surface-contrast-test-utils';

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
    expect(allDayItem).toHaveClass('isolate');
    expect(allDaySurface).toHaveClass('-z-10');
    expect(card.style.getPropertyValue('--schedule-item-fill')).toBe(
      'color-mix(in oklab, #316eb4 8%, var(--color-primary))',
    );
    expect(allDayItem.style.getPropertyValue('--schedule-item-fill')).toBe(
      'color-mix(in oklab, #316eb4 8%, var(--color-primary))',
    );
    expect(surface.style.backgroundColor).toBe('var(--schedule-item-fill)');
    expect(allDaySurface.style.backgroundColor).toBe('var(--schedule-item-fill)');
    expect(card.style.getPropertyValue('--schedule-item-foreground')).toBe(
      'var(--color-on-primary)',
    );
    expect(allDayItem.style.getPropertyValue('--schedule-item-foreground')).toBe(
      'var(--color-on-primary)',
    );
    expect(card.querySelector('[data-schedule-item-body]')).toHaveClass(
      'text-(--schedule-item-foreground)',
    );
    expect(allDayItem.querySelector('[data-schedule-item-body]')).toHaveClass(
      'text-(--schedule-item-foreground)',
    );
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

    const renderedItem = assertDefined(
      document.querySelector<HTMLElement>('[data-schedule-item="focus"]'),
    );
    expect(renderedItem.style.getPropertyValue('--schedule-item-fill')).toBe(
      'color-mix(in oklab, var(--color-primary) 8%, var(--color-primary))',
    );
    expect(
      renderedItem.querySelector<HTMLElement>('[data-schedule-item-surface]')?.style
        .backgroundColor,
    ).toBe('var(--schedule-item-fill)');
  });

  it.each(['#000000', '#ffffff'])(
    'publishes a measurable focus indicator for timed and all-day controls with hostile color %s',
    (color) => {
      const timed = {
        ...item('focus', 'Focus block'),
        color,
        dragObject: { kind: 'calendar_item' as const, itemId: 'focus', title: 'Focus block' },
      };
      const allDay = {
        ...item('offsite', 'Team offsite'),
        color,
        allDay: true,
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-07-02T00:00:00.000Z',
        dragObject: { kind: 'calendar_item' as const, itemId: 'offsite', title: 'Team offsite' },
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

      const roots = [
        assertDefined(document.querySelector<HTMLElement>('[data-schedule-item="focus"]')),
        assertDefined(
          document.querySelector<HTMLElement>('[data-schedule-all-day-item="offsite"]'),
        ),
      ];
      for (const root of roots) {
        const fill = root.style.getPropertyValue('--schedule-item-fill');
        const focusIndicator = root.style.getPropertyValue('--schedule-item-focus');
        expect(fill).not.toBe('');
        expect(focusIndicator).not.toBe('');
        expect(
          root.querySelector<HTMLElement>('[data-schedule-item-surface]')?.style.backgroundColor,
        ).toBe('var(--schedule-item-fill)');
        for (const theme of SCHEDULE_TEST_THEMES) {
          expect(scheduleSurfaceContrast(fill, focusIndicator, theme)).toBeGreaterThanOrEqual(3);
        }
        for (const control of root.querySelectorAll<HTMLElement>('.outline-none')) {
          expect(control).toHaveClass('focus-visible:ring-ring');
        }
        expect(root.style.getPropertyValue('--color-ring')).toBe(focusIndicator);
      }
    },
  );

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
    for (const renderedItem of [card, allDayItem]) {
      const surface = assertDefined(
        renderedItem.querySelector<HTMLElement>('[data-schedule-item-surface]'),
      );
      expect(surface).toHaveClass('border', 'border-dashed');
      expect(surface.style.backgroundColor).toBe('var(--schedule-item-fill)');
      expect(renderedItem.style.getPropertyValue('--schedule-item-fill')).toContain('color-mix');
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

  it.each(['event', 'timebox'] as const)(
    'routes timed %s open, move, resize, and relationship gestures through shared callbacks',
    async (appearance) => {
      const user = userEvent.setup();
      const title = appearance === 'event' ? 'Event planning' : 'Timebox planning';
      const source = {
        ...item(`${appearance}-source`, title),
        appearance,
        dragObject: {
          kind: 'calendar_item' as const,
          itemId: `${appearance}-source`,
          title,
        },
      };
      const target = {
        ...item(`${appearance}-target`, 'Planning review'),
        startsAt: '2026-07-01T11:00:00.000Z',
        endsAt: '2026-07-01T12:00:00.000Z',
        dropTarget: true,
      };
      const sourceLane = lane([source, target]);
      const onOpenItem = vi.fn();
      const onMoveItem = vi.fn();
      const onResizeItem = vi.fn();
      const onDropObjectOnItem = vi.fn();
      render(
        <SchedulingCanvas
          displayTimezone="UTC"
          lanes={[sourceLane]}
          pixelsPerHour={60}
          viewportWidth={500}
          onOpenItem={onOpenItem}
          onMoveItem={onMoveItem}
          onResizeItem={onResizeItem}
          onDropObjectOnItem={onDropObjectOnItem}
        />,
      );

      await user.click(screen.getByRole('button', { name: new RegExp(`^${title}`) }));
      fireEvent.keyDown(screen.getByRole('button', { name: `Move ${title}` }), {
        key: 'ArrowDown',
      });
      fireEvent.keyDown(screen.getByRole('button', { name: `Resize ${title} from end` }), {
        key: 'ArrowUp',
      });
      const relationshipSource = screen.getByRole('button', {
        name: `Create relationship from ${title}`,
      });
      await user.click(relationshipSource);
      expect(relationshipSource).toHaveClass('[--color-ring:var(--color-on-primary-container)]');
      await user.click(screen.getByRole('button', { name: `Link ${title} to Planning review` }));

      expect(onOpenItem).toHaveBeenCalledWith({ item: source, lane: sourceLane });
      expect(onMoveItem).toHaveBeenCalledWith({
        item: source,
        fromLane: sourceLane,
        toLane: sourceLane,
        startMinutes: 9 * 60 + 10,
        endMinutes: 10 * 60 + 10,
      });
      expect(onResizeItem).toHaveBeenCalledWith({
        item: source,
        lane: sourceLane,
        edge: 'end',
        startMinutes: 9 * 60,
        endMinutes: 10 * 60 - 10,
      });
      expect(onDropObjectOnItem).toHaveBeenCalledWith({
        object: source.dragObject,
        targetItem: target,
        targetLane: sourceLane,
      });
    },
  );

  it.each(['event', 'timebox'] as const)(
    'routes all-day %s open, move, resize, and relationship gestures through shared callbacks',
    async (appearance) => {
      const user = userEvent.setup();
      const title = appearance === 'event' ? 'Event day' : 'Timebox day';
      const source = {
        ...item(`${appearance}-all-day-source`, title),
        appearance,
        allDay: true,
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-07-02T00:00:00.000Z',
        dragObject: {
          kind: 'calendar_item' as const,
          itemId: `${appearance}-all-day-source`,
          title,
        },
      };
      const target = {
        ...item(`${appearance}-all-day-target`, 'Planning review'),
        startsAt: '2026-07-01T11:00:00.000Z',
        endsAt: '2026-07-01T12:00:00.000Z',
        dropTarget: true,
      };
      const sourceLane = lane([source, target]);
      const targetLane: ScheduleLane = {
        id: 'next-date',
        label: 'Thu, Jul 2',
        date: '2026-07-02',
        items: [],
      };
      const onOpenItem = vi.fn();
      const onMoveAllDayItem = vi.fn();
      const onResizeAllDayItem = vi.fn();
      const onDropObjectOnItem = vi.fn();
      render(
        <SchedulingCanvas
          displayTimezone="UTC"
          lanes={[sourceLane, targetLane]}
          pixelsPerHour={60}
          viewportWidth={800}
          onOpenItem={onOpenItem}
          onMoveAllDayItem={onMoveAllDayItem}
          onResizeAllDayItem={onResizeAllDayItem}
          onDropObjectOnItem={onDropObjectOnItem}
        />,
      );

      await user.click(screen.getByRole('button', { name: title }));
      fireEvent.keyDown(screen.getByRole('button', { name: `Move ${title}` }), {
        key: 'ArrowRight',
      });
      fireEvent.keyDown(screen.getByRole('button', { name: `Resize ${title} from end` }), {
        key: 'ArrowRight',
      });
      const relationshipSource = screen.getByRole('button', {
        name: `Create relationship from ${title}`,
      });
      await user.click(relationshipSource);
      expect(relationshipSource).toHaveClass('[--color-ring:var(--color-on-primary-container)]');
      await user.click(screen.getByRole('button', { name: `Link ${title} to Planning review` }));

      expect(onOpenItem).toHaveBeenCalledWith({ item: source, lane: sourceLane });
      expect(onMoveAllDayItem).toHaveBeenCalledWith({
        item: source,
        fromLane: sourceLane,
        toLane: targetLane,
        startDate: '2026-07-02',
        endDate: '2026-07-03',
      });
      expect(onResizeAllDayItem).toHaveBeenCalledWith({
        item: source,
        fromLane: sourceLane,
        toLane: targetLane,
        edge: 'end',
        startDate: '2026-07-01',
        endDate: '2026-07-03',
      });
      expect(onDropObjectOnItem).toHaveBeenCalledWith({
        object: source.dragObject,
        targetItem: target,
        targetLane: sourceLane,
      });
    },
  );

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
        expect(surface.style.backgroundColor).toBe('var(--schedule-item-fill)');
        expect(renderedItem.style.getPropertyValue('--schedule-item-fill')).toContain('color-mix');
        expect(surface).not.toHaveStyle({ backgroundColor: '#316eb4' });
        expect(body).toHaveClass('text-(--schedule-item-foreground)');
        expect(renderedItem.style.getPropertyValue('--schedule-item-foreground')).toBe(
          'var(--color-on-surface)',
        );
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
    expect(preview?.querySelector('[data-schedule-item-surface]')).not.toHaveClass(
      'bg-surface-container-high',
    );
    expect(
      preview?.querySelector<HTMLElement>('[data-schedule-item-surface]')?.style.backgroundColor,
    ).toBe('var(--schedule-item-fill)');
    const previewFill =
      (preview as HTMLElement | null)?.style.getPropertyValue('--schedule-item-fill') ?? '';
    const previewFocus =
      (preview as HTMLElement | null)?.style.getPropertyValue('--schedule-item-focus') ?? '';
    expect(previewFill).toBe('var(--color-surface-container-high)');
    expect(
      (preview as HTMLElement | null)?.style.getPropertyValue('--schedule-item-foreground'),
    ).toBe('var(--color-on-surface)');
    for (const theme of SCHEDULE_TEST_THEMES) {
      expect(scheduleSurfaceContrast(previewFill, previewFocus, theme)).toBeGreaterThanOrEqual(3);
    }
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
