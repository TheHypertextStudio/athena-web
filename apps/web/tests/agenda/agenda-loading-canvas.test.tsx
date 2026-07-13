import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SchedulingCanvasProps } from '../../src/components/scheduling';

const canvas = vi.hoisted<{ props: SchedulingCanvasProps | undefined }>(() => ({
  props: undefined,
}));
const agendaState = vi.hoisted<{
  date: string;
  displayTimezone: string;
  pixelsPerHour: number;
  view: 'timeline' | 'list';
  entries: never[];
  loading: boolean;
  setTimebox: ReturnType<typeof vi.fn>;
  clearTimeboxFailure: ReturnType<typeof vi.fn>;
  timeboxFailed: boolean;
}>(() => ({
  date: '2026-07-13',
  displayTimezone: 'UTC',
  pixelsPerHour: 72,
  view: 'timeline',
  entries: [],
  loading: true,
  setTimebox: vi.fn(),
  clearTimeboxFailure: vi.fn(),
  timeboxFailed: false,
}));
const reset = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('../../src/components/agenda/agenda-context', () => ({
  isTimeboxed: () => false,
  useAgenda: () => agendaState,
}));

vi.mock('../../src/components/scheduling', () => ({
  isInlineEditableScheduleItem: () => false,
  scheduleInstantAt: () => null,
  SchedulingCanvas: (props: SchedulingCanvasProps) => {
    canvas.props = props;
    return <div aria-label="Today time grid" />;
  },
}));

vi.mock('../../src/components/calendar/calendar-mutations', () => ({
  useUpdateCalendarItemById: () => ({ mutate: vi.fn(), reset, isError: false }),
  useLinkTaskToCalendarItem: () => ({ mutate: vi.fn(), reset, isError: false }),
  useRelateCalendarItems: () => ({ mutate: vi.fn(), reset, isError: false }),
}));

vi.mock('../../src/components/calendar/calendar-item-drawer', () => ({
  default: () => null,
}));

vi.mock('../../src/components/agenda/agenda-entry-card', () => ({
  default: () => null,
}));

vi.mock('../../src/lib/use-now', () => ({
  useNow: () => new Date('2026-07-13T16:00:00.000Z'),
}));

import AgendaCanvas from '../../src/components/agenda/agenda-canvas';

afterEach(() => {
  cleanup();
  canvas.props = undefined;
  agendaState.view = 'timeline';
});

describe('AgendaCanvas initial loading', () => {
  it('keeps the timeline mounted without claiming the empty result is final', () => {
    render(<AgendaCanvas />);

    expect(screen.getByLabelText('Today time grid')).toBeInTheDocument();
    expect(canvas.props?.emptyMessage).toBe('');
    expect(canvas.props?.viewportHeight).toBe('100%');
  });

  it('does not announce an empty list before the initial read settles', () => {
    agendaState.view = 'list';

    render(<AgendaCanvas />);

    expect(screen.queryByText('Nothing scheduled.')).not.toBeInTheDocument();
  });
});
