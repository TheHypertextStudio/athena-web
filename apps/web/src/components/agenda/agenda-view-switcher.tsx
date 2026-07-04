'use client';

/**
 * `agenda/agenda-view-switcher` — a compact segmented toggle for the agenda's view mode.
 *
 * @remarks
 * Reads/sets the active view from {@link useAgenda}. Two segments (list / timeline) composed from the
 * {@link Button} primitive — the active one filled, the rest ghost — inside a tonal track.
 */
import { ListView, Schedule } from '@docket/ui/icons';
import { Button, Row } from '@docket/ui/primitives';
import { type JSX, type ReactNode } from 'react';

import { type AgendaView, useAgenda } from './agenda-context';

/** The list/timeline segmented control. */
export default function AgendaViewSwitcher(): JSX.Element {
  const { view, setView } = useAgenda();
  return (
    <Row gap={0} className="bg-surface-container rounded-md p-0.5">
      <ViewSegment view="list" active={view} onSelect={setView} label="List view">
        <ListView />
      </ViewSegment>
      <ViewSegment view="timeline" active={view} onSelect={setView} label="Timeline view">
        <Schedule />
      </ViewSegment>
    </Row>
  );
}

/** Props for {@link ViewSegment}. */
interface ViewSegmentProps {
  /** The view this segment selects. */
  view: AgendaView;
  /** The currently active view. */
  active: AgendaView;
  /** Select a view. */
  onSelect: (view: AgendaView) => void;
  /** Accessible label for the segment. */
  label: string;
  /** The segment glyph. */
  children: ReactNode;
}

/** One segment: a filled button when active, ghost otherwise. */
function ViewSegment({ view, active, onSelect, label, children }: ViewSegmentProps): JSX.Element {
  const isActive = view === active;
  return (
    <Button
      variant={isActive ? 'secondary' : 'ghost'}
      size="icon"
      aria-pressed={isActive}
      aria-label={label}
      title={label}
      onClick={() => {
        onSelect(view);
      }}
      className="size-7 shadow-none transition-transform duration-(--dur-fast) active:scale-90"
    >
      {children}
    </Button>
  );
}
