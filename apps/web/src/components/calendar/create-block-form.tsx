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
import { cn } from '@docket/ui';
import { Plus } from '@docket/ui/icons';
import {
  Button,
  focusRing,
  Input,
  Popover,
  PopoverAnchor,
  type PopoverVirtualAnchorRef,
  PopoverContent,
  PopoverTrigger,
} from '@docket/ui/primitives';
import {
  type JSX,
  type SubmitEventHandler,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type CalendarRegionSelection,
  calendarTimeDraftFromSeed,
  defaultCalendarRegionSelection,
  rebaseCalendarTimeDraft,
  resolveCalendarTimeDraft,
} from './calendar-time-draft';
import { CreateBlockTimeFields } from './create-block-time-fields';
import { CreateBlockTypeSelector } from './create-block-type-selector';
import { useCreateCalendarItem } from './calendar-mutations';

export type { CalendarRegionSelection } from './calendar-time-draft';

/**
 * The app's MD3 `<select>` recipe, matching `settings/team-mapping-picker.tsx`.
 *
 * @remarks
 * Replaces the legacy `border-input` / `bg-background` pair this control used to carry, which put
 * two token systems inside one popover. Every property is now the {@link Input} recipe verbatim —
 * `h-9`, `rounded-md`, one `outline-variant` hairline, a transparent fill, no elevation — so a text
 * field, a `<select>`, and a `datetime-local` stacked in this form are indistinguishable except for
 * what they do. They previously differed in both fill and box-shadow.
 */
const SELECT_CLASS =
  'border-outline-variant text-on-surface text-body-medium h-9 w-full rounded-md border bg-transparent px-3';

/**
 * The calendar toolbar row's shared control geometry.
 *
 * @remarks
 * Deliberately a copy of `(app)/calendar/calendar-view-settings.tsx`'s `CALENDAR_CONTROL_CLASS`
 * rather than an import: this is a `components/` module and must not depend on an `app/` route
 * module. Keep the two in step — the row's never-wrap guarantee depends on every control in it
 * being `shrink-0` at the same height.
 */
const CALENDAR_CONTROL_CLASS =
  'min-h-9 w-9 min-w-9 shrink gap-1.5 px-2 [&_svg]:size-4 @min-[22rem]:min-h-11 @min-[22rem]:w-11 @min-[22rem]:min-w-11 @2xl:min-h-8 @2xl:w-auto @2xl:min-w-8 @2xl:shrink-0 @2xl:px-3';

/** Props for {@link CreateBlockForm}. */
export interface CreateBlockFormProps {
  readonly displayTimezone: string;
  readonly layers?: readonly CalendarLayerOut[];
  readonly preferences?: CalendarPreferences;
  readonly selection?: CalendarRegionSelection | null;
  readonly selectionAnchorRef?: PopoverVirtualAnchorRef;
  readonly onSelectionConsumed?: () => void;
}

/** Event/timebox quick-create popover, opened from the toolbar or a selected canvas region. */
export default function CreateBlockForm({
  displayTimezone,
  layers = [],
  preferences,
  selection,
  selectionAnchorRef,
  onSelectionConsumed,
}: CreateBlockFormProps): JSX.Element {
  const create = useCreateCalendarItem();
  const resetCreate = create.reset;
  const [draft, setDraft] = useState(() =>
    calendarTimeDraftFromSeed(defaultCalendarRegionSelection(displayTimezone), displayTimezone),
  );
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [intent, setIntent] = useState<CalendarItemCreateIntent>(
    preferences?.defaultCreateIntent ?? 'event',
  );
  const [layerId, setLayerId] = useState<CalendarLayerOut['id'] | ''>(
    preferences?.defaultLayerId ?? '',
  );
  const [timeError, setTimeError] = useState<string | null>(null);
  const previousSelectionKey = useRef<string | null>(null);
  const previousTimezone = useRef(displayTimezone);
  const intentEdited = useRef(false);
  const layerEdited = useRef(false);
  const timeErrorId = useId();

  const destinations = useMemo(
    () => layers.filter((layer) => layer.sourceKind === 'native_blocks' || layer.editableCore),
    [layers],
  );
  const configuredLayerAvailable =
    !preferences?.defaultLayerId ||
    destinations.some((layer) => layer.id === preferences.defaultLayerId);

  const selectionKey = selection ? `${selection.startsAt}\u0000${selection.endsAt}` : null;
  useEffect(() => {
    const newSelection = selection != null && selectionKey !== previousSelectionKey.current;
    const timezoneChanged = displayTimezone !== previousTimezone.current;
    if (newSelection) {
      setDraft(calendarTimeDraftFromSeed(selection, displayTimezone));
      setTitle('');
      setTimeError(null);
      intentEdited.current = false;
      layerEdited.current = false;
      setIntent(preferences?.defaultCreateIntent ?? 'event');
      setLayerId(configuredLayerAvailable ? (preferences?.defaultLayerId ?? '') : '');
      resetCreate();
      setOpen(true);
    } else if (timezoneChanged) {
      setDraft((current) => rebaseCalendarTimeDraft(current, displayTimezone));
    }
    if (!newSelection && open) {
      if (!intentEdited.current) setIntent(preferences?.defaultCreateIntent ?? 'event');
      if (!layerEdited.current) {
        setLayerId(configuredLayerAvailable ? (preferences?.defaultLayerId ?? '') : '');
      }
    }
    previousSelectionKey.current = selectionKey;
    previousTimezone.current = displayTimezone;
  }, [
    configuredLayerAvailable,
    displayTimezone,
    open,
    preferences,
    resetCreate,
    selection,
    selectionKey,
  ]);

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    const resolvedTime = resolveCalendarTimeDraft(draft, displayTimezone);
    if ('error' in resolvedTime) {
      setTimeError(resolvedTime.error);
      return;
    }
    const input = {
      intent,
      title: trimmed,
      startsAt: resolvedTime.startsAt,
      endsAt: resolvedTime.endsAt,
      ...(intent === 'event' && layerId ? { layerId } : {}),
    } satisfies CalendarItemCreate;
    create.mutate(input, {
      onSuccess: () => {
        setOpen(false);
        setTitle('');
        setTimeError(null);
        onSelectionConsumed?.();
      },
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && !selection) {
          const region = defaultCalendarRegionSelection(displayTimezone);
          setDraft(calendarTimeDraftFromSeed(region, displayTimezone));
          setTitle('');
          setTimeError(null);
          intentEdited.current = false;
          layerEdited.current = false;
          setIntent(preferences?.defaultCreateIntent ?? 'event');
          setLayerId(configuredLayerAvailable ? (preferences?.defaultLayerId ?? '') : '');
          resetCreate();
        }
        setOpen(next);
        if (!next) {
          setTitle('');
          setTimeError(null);
          intentEdited.current = false;
          layerEdited.current = false;
          resetCreate();
          onSelectionConsumed?.();
        }
      }}
    >
      {selection && selectionAnchorRef ? <PopoverAnchor virtualRef={selectionAnchorRef} /> : null}
      <PopoverTrigger asChild>
        {/*
          The label is conditional below `@2xl`, so the button carries its own accessible name. The
          `Button` base already sets `whitespace-nowrap`; `shrink-0` is what actually keeps this off
          a second row, since the bug was never the text breaking — it was the button being
          reflowed by a wrapping toolbar.
        */}
        <Button className={CALENDAR_CONTROL_CLASS} size="sm" variant="outline" aria-label="New">
          <Plus className="size-4" aria-hidden="true" />
          <span className="hidden @2xl:inline">New</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Create calendar item" className="w-80 p-3" align="start">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <CreateBlockTypeSelector
            intent={intent}
            onChange={(value) => {
              intentEdited.current = true;
              setIntent(value);
            }}
          />

          <label className="flex flex-col gap-1">
            <span className="text-label-medium text-on-surface-variant">Title</span>
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
            <label className="flex flex-col gap-1">
              <span className="text-label-medium text-on-surface-variant">Calendar</span>
              <select
                value={layerId}
                onChange={(event) => {
                  layerEdited.current = true;
                  setLayerId(event.target.value ? CalendarLayerId.parse(event.target.value) : '');
                }}
                className={cn(SELECT_CLASS, focusRing)}
              >
                <option value="">Docket calendar</option>
                {destinations.map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.title}
                  </option>
                ))}
              </select>
              {!configuredLayerAvailable ? (
                <span className="text-body-small text-on-surface-variant">
                  Your saved calendar is unavailable, so this will use Docket.
                </span>
              ) : null}
            </label>
          ) : null}

          <CreateBlockTimeFields
            draft={draft}
            displayTimezone={displayTimezone}
            error={timeError}
            errorId={timeErrorId}
            onStartChange={(value) => {
              setDraft((current) => ({
                ...current,
                startsAt: value,
                startsEdited: true,
                startsOccurrence: null,
              }));
              setTimeError(null);
            }}
            onEndChange={(value) => {
              setDraft((current) => ({
                ...current,
                endsAt: value,
                endsEdited: true,
                endsOccurrence: null,
              }));
              setTimeError(null);
            }}
            onStartOccurrenceChange={(occurrence) => {
              setDraft((current) => ({
                ...current,
                startsEdited: true,
                startsOccurrence: occurrence,
              }));
              setTimeError(null);
            }}
            onEndOccurrenceChange={(occurrence) => {
              setDraft((current) => ({
                ...current,
                endsEdited: true,
                endsOccurrence: occurrence,
              }));
              setTimeError(null);
            }}
          />
          {/*
            `h-9` matches the fields it sits under — a 32px button below a column of 36px inputs
            read as a different form. The hint is adjacent rather than a tooltip so the one reason
            the button is disabled is legible without hovering it.
          */}
          <div className="flex flex-col gap-1">
            <Button
              type="submit"
              size="sm"
              className="h-9"
              disabled={!title.trim() || create.isPending}
            >
              {create.isPending ? 'Creating…' : `Create ${intent}`}
            </Button>
            {!title.trim() && !create.isPending ? (
              <p className="text-on-surface-variant text-body-small">
                Add a title to create this {intent}.
              </p>
            ) : null}
          </div>
          {create.isError ? (
            <p role="alert" className="text-destructive text-body-small">
              Could not create this calendar item. Try again.
            </p>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}
