'use client';

import { Minus, Plus } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { useAgenda } from './agenda-context';
import { AGENDA_SCALE_STEPS, agendaScaleStepDown, agendaScaleStepUp } from './agenda-scale';

/** Visible whole-step Agenda zoom: minus, current 1×–3×, plus. */
export function AgendaScaleControls(): JSX.Element {
  const { pixelsPerHour, setScale } = useAgenda();
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
      <span className="text-label-medium w-8 text-center tabular-nums">{label}</span>
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
