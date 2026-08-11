'use client';

import { ListView, Schedule, TuneRounded } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

import { useAgenda } from './agenda-context';

/** Agenda view and density settings kept behind one narrow-rail affordance. */
export default function AgendaDisplayMenu(): JSX.Element {
  const { view, setView } = useAgenda();

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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
