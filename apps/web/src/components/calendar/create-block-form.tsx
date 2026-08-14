'use client';

/** Google-style quick create for a toolbar action or selected scheduling region. */
import {
  CalendarItemCreate,
  CalendarLayerId,
  type CalendarItemCreateIntent,
  type CalendarLayerOut,
  type CalendarPreferences,
  type WorkPlaceOut,
} from '@docket/types';
import { SHELL_DESKTOP_QUERY, useShellOverlayHost } from '@docket/ui/components';
import { Plus, X } from '@docket/ui/icons';
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
import { type JSX, type SubmitEventHandler, useEffect, useMemo, useRef, useState } from 'react';

import { CalendarCreateFailureNotice } from './calendar-create-failure-notice';
import { useCreateCalendarItem } from './calendar-mutations';
import {
  type CalendarRegionSelection,
  calendarTimeDraftForDate,
  calendarTimeDraftFromSeed,
  defaultCalendarRegionSelection,
  isCalendarTimedRegionSelection,
  rebaseCalendarTimeDraft,
  resolveCalendarTimeDraft,
} from './calendar-time-draft';
import { CreateBlockScheduleEditor } from './create-block-schedule-editor';
import { CreateBlockTypeSelector } from './create-block-type-selector';
import { useClampedDialogPosition } from './use-clamped-dialog-position';

export type {
  CalendarAllDayRegionSelection,
  CalendarRegionSelection,
  CalendarTimedRegionSelection,
} from './calendar-time-draft';

const CALENDAR_CONTROL_CLASS =
  'min-h-9 w-9 min-w-9 shrink gap-1.5 px-2 [&_svg]:size-4 @min-[22rem]:min-h-11 @min-[22rem]:w-11 @min-[22rem]:min-w-11 @2xl:min-h-8 @2xl:w-auto @2xl:min-w-8 @2xl:shrink-0 @2xl:px-3';

function focusCreatedCalendarItem(itemId: string): void {
  let attempts = 0;
  const focusWhenRendered = (): void => {
    const target = document.querySelector<HTMLElement>(`[data-schedule-item-body="${itemId}"]`);
    if (target) {
      target.focus();
      return;
    }
    attempts += 1;
    if (attempts < 120) window.requestAnimationFrame(focusWhenRendered);
  };
  window.requestAnimationFrame(focusWhenRendered);
}

function calendarSelectionKey(
  selection: CalendarRegionSelection | null | undefined,
): string | null {
  if (!selection) return null;
  return isCalendarTimedRegionSelection(selection)
    ? `timed\u0000${selection.startsAt}\u0000${selection.endsAt}`
    : `all-day\u0000${selection.allDayStartDate}\u0000${selection.allDayEndDate}`;
}

/** Props for {@link CreateBlockForm}. */
export interface CreateBlockFormProps {
  readonly displayTimezone: string;
  readonly layers?: readonly CalendarLayerOut[] | undefined;
  readonly preferences?: CalendarPreferences | undefined;
  readonly selection?: CalendarRegionSelection | null | undefined;
  readonly selectionAnchorRef?: PopoverVirtualAnchorRef | undefined;
  readonly onSelectionConsumed?: (() => void) | undefined;
  readonly trigger?: 'visible' | 'hidden' | undefined;
  readonly presentation?: 'calendar' | 'agenda' | undefined;
  readonly onDraftChange?: ((selection: CalendarRegionSelection) => void) | undefined;
  readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
  /** Agenda-owned sibling host used below the shell desktop breakpoint. */
  readonly agendaMobileHost?: HTMLElement | null | undefined;
  /** Caller-loaded arbitrary saved places available for canonical binding. */
  readonly workPlaces?: readonly WorkPlaceOut[] | undefined;
}

/** Focus-managed quick create; Agenda uses a draggable sibling hosted outside its rail. */
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
  agendaMobileHost,
  workPlaces = [],
}: CreateBlockFormProps): JSX.Element {
  const agendaDesktop = useMediaQuery(SHELL_DESKTOP_QUERY);
  const shellOverlayHost = useShellOverlayHost();
  const create = useCreateCalendarItem();
  const resetCreate = create.reset;
  const [draft, setDraft] = useState(() =>
    calendarTimeDraftFromSeed(defaultCalendarRegionSelection(displayTimezone), displayTimezone),
  );
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [workPlaceId, setWorkPlaceId] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [intent, setIntent] = useState<CalendarItemCreateIntent>(
    preferences?.defaultCreateIntent ?? 'event',
  );
  const [layerId, setLayerId] = useState<CalendarLayerOut['id'] | ''>(
    preferences?.defaultLayerId ?? '',
  );
  const [allDayDraft, setAllDayDraft] = useState<{ start: string; end: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const previousSelectionKey = useRef<string | null>(null);
  const projectedSelectionKey = useRef<string | null>(null);
  const previousTimezone = useRef(displayTimezone);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const intentEdited = useRef(false);
  const layerEdited = useRef(false);
  const position = useClampedDialogPosition({
    open: open && presentation === 'agenda' && agendaDesktop,
    host: shellOverlayHost,
    anchorRef: selectionAnchorRef,
    anchorKey: calendarSelectionKey(selection),
  });

  const destinations = useMemo(
    () => layers.filter((layer) => layer.sourceKind === 'native_blocks' || layer.editableCore),
    [layers],
  );
  const configuredLayerAvailable =
    !preferences?.defaultLayerId ||
    destinations.some((layer) => layer.id === preferences.defaultLayerId);
  const resolvedTime = allDayDraft ? null : resolveCalendarTimeDraft(draft);
  const invalidField =
    resolvedTime && 'invalidField' in resolvedTime ? resolvedTime.invalidField : null;
  const resolvedStartsAt =
    resolvedTime && !('invalidField' in resolvedTime) ? resolvedTime.startsAt : null;
  const resolvedEndsAt =
    resolvedTime && !('invalidField' in resolvedTime) ? resolvedTime.endsAt : null;
  const allDayValid = allDayDraft
    ? Boolean(allDayDraft.start && allDayDraft.end && allDayDraft.start < allDayDraft.end)
    : false;
  const canSave = Boolean(
    title.trim() && (allDayDraft ? allDayValid : resolvedTime && !('invalidField' in resolvedTime)),
  );

  const selectionKey = calendarSelectionKey(selection);

  function resetFields(): void {
    setTitle('');
    setDescription('');
    setLocation('');
    setWorkPlaceId('');
    setShowDetails(false);
    setDirty(false);
    intentEdited.current = false;
    layerEdited.current = false;
    setIntent(preferences?.defaultCreateIntent ?? 'event');
    setLayerId(configuredLayerAvailable ? (preferences?.defaultLayerId ?? '') : '');
    resetCreate();
  }

  useEffect(() => {
    const projectedSelection =
      selectionKey !== null && selectionKey === projectedSelectionKey.current;
    const newSelection =
      selection != null && selectionKey !== previousSelectionKey.current && !projectedSelection;
    const timezoneChanged = displayTimezone !== previousTimezone.current;
    if (newSelection) {
      if (isCalendarTimedRegionSelection(selection)) {
        setDraft(calendarTimeDraftFromSeed(selection, displayTimezone));
        setAllDayDraft(null);
      } else {
        setDraft(calendarTimeDraftForDate(selection.allDayStartDate, displayTimezone));
        setAllDayDraft({ start: selection.allDayStartDate, end: selection.allDayEndDate });
      }
      resetFields();
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
    if (projectedSelection) projectedSelectionKey.current = null;
    previousTimezone.current = displayTimezone;
  }, [configuredLayerAvailable, displayTimezone, open, preferences, selection, selectionKey]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!open || !onDraftChange) return;
    if (allDayDraft) {
      const nextSelection = {
        allDayStartDate: allDayDraft.start,
        allDayEndDate: allDayDraft.end,
      };
      projectedSelectionKey.current = calendarSelectionKey(nextSelection);
      onDraftChange(nextSelection);
    } else if (resolvedStartsAt && resolvedEndsAt) {
      const nextSelection = { startsAt: resolvedStartsAt, endsAt: resolvedEndsAt };
      projectedSelectionKey.current = calendarSelectionKey(nextSelection);
      onDraftChange(nextSelection);
    }
  }, [allDayDraft, onDraftChange, open, resolvedEndsAt, resolvedStartsAt]);

  function handleOpenChange(next: boolean): void {
    if (next && !selection) {
      const region = defaultCalendarRegionSelection(displayTimezone);
      setDraft(calendarTimeDraftFromSeed(region, displayTimezone));
      setAllDayDraft(null);
      resetFields();
    }
    if (!next) {
      if (create.isPending) return;
      if (dirty && !window.confirm('Discard this unsaved calendar item?')) return;
      setOpen(false);
      resetFields();
      onSelectionConsumed?.();
      return;
    }
    setOpen(true);
  }

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!canSave) return;
    const input = CalendarItemCreate.parse({
      intent,
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(location.trim()
        ? { location: location.trim() }
        : workPlaceId
          ? { location: workPlaces.find((place) => place.id === workPlaceId)?.name }
          : {}),
      ...(workPlaceId ? { workPlaceId } : {}),
      ...(allDayDraft
        ? { allDayStartDate: allDayDraft.start, allDayEndDate: allDayDraft.end }
        : resolvedTime && !('invalidField' in resolvedTime)
          ? {
              startsAt: resolvedTime.startsAt,
              endsAt: resolvedTime.endsAt,
              timezone: resolvedTime.timezone,
              ...(resolvedTime.endTimezone !== resolvedTime.timezone
                ? { endTimezone: resolvedTime.endTimezone }
                : {}),
            }
          : {}),
      ...(intent === 'event' && layerId ? { layerId } : {}),
    });
    create.mutate(input, {
      onSuccess: (item) => {
        setOpen(false);
        resetFields();
        onSelectionConsumed?.();
        focusCreatedCalendarItem(item.id);
      },
    });
  };

  const form = (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="block">
        <span className="sr-only">Title</span>
        <Input
          ref={titleInputRef}
          value={title}
          aria-invalid={!title.trim()}
          onChange={(event) => {
            setTitle(event.target.value);
            setDirty(true);
          }}
          placeholder="Add title"
          className="aria-invalid:border-error text-title-large h-11 rounded-none border-x-0 border-t-0 px-0 aria-invalid:ring-0"
        />
      </label>

      <CreateBlockTypeSelector
        intent={intent}
        onChange={(value) => {
          intentEdited.current = true;
          setIntent(value);
          setDirty(true);
        }}
      />

      <CreateBlockScheduleEditor
        draft={draft}
        allDayDraft={allDayDraft}
        currentTimezone={displayTimezone}
        invalidField={invalidField}
        onChange={(next) => {
          setDraft(next);
          setDirty(true);
          resetCreate();
        }}
        onAllDayChange={(next) => {
          setAllDayDraft(next);
          setDirty(true);
          resetCreate();
        }}
      />

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
        </label>
      ) : null}

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
              placeholder="Add description"
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
              placeholder="Add location"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label-medium text-on-surface-variant">Saved place</span>
            <Select
              value={workPlaceId}
              onChange={(event) => {
                setWorkPlaceId(event.target.value);
                setDirty(true);
              }}
            >
              <option value="">No saved place</option>
              {workPlaces.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
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
            More options
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
        <Button type="submit" size="sm" className="h-9" disabled={!canSave || create.isPending}>
          {create.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );

  const notice = <CalendarCreateFailureNotice visible={create.isError} />;

  if (presentation === 'agenda') {
    const desktopHosted = agendaDesktop ? shellOverlayHost : null;
    const mobileHosted = !agendaDesktop ? (agendaMobileHost ?? null) : null;
    const portalHost = desktopHosted ?? mobileHosted ?? null;
    const overlayClassName = desktopHosted
      ? 'pointer-events-none absolute inset-0 bg-transparent'
      : mobileHosted
        ? 'absolute inset-0 bg-surface'
        : undefined;
    return (
      <>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent
            ref={position.dialogRef}
            portalContainer={portalHost}
            overlayClassName={overlayClassName}
            showClose={false}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              titleInputRef.current?.focus();
            }}
            aria-label="Create calendar item"
            className={
              desktopHosted
                ? 'pointer-events-auto absolute m-0 max-h-[calc(100%-2rem)] w-[min(34rem,calc(100%-2rem))] max-w-none translate-x-0 translate-y-0 gap-3 overflow-y-auto p-5'
                : mobileHosted
                  ? 'absolute inset-0 m-0 h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 gap-3 overflow-y-auto rounded-none border-0 p-4 shadow-none'
                  : 'inset-x-0 top-auto bottom-0 left-0 max-h-[85dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-t-xl rounded-b-none p-4'
            }
            style={desktopHosted ? position.style : undefined}
            data-create-presentation={desktopHosted ? 'agenda-desktop' : 'agenda-mobile'}
          >
            {desktopHosted ? (
              <div className="-mx-2 -mt-2 flex h-8 items-center justify-center">
                <button
                  type="button"
                  aria-label="Move create-event dialog"
                  onPointerDown={position.handlePointerDown}
                  onKeyDown={position.handleKeyDown}
                  className="group focus-visible:ring-ring flex h-6 w-14 cursor-grab touch-none items-center justify-center rounded-md select-none focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing"
                >
                  <span className="bg-outline-variant group-hover:bg-outline h-1 w-10 rounded-full" />
                </button>
              </div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              iconOnly
              aria-label="Close"
              className="absolute top-3 right-3"
              onClick={() => {
                handleOpenChange(false);
              }}
            >
              <X aria-hidden="true" />
            </Button>
            <DialogTitle className="sr-only">Create calendar item</DialogTitle>
            <DialogDescription className="sr-only">
              Add a title, adjust the schedule, and save the selected calendar region.
            </DialogDescription>
            {form}
          </DialogContent>
        </Dialog>
        {notice}
      </>
    );
  }

  return (
    <>
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
        <PopoverContent aria-label="Create calendar item" className="w-[26rem] p-4" align="start">
          {form}
        </PopoverContent>
      </Popover>
      {notice}
    </>
  );
}
