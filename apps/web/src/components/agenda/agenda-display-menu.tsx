'use client';

import { ListView, Schedule, ChevronDown } from '@docket/ui/icons';
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

const DENSITY_LABELS = ['Compact', 'Comfortable', 'Expanded'] as const;

/** Agenda display menu for timeline density and presentation. */
export function AgendaDisplayMenu(): JSX.Element {
  const { pixelsPerHour, setScale, view, setView } = useAgenda();
  const viewLabel = view === 'list' ? 'List' : 'Timeline';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          controlSize="sm"
          aria-label={`${viewLabel} view options`}
          className="min-h-10 shrink-0 px-2"
        >
          {viewLabel}
          <ChevronDown aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width="sm">
        <DropdownMenuLabel>Density</DropdownMenuLabel>
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
              {DENSITY_LABELS[stepIndex]}
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
