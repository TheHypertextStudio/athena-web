import { act, render } from '@testing-library/react';
import { ProjectViewRow } from '@docket/work/work-view-contract';
import type { JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ScheduleChange } from '../../src/components/timeline/cascade';
import type { TimelineSpan } from '../../src/components/timeline/timeline-catalog';
import type { ProjectTimelineAdapterProps } from '../../src/components/work-views/project-timeline-adapter';

interface CapturedTimelineProps {
  readonly canSchedule: boolean;
  readonly onReschedule: (id: string, span: TimelineSpan) => void;
  readonly onApplyCascade: (changes: readonly ScheduleChange[]) => void;
}

const captured = vi.hoisted(() => ({ current: null as CapturedTimelineProps | null }));

vi.mock('../../src/components/timeline/timeline-canvas', () => ({
  default: (props: CapturedTimelineProps): JSX.Element => {
    captured.current = props;
    return <div data-testid="timeline-canvas" />;
  },
}));

vi.mock('../../src/components/timeline/use-timeline-viewport', () => ({
  useTimelineViewport: () => ({
    window: { min: 0, max: 1 },
    scale: { min: 0, max: 1, granularity: 'day', ticks: [] },
    setWindow: vi.fn(),
    resetToToday: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    panEarlier: vi.fn(),
    panLater: vi.fn(),
  }),
}));

import { ProjectTimelineAdapter } from '../../src/components/work-views/project-timeline-adapter';

const ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
const PROJECT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA1';
const row = ProjectViewRow.parse({
  target: 'project',
  organizationId: ORGANIZATION_ID,
  id: PROJECT_ID,
  name: 'Local project',
  status: 'started',
  priority: 'high',
  health: 'on_track',
  lead: null,
  members: [],
  teams: [],
  program: null,
  initiatives: [],
  labels: [],
  startDate: '2026-08-01',
  targetDate: '2026-08-31',
  creator: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  progress: 0.5,
  taskCount: 4,
  dependencyCount: 0,
  milestones: [],
  blockedByIds: [],
  blocksIds: [],
  manualRank: 'a0',
  isContext: false,
});
const from = { start: Date.UTC(2026, 7, 1), end: Date.UTC(2026, 7, 10) };
const to = { start: Date.UTC(2026, 7, 11), end: Date.UTC(2026, 7, 20) };

function adapterProps(
  canSchedule: boolean,
  onReschedule: ProjectTimelineAdapterProps['onReschedule'],
  onApplyCascade: ProjectTimelineAdapterProps['onApplyCascade'],
): ProjectTimelineAdapterProps {
  return {
    organizationId: ORGANIZATION_ID,
    rows: [row],
    density: 'compact',
    canSchedule,
    onReschedule,
    onApplyCascade,
    applyingCascade: false,
    onActivate: vi.fn(),
    onPrefetch: vi.fn(),
  };
}

describe('ProjectTimelineAdapter mutation permissions', () => {
  it('rejects retained reschedule and cascade callbacks after permission becomes read-only', () => {
    const onReschedule = vi.fn<ProjectTimelineAdapterProps['onReschedule']>();
    const onApplyCascade = vi.fn<ProjectTimelineAdapterProps['onApplyCascade']>();
    const view = render(
      <ProjectTimelineAdapter {...adapterProps(true, onReschedule, onApplyCascade)} />,
    );

    view.rerender(
      <ProjectTimelineAdapter {...adapterProps(false, onReschedule, onApplyCascade)} />,
    );
    const timeline = captured.current;
    if (timeline === null) throw new Error('expected timeline props');
    act(() => {
      timeline.onReschedule(PROJECT_ID, to);
      timeline.onApplyCascade([{ id: PROJECT_ID, from, to }]);
    });

    expect(onReschedule).not.toHaveBeenCalled();
    expect(onApplyCascade).not.toHaveBeenCalled();
  });
});
