'use client';

import { ListView, Minus, Plus, Schedule } from '@docket/ui/icons';
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
import { AGENDA_SCALE_STEPS, agendaScaleStepDown, agendaScaleStepUp } from './agenda-scale';

/** Visible whole-step Agenda zoom: minus, current 1×–3×, plus. */
export function AgendaScaleControls(): JSX.Element {
  const { pixelsPerHour, setScale, view, setView } = useAgenda();
  const index = AGENDA_SCALE_STEPS.indexOf(pixelsPerHour as (typeof AGENDA_SCALE_STEPS)[number]);
  const label = `${Math.max(0, index) + 1}×`;
  return (
    <div
      role="group"
      aria-label="Agenda zoom"
      className="border-outline-variant bg-surface-container-low flex items-center rounded-md border p-0.5"
    >
      <Button
        type="button"
        variant="ghost"
        iconOnly
        controlSize="sm"
        aria-label="Zoom out"
        disabled={pixelsPerHour === AGENDA_SCALE_STEPS[0]}
        onClick={() => {
          setScale(agendaScaleStepDown(pixelsPerHour));
        }}
      >
        <Minus aria-hidden="true" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            controlSize="sm"
            aria-label={`Agenda display settings, ${label}`}
            className="text-label-medium w-9 px-1 tabular-nums"
          >
            {label}
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
      <Button
        type="button"
        variant="ghost"
        iconOnly
        controlSize="sm"
        aria-label="Zoom in"
        disabled={pixelsPerHour === AGENDA_SCALE_STEPS.at(-1)}
        onClick={() => {
          setScale(agendaScaleStepUp(pixelsPerHour));
        }}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}
