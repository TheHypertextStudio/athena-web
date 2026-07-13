'use client';

/**
 * `calendar/create-block-form` — quick create for a selected scheduling region.
 *
 * @remarks
 * The legacy filename is retained for import compatibility, but the form now creates either an
 * event or a first-class timebox. A pointer selection only supplies local draft bounds; nothing is
 * persisted until the user confirms the popover.
 */
import {
  CalendarLayerId,
  type CalendarItemCreate,
  type CalendarItemCreateIntent,
  type CalendarLayerOut,
  type CalendarPreferences,
} from '@docket/types';
import { Plus } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@docket/ui/primitives';
import type { QueryKey } from '@tanstack/react-query';
import { type JSX, type SubmitEventHandler, useEffect, useMemo, useState } from 'react';

import { useCreateCalendarItem } from './calendar-mutations';
import { fromLocalInputValue, toLocalInputValue } from './datetime-input';

/** A draft region supplied by the scheduling canvas. */
export interface CalendarRegionSelection {
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Round forward to the next half-hour for toolbar-triggered creation. */
function defaultSelection(): CalendarRegionSelection {
  const start = new Date();
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() < 30 ? 30 : 0);
  if (start.getMinutes() === 0) start.setHours(start.getHours() + 1);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
  };
}

/** Props for {@link CreateBlockForm}. */
export interface CreateBlockFormProps {
  readonly rangeKeys: readonly QueryKey[];
  readonly layers?: readonly CalendarLayerOut[];
  readonly preferences?: CalendarPreferences;
  readonly selection?: CalendarRegionSelection | null;
  readonly onSelectionConsumed?: () => void;
}

/** Event/timebox quick-create popover, opened from the toolbar or a selected canvas region. */
export default function CreateBlockForm({
  rangeKeys,
  layers = [],
  preferences,
  selection,
  onSelectionConsumed,
}: CreateBlockFormProps): JSX.Element {
  const create = useCreateCalendarItem();
  const defaults = useMemo(defaultSelection, []);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [intent, setIntent] = useState<CalendarItemCreateIntent>(
    preferences?.defaultCreateIntent ?? 'event',
  );
  const [layerId, setLayerId] = useState<CalendarLayerOut['id'] | ''>(
    preferences?.defaultLayerId ?? '',
  );
  const [startsAt, setStartsAt] = useState(() => toLocalInputValue(defaults.startsAt));
  const [endsAt, setEndsAt] = useState(() => toLocalInputValue(defaults.endsAt));

  const destinations = useMemo(
    () => layers.filter((layer) => layer.sourceKind === 'native_blocks' || layer.editableCore),
    [layers],
  );
  const configuredLayerAvailable =
    !preferences?.defaultLayerId ||
    destinations.some((layer) => layer.id === preferences.defaultLayerId);

  useEffect(() => {
    if (!selection) return;
    setStartsAt(toLocalInputValue(selection.startsAt));
    setEndsAt(toLocalInputValue(selection.endsAt));
    setIntent(preferences?.defaultCreateIntent ?? 'event');
    setLayerId(configuredLayerAvailable ? (preferences?.defaultLayerId ?? '') : '');
    setOpen(true);
  }, [configuredLayerAvailable, preferences, selection]);

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    const input = {
      intent,
      title: trimmed,
      startsAt: fromLocalInputValue(startsAt),
      endsAt: fromLocalInputValue(endsAt),
      ...(intent === 'event' && layerId ? { layerId } : {}),
    } satisfies CalendarItemCreate;
    create.mutate(
      { input, rangeKeys },
      {
        onSuccess: () => {
          setOpen(false);
          setTitle('');
          onSelectionConsumed?.();
        },
      },
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && !selection) {
          const region = defaultSelection();
          setStartsAt(toLocalInputValue(region.startsAt));
          setEndsAt(toLocalInputValue(region.endsAt));
          setIntent(preferences?.defaultCreateIntent ?? 'event');
          setLayerId(configuredLayerAvailable ? (preferences?.defaultLayerId ?? '') : '');
        }
        setOpen(next);
        if (!next) onSelectionConsumed?.();
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus /> New
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div
            role="group"
            aria-label="Calendar item type"
            className="border-outline-variant grid grid-cols-2 rounded-md border p-0.5"
          >
            {(['event', 'timebox'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={intent === value}
                onClick={() => {
                  setIntent(value);
                }}
                className={cn(
                  'rounded px-2 py-1.5 text-xs font-medium capitalize',
                  intent === value
                    ? 'bg-surface-container-high text-on-surface'
                    : 'text-on-surface-variant',
                )}
              >
                {value}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium">
            <span className="text-on-surface-variant">Title</span>
            <Input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              placeholder={intent === 'timebox' ? 'Deep work' : 'Event title'}
              autoFocus
            />
          </label>

          {intent === 'event' ? (
            <label className="flex flex-col gap-1 text-xs font-medium">
              <span className="text-on-surface-variant">Calendar</span>
              <select
                value={layerId}
                onChange={(event) => {
                  setLayerId(event.target.value ? CalendarLayerId.parse(event.target.value) : '');
                }}
                className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                <option value="">Docket calendar</option>
                {destinations.map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.title}
                  </option>
                ))}
              </select>
              {!configuredLayerAvailable ? (
                <span className="text-on-surface-variant text-[11px]">
                  Your saved calendar is unavailable, so this will use Docket.
                </span>
              ) : null}
            </label>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium">
              <span className="text-on-surface-variant">Starts</span>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => {
                  setStartsAt(event.target.value);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              <span className="text-on-surface-variant">Ends</span>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(event) => {
                  setEndsAt(event.target.value);
                }}
              />
            </label>
          </div>
          <Button type="submit" size="sm" disabled={!title.trim() || create.isPending}>
            {create.isPending ? 'Creating…' : `Create ${intent}`}
          </Button>
          {create.isError ? (
            <p role="alert" className="text-destructive text-xs">
              Could not create this calendar item. Try again.
            </p>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}
