'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Visible panels within the planning activity; this does not change the selected work. */
export interface PlanningPanels {
  readonly work: boolean;
  readonly agenda: boolean;
}

/** Show either planning panel or both while retaining at least one usable panel. */
export function PlanningPanelControls({
  panels,
  onChange,
}: {
  readonly panels: PlanningPanels;
  readonly onChange: (panels: PlanningPanels) => void;
}): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="min-h-10 sm:min-h-8">
          Panels
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuCheckboxItem
          checked={panels.work}
          disabled={!panels.agenda}
          onCheckedChange={(work) => {
            onChange({ ...panels, work });
          }}
        >
          Work
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={panels.agenda}
          disabled={!panels.work}
          onCheckedChange={(agenda) => {
            onChange({ ...panels, agenda });
          }}
        >
          Agenda
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
