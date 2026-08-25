'use client';

import { ListView, Schedule, TuneRounded } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

import { useAgenda } from './agenda-context';
import { AGENDA_SCALE_STEPS } from './agenda-scale';

/** Agenda display menu for timeline density and presentation. */
export function AgendaScaleControls(): JSX.Element {
  const { pixelsPerHour, setScale, view, setView } = useAgenda();
  const index = AGENDA_SCALE_STEPS.indexOf(pixelsPerHour as (typeof AGENDA_SCALE_STEPS)[number]);
  const label = `${Math.max(0, index) + 1}×`;
  const viewLabel = view === 'list' ? 'List' : 'Timeline';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          iconOnly
          controlSize="sm"
          aria-label={`Agenda display settings, ${label}, ${viewLabel}`}
          className="min-h-10 min-w-10"
        >
          <TuneRounded aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width="sm">
        <DropdownMenuLabel>Zoom</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={String(pixelsPerHour)}
          onValueChange={(next) => {
            const scale = Number(next);
            if (AGENDA_SCALE_STEPS.includes(scale as (typeof AGENDA_SCALE_STEPS)[number])) {
              setScale(scale);
            }
          }}
        >
          {AGENDA_SCALE_STEPS.map((step, stepIndex) => (
            <DropdownMenuRadioItem key={step} value={String(step)}>
              {stepIndex + 1}×
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>View</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={view}
          onValueChange={(next) => {
            setView(next === 'list' ? 'list' : 'timeline');
          }}
        >
          <DropdownMenuRadioItem value="timeline">
            <Schedule className="size-4" aria-hidden="true" />
            Timeline
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="list">
            <ListView className="size-4" aria-hidden="true" />
            List
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
