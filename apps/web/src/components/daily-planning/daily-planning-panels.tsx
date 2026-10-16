'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  ControlGroup,
} from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useMediaQuery } from '@docket/ui/hooks';

/** Visible panels within the planning activity; this does not change the selected work. */
export interface PlanningPanels {
  readonly work: boolean;
  readonly agenda: boolean;
  readonly mobilePlan?: 'work' | 'agenda';
  readonly mobileReview?: 'work' | 'agenda';
}

/** On phones, focus one panel without changing desktop visibility or unmounting its content. */
export function visiblePlanningPanels(
  panels: PlanningPanels,
  reviewing: boolean,
  wide: boolean,
): Pick<PlanningPanels, 'work' | 'agenda'> {
  if (wide) return { work: panels.work, agenda: panels.agenda };
  const selected = reviewing ? (panels.mobileReview ?? 'agenda') : (panels.mobilePlan ?? 'work');
  return { work: selected === 'work', agenda: selected === 'agenda' };
}

/** Show either planning panel or both while retaining at least one usable panel. */
export function PlanningPanelControls({
  panels,
  onChange,
  reviewing = false,
}: {
  readonly panels: PlanningPanels;
  readonly reviewing?: boolean;
  readonly onChange: (panels: PlanningPanels) => void;
}): JSX.Element {
  const wide = useMediaQuery('(min-width: 64rem)');
  const visible = visiblePlanningPanels(panels, reviewing, wide);
  if (!wide)
    return (
      <ControlGroup controlSize="sm" aria-label="Planning view">
        {(['work', 'agenda'] as const).map((key) => (
          <Button
            key={key}
            variant={visible[key] ? 'secondary' : 'ghost'}
            aria-pressed={visible[key]}
            onClick={() => {
              onChange({ ...panels, [reviewing ? 'mobileReview' : 'mobilePlan']: key });
            }}
          >
            {key === 'work' ? 'Work' : 'Agenda'}
          </Button>
        ))}
      </ControlGroup>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="min-h-10 sm:min-h-8">
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
