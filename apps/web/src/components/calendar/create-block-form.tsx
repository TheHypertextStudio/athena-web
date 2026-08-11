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
  CalendarItemCreate,
  type CalendarItemCreateIntent,
  type CalendarLayerOut,
  type CalendarPreferences,
} from '@docket/types';
import { Plus } from '@docket/ui/icons';
import { useMediaQuery } from '@docket/ui/hooks';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  type PopoverVirtualAnchorRef,
  Select,
  Textarea,
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

import { DatePicker } from '@/components/date-picker';

import {
  type CalendarRegionSelection,
  calendarTimeDraftFromSeed,
  defaultCalendarRegionSelection,
  isCalendarTimedRegionSelection,
  rebaseCalendarTimeDraft,
  resolveCalendarTimeDraft,
} from './calendar-time-draft';
import { CreateBlockTimeFields } from './create-block-time-fields';
import { CreateBlockTypeSelector } from './create-block-type-selector';
import { useCreateCalendarItem } from './calendar-mutations';

export type {
  CalendarAllDayRegionSelection,
  CalendarRegionSelection,
  CalendarTimedRegionSelection,
} from './calendar-time-draft';

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
  /** Calendar uses its toolbar trigger; Agenda opens only from a selected region. */
  readonly trigger?: 'visible' | 'hidden';
  /** Choose anchored Calendar placement or the responsive Agenda host. */
  readonly presentation?: 'calendar' | 'agenda';
  /** Receive valid exact draft bounds as wall-time fields are edited. */
  readonly onDraftChange?: (selection: CalendarRegionSelection) => void;
  /** Report whether any user-owned field differs from the initial selection. */
  readonly onDirtyChange?: (dirty: boolean) => void;
}

/** Event/timebox quick-create popover, opened from the toolbar or a selected canvas region. */
export default function CreateBlockForm({
  displayTimezone,
  layers = [],
  preferences,
  selection,
  selectionAnchorRef,
  onSelectionConsumed,
  trigger = 'visible',
  presentation = 'calendar',
  onDraftChange,
  onDirtyChange,
}: CreateBlockFormProps): JSX.Element {
  const agendaDesktop = useMediaQuery('(min-width: 48rem)');
  const create = useCreateCalendarItem();
  const resetCreate = create.reset;
  const [draft, setDraft] = useState(() =>
    calendarTimeDraftFromSeed(defaultCalendarRegionSelection(displayTimezone), displayTimezone),
  );
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [intent, setIntent] = useState<CalendarItemCreateIntent>(
    preferences?.defaultCreateIntent ?? 'event',
  );
  const [layerId, setLayerId] = useState<CalendarLayerOut['id'] | ''>(
    preferences?.defaultLayerId ?? '',
  );
  const [timeError, setTimeError] = useState<string | null>(null);
  const [allDayDraft, setAllDayDraft] = useState<{ start: string; end: string } | null>(null);
  const [dirty, setDirty] = useState(false);
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

  const selectionKey = selection
    ? isCalendarTimedRegionSelection(selection)
      ? `timed\u0000${selection.startsAt}\u0000${selection.endsAt}`
      : `all-day\u0000${selection.allDayStartDate}\u0000${selection.allDayEndDate}`
    : null;
  useEffect(() => {
    const newSelection = selection != null && selectionKey !== previousSelectionKey.current;
    const timezoneChanged = displayTimezone !== previousTimezone.current;
    if (newSelection) {
      if (isCalendarTimedRegionSelection(selection)) {
        setDraft(calendarTimeDraftFromSeed(selection, displayTimezone));
        setAllDayDraft(null);
      } else {
        setAllDayDraft({ start: selection.allDayStartDate, end: selection.allDayEndDate });
      }
      setTitle('');
      setDescription('');
      setLocation('');
      setShowDetails(false);
      setTimeError(null);
      setDirty(false);
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

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!open || !onDraftChange) return;
    if (allDayDraft) {
      onDraftChange({
        allDayStartDate: allDayDraft.start,
        allDayEndDate: allDayDraft.end,
      });
      return;
    }
    const resolved = resolveCalendarTimeDraft(draft, displayTimezone);
    if (!('error' in resolved)) onDraftChange(resolved);
  }, [allDayDraft, displayTimezone, draft, onDraftChange, open]);

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    const inputCandidate = {
      intent,
      title: trimmed,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(allDayDraft
        ? {
            allDayStartDate: allDayDraft.start,
            allDayEndDate: allDayDraft.end,
          }
        : (() => {
            const resolvedTime = resolveCalendarTimeDraft(draft, displayTimezone);
            if ('error' in resolvedTime) {
              setTimeError(resolvedTime.error);
              return null;
            }
            return { startsAt: resolvedTime.startsAt, endsAt: resolvedTime.endsAt };
          })()),
      ...(intent === 'event' && layerId ? { layerId } : {}),
    };
    if (!('startsAt' in inputCandidate) && !('allDayStartDate' in inputCandidate)) return;
    const input = CalendarItemCreate.parse(inputCandidate);
    create.mutate(input, {
      onSuccess: () => {
        setOpen(false);
        setTitle('');
        setDescription('');
        setLocation('');
        setShowDetails(false);
        setTimeError(null);
        onSelectionConsumed?.();
      },
    });
  };

  function handleOpenChange(next: boolean): void {
    if (next && !selection) {
      const region = defaultCalendarRegionSelection(displayTimezone);
      setDraft(calendarTimeDraftFromSeed(region, displayTimezone));
      setAllDayDraft(null);
      setTitle('');
      setDescription('');
      setLocation('');
      setShowDetails(false);
      setTimeError(null);
      setDirty(false);
      intentEdited.current = false;
      layerEdited.current = false;
      setIntent(preferences?.defaultCreateIntent ?? 'event');
      setLayerId(configuredLayerAvailable ? (preferences?.defaultLayerId ?? '') : '');
      resetCreate();
    }
    setOpen(next);
    if (!next) {
      setTitle('');
      setDescription('');
      setLocation('');
      setShowDetails(false);
      setTimeError(null);
      setDirty(false);
      intentEdited.current = false;
      layerEdited.current = false;
      resetCreate();
      onSelectionConsumed?.();
    }
  }

  const form = (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <CreateBlockTypeSelector
        intent={intent}
        onChange={(value) => {
          intentEdited.current = true;
          setIntent(value);
          setDirty(true);
        }}
      />

      <label className="flex flex-col gap-1">
        <span className="text-label-medium text-on-surface-variant">Title</span>
        <Input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setDirty(true);
          }}
          placeholder={intent === 'timebox' ? 'Deep work' : 'Event title'}
          autoFocus
        />
      </label>

      {intent === 'event' ? (
        <label className="flex flex-col gap-1">
          <span className="text-label-medium text-on-surface-variant">Calendar</span>
          <Select
            value={layerId}
            onChange={(event) => {
              layerEdited.current = true;
              setLayerId(event.target.value ? CalendarLayerId.parse(event.target.value) : '');
              setDirty(true);
            }}
          >
            <option value="">Docket calendar</option>
            {destinations.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.title}
              </option>
            ))}
          </Select>
          {!configuredLayerAvailable ? (
            <span className="text-body-small text-on-surface-variant">
              Your saved calendar is unavailable, so this will use Docket.
            </span>
          ) : null}
        </label>
      ) : null}

      {allDayDraft ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-label-medium text-on-surface-variant">Starts</span>
            <DatePicker
              ariaLabel="Starts"
              placeholder="Pick a day"
              triggerVariant="outline"
              value={allDayDraft.start}
              onChange={(next) => {
                setAllDayDraft((current) =>
                  current ? { ...current, start: next ?? '' } : current,
                );
                setDirty(true);
              }}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-label-medium text-on-surface-variant">Ends</span>
            <DatePicker
              ariaLabel="Ends"
              placeholder="Pick a day"
              triggerVariant="outline"
              value={allDayDraft.end}
              onChange={(next) => {
                setAllDayDraft((current) => (current ? { ...current, end: next ?? '' } : current));
                setDirty(true);
              }}
            />
          </div>
        </div>
      ) : (
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
            setDirty(true);
            setTimeError(null);
          }}
          onEndChange={(value) => {
            setDraft((current) => ({
              ...current,
              endsAt: value,
              endsEdited: true,
              endsOccurrence: null,
            }));
            setDirty(true);
            setTimeError(null);
          }}
          onStartOccurrenceChange={(occurrence) => {
            setDraft((current) => ({
              ...current,
              startsEdited: true,
              startsOccurrence: occurrence,
            }));
            setDirty(true);
            setTimeError(null);
          }}
          onEndOccurrenceChange={(occurrence) => {
            setDraft((current) => ({
              ...current,
              endsEdited: true,
              endsOccurrence: occurrence,
            }));
            setDirty(true);
            setTimeError(null);
          }}
        />
      )}

      {showDetails ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-label-medium text-on-surface-variant">Description</span>
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setDirty(true);
              }}
              placeholder="Add notes"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label-medium text-on-surface-variant">Location</span>
            <Input
              value={location}
              onChange={(event) => {
                setLocation(event.target.value);
                setDirty(true);
              }}
              placeholder="Add a location"
            />
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {!showDetails ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mr-auto"
            onClick={() => {
              setShowDetails(true);
            }}
          >
            More details
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            handleOpenChange(false);
          }}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="h-9"
          disabled={!title.trim() || create.isPending}
        >
          {create.isPending ? 'Creating…' : `Create ${intent}`}
        </Button>
      </div>
      {!title.trim() && !create.isPending ? (
        <p className="text-on-surface-variant text-body-small">
          Add a title to create this {intent}.
        </p>
      ) : null}
      {create.isError ? (
        <p role="alert" className="text-error text-body-small">
          Could not create this calendar item. Try again.
        </p>
      ) : null}
    </form>
  );

  if (presentation === 'agenda' && !agendaDesktop) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          aria-label="Create calendar item"
          className="inset-x-0 top-auto bottom-0 left-0 max-h-[85dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-t-xl rounded-b-none p-4"
          data-create-presentation="agenda-mobile"
        >
          <DialogTitle>Create calendar item</DialogTitle>
          <DialogDescription className="sr-only">
            Add a title, choose exact times, and save the selected calendar region.
          </DialogDescription>
          {form}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {selection && selectionAnchorRef ? <PopoverAnchor virtualRef={selectionAnchorRef} /> : null}
      {trigger === 'visible' ? (
        <PopoverTrigger asChild>
          <Button className={CALENDAR_CONTROL_CLASS} size="sm" variant="outline" aria-label="New">
            <Plus className="size-4" aria-hidden="true" />
            <span className="hidden @2xl:inline">New</span>
          </Button>
        </PopoverTrigger>
      ) : null}
      <PopoverContent
        aria-label="Create calendar item"
        className="w-80 p-3"
        align={presentation === 'agenda' ? 'end' : 'start'}
        data-create-presentation={presentation === 'agenda' ? 'agenda-desktop' : 'calendar'}
      >
        {form}
      </PopoverContent>
    </Popover>
  );
}
