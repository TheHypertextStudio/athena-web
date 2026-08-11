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

/** Agenda view and density settings kept behind one narrow-rail affordance. */
export default function AgendaDisplayMenu(): JSX.Element {
  const { view, setView, pixelsPerHour, setScale } = useAgenda();

  function selectScale(next: string): void {
    setScale(Number(next));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" iconOnly controlSize="sm" aria-label="Agenda display settings">
          <TuneRounded aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width="sm">
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
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Scale</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(pixelsPerHour)} onValueChange={selectScale}>
          {AGENDA_SCALE_STEPS.map((scale, index) => (
            <DropdownMenuRadioItem key={scale} value={String(scale)}>
              {index + 1}×
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
