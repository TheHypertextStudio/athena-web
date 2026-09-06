'use client';

/**
 * `calendar/item-drawer/use-core-field-drafts` — the editable state behind an event's own fields.
 *
 * @remarks
 * Moved out of the editor component unchanged. It owns every draft, the dirty comparison the
 * dialog's dismissal guard reads, the blur commits for text, and the debounced commit for the
 * schedule — which is debounced rather than blurred because a native date or time control behaves
 * like a select and fires no useful blur.
 *
 * The drafts themselves come from `core-field-draft.ts`, which keeps a local edit while adopting
 * refreshed server values for every field the person has not touched. That is what lets a
 * background refetch land mid-edit without either discarding the edit or resurrecting a stale
 * value, and it is why the schedule fields encode their fold choice alongside their wall value:
 * the two have to rebase together or a repeated hour resolves to the wrong instant.
 */
import type { CalendarItemOut } from '@docket/planning/calendar-contract';
import { WorkPlaceId } from '@docket/planning/ids';
import { useEffect, useId, useState } from 'react';

import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

import {
  type LocalInputOccurrence,
  localInputOccurrenceForInstant,
  toLocalInputValue,
} from '../datetime-input';
import { useUpdateCalendarItem } from '../calendar-mutations';
import { useRebasedField, useRebasedLocalTimeField } from './core-field-draft';
import { localAllDayEndSeed } from './presentation';
import { resolveSchedulePatch } from './schedule-commit';

/** One text field bound to its draft and its blur commit. */
export interface TextFieldBinding {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onBlur: () => void;
}

/** Everything the event's own fields need in order to render and save themselves. */
export interface CoreFieldEditor {
  /** Whether this viewer may change the event at all. */
  readonly canEdit: boolean;
  /** Whether the item is timed rather than all-day. */
  readonly timed: boolean;
  readonly title: TextFieldBinding;
  readonly description: TextFieldBinding;
  readonly location: TextFieldBinding;
  /** The saved-place binding, which writes immediately because it is a picker. */
  readonly workPlaceId: string;
  readonly setWorkPlace: (workPlaceId: string) => void;
  readonly start: ReturnType<typeof useRebasedLocalTimeField>;
  readonly end: ReturnType<typeof useRebasedLocalTimeField>;
  readonly allDayStart: string;
  readonly setAllDayStart: (value: string) => void;
  readonly allDayEnd: string;
  readonly setAllDayEnd: (value: string) => void;
  /** Application-owned copy explaining why the schedule cannot be saved yet. */
  readonly timeError: string | null;
  readonly clearTimeError: () => void;
  /** Application-owned copy explaining why the title cannot be saved. */
  readonly titleError: string | null;
  readonly timeErrorId: string;
  readonly titleErrorId: string;
  /** Whether the last save failed. */
  readonly saveFailed: boolean;
  /** Whether a save is in flight. */
  readonly saving: boolean;
  /** Whether the last save succeeded. */
  readonly saved: boolean;
}

interface ScheduleSeeds {
  readonly startSeed: string;
  readonly endSeed: string;
  readonly startOccurrenceSeed: LocalInputOccurrence | null;
  readonly endOccurrenceSeed: LocalInputOccurrence | null;
}

/** The saved schedule, expressed the way the wall-clock controls read it. */
function scheduleSeeds(item: CalendarItemOut, displayTimezone: string): ScheduleSeeds {
  const seed = (iso: string | null): string => (iso ? toLocalInputValue(iso, displayTimezone) : '');
  const occurrence = (iso: string | null): LocalInputOccurrence | null =>
    iso ? localInputOccurrenceForInstant(iso, displayTimezone) : null;
  return {
    startSeed: seed(item.startsAt),
    endSeed: seed(item.endsAt),
    startOccurrenceSeed: occurrence(item.startsAt),
    endOccurrenceSeed: occurrence(item.endsAt),
  };
}

/** One comparable snapshot of the schedule, so the autosave only fires on a real edit. */
function scheduleSnapshot(
  timed: boolean,
  start: string,
  startOccurrence: LocalInputOccurrence | null,
  end: string,
  endOccurrence: LocalInputOccurrence | null,
): { readonly mode: string; readonly start: string; readonly end: string } {
  return timed
    ? {
        mode: 'timed',
        start: `${start}|${startOccurrence ?? ''}`,
        end: `${end}|${endOccurrence ?? ''}`,
      }
    : { mode: 'all-day', start, end };
}

/**
 * One rebased text field plus the guard that keeps it from writing a no-op.
 *
 * @param saved - The value currently on the server.
 * @param canEdit - Whether this viewer may write at all.
 * @param commit - Send the changed value.
 * @returns the binding a field renders from.
 */
function useTextField(
  saved: string,
  canEdit: boolean,
  commit: (value: string) => void,
): TextFieldBinding {
  const [value, setValue] = useRebasedField(saved);
  return {
    value,
    onChange: setValue,
    onBlur: () => {
      if (!canEdit || value === saved) return;
      commit(value);
    },
  };
}

/** The saved schedule, in the shape the autosave compares drafts against. */
function savedScheduleSnapshot(
  item: CalendarItemOut,
  timed: boolean,
  seeds: ScheduleSeeds,
  savedAllDayEnd: string,
): ReturnType<typeof scheduleSnapshot> {
  if (timed) {
    return scheduleSnapshot(
      true,
      seeds.startSeed,
      seeds.startOccurrenceSeed,
      seeds.endSeed,
      seeds.endOccurrenceSeed,
    );
  }
  return scheduleSnapshot(false, item.allDayStartDate ?? '', null, savedAllDayEnd, null);
}

/** Every draft value the dirty comparison reads. */
interface DraftValues {
  readonly title: string;
  readonly description: string;
  readonly location: string;
  readonly timed: boolean;
  readonly scheduleEdited: boolean;
  readonly allDayStart: string;
  readonly allDayEnd: string;
  readonly savedAllDayEnd: string;
}

/**
 * Whether anything on this event differs from what is saved.
 *
 * @remarks
 * The dialog's dismissal guard reads this, so it has to account for the all-day fields as well as
 * the timed ones — a person who moved an all-day event and closed the dialog before the debounce
 * fired would otherwise lose the edit silently.
 *
 * @param item - The saved event.
 * @param draft - The current draft values.
 * @returns whether there is an unsaved change.
 */
function coreFieldsDirty(item: CalendarItemOut, draft: DraftValues): boolean {
  if (draft.title !== item.title) return true;
  if (draft.description !== (item.description ?? '')) return true;
  if (draft.location !== (item.location ?? '')) return true;
  if (draft.timed) return draft.scheduleEdited;
  return (
    draft.allDayStart !== (item.allDayStartDate ?? '') || draft.allDayEnd !== draft.savedAllDayEnd
  );
}

/** Props for {@link useCoreFieldDrafts}. */
export interface UseCoreFieldDraftsOptions {
  /** The saved item every draft is measured against. */
  readonly item: CalendarItemOut;
  /** The hub timezone wall-clock values are read in. */
  readonly displayTimezone: string;
  /** Report unsaved changes so the dialog can guard dismissal. */
  readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
}

/**
 * Own every editable field on one calendar event.
 *
 * @param options - The {@link UseCoreFieldDraftsOptions}.
 * @returns the bindings and save state the field components render from.
 */
export function useCoreFieldDrafts({
  item,
  displayTimezone,
  onDirtyChange,
}: UseCoreFieldDraftsOptions): CoreFieldEditor {
  const update = useUpdateCalendarItem(item.id);
  const canEdit = item.permissions.canEditCore;
  const timed = item.startsAt !== null;
  const seeds = scheduleSeeds(item, displayTimezone);
  const { startSeed, endSeed, startOccurrenceSeed, endOccurrenceSeed } = seeds;

  const [title, setTitle] = useRebasedField(item.title);
  const description = useTextField(item.description ?? '', canEdit, (value) => {
    update.mutate({ description: value });
  });
  const location = useTextField(item.location ?? '', canEdit, (value) => {
    update.mutate({ location: value });
  });
  const [workPlaceId, setWorkPlaceId] = useRebasedField(item.workPlaceId ?? '');
  const start = useRebasedLocalTimeField(startSeed, startOccurrenceSeed);
  const end = useRebasedLocalTimeField(endSeed, endOccurrenceSeed);
  const [allDayStart, setAllDayStart] = useRebasedField(item.allDayStartDate ?? '');
  const [allDayEnd, setAllDayEnd] = useRebasedField(localAllDayEndSeed(item.allDayEndDate));
  const [timeError, setTimeError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const timeErrorId = useId();
  const titleErrorId = useId();

  const savedAllDayEnd = localAllDayEndSeed(item.allDayEndDate);
  const dirty = coreFieldsDirty(item, {
    title,
    description: description.value,
    location: location.value,
    timed,
    scheduleEdited: start.dirty || end.dirty,
    allDayStart,
    allDayEnd,
    savedAllDayEnd,
  });

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => {
      onDirtyChange?.(false);
    };
  }, [dirty, onDirtyChange]);

  const commitTitle = (): void => {
    if (!canEdit || title === item.title) return;
    if (title.trim().length === 0) {
      setTitleError('Enter a title to save your changes.');
      return;
    }
    update.mutate({ title });
  };

  const commitSchedule = (): void => {
    if (!canEdit) return;
    const commit = resolveSchedulePatch({
      item,
      displayTimezone,
      start: { wallValue: start.wallValue, occurrence: start.occurrence, edited: start.dirty },
      end: { wallValue: end.wallValue, occurrence: end.occurrence, edited: end.dirty },
      allDayStart,
      allDayEnd,
    });
    if (commit.kind === 'noop') return;
    if (commit.kind === 'error') {
      setTimeError(commit.reason);
      return;
    }
    update.mutate(commit.patch);
  };

  useDebouncedAutosave({
    // Diff the draft against its persisted seed so the debounce only fires on a real edit.
    value: scheduleSnapshot(
      timed,
      start.wallValue,
      start.occurrence,
      end.wallValue,
      end.occurrence,
    ),
    baseline: savedScheduleSnapshot(item, timed, seeds, savedAllDayEnd),
    ready: canEdit,
    save: commitSchedule,
  });

  return {
    canEdit,
    timed,
    title: {
      value: title,
      onChange: (value) => {
        setTitle(value);
        setTitleError(null);
      },
      onBlur: commitTitle,
    },
    description,
    location,
    workPlaceId,
    setWorkPlace: (next) => {
      setWorkPlaceId(next);
      update.mutate({ workPlaceId: next ? WorkPlaceId.parse(next) : null });
    },
    start,
    end,
    allDayStart,
    setAllDayStart,
    allDayEnd,
    setAllDayEnd,
    timeError,
    clearTimeError: () => {
      setTimeError(null);
    },
    titleError,
    timeErrorId,
    titleErrorId,
    saveFailed: update.isError,
    saving: update.isPending,
    saved: update.isSuccess,
  };
}
