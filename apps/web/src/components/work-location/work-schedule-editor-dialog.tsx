'use client';

/** Nested editors for the default work cycle and complete dated replacements. */
import type {
  WorkPlaceOut,
  WorkScheduleCycleDay,
  WorkScheduleExceptionCreate,
  WorkSchedulePlanCreate,
  WorkSchedulePlanOut,
  WorkScheduleSegment,
} from '@docket/planning/work-location-contract';
import { addCalendarDays } from '@docket/planning/calendar-date';
import { Copy, Plus, Trash2 } from '@docket/ui/icons';
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  Text,
} from '@docket/ui/primitives';
import { type JSX, type SubmitEventHandler, useEffect, useState } from 'react';

import { DatePicker } from '@/components/date-picker';

const DAY_MINUTES = 1_440;
const MAX_DURATION_MINUTES = DAY_MINUTES * 7;
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' });

/** Return the local day name for one cycle index, or its numbered rotation label. */
export function workScheduleDayLabel(
  anchorDate: string,
  cycleLength: number,
  index: number,
): string {
  if (cycleLength !== 7) return `Day ${String(index + 1)}`;
  const date = new Date(`${anchorDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return WEEKDAY.format(date);
}

/** Render one schedule segment in owner-facing local time and place language. */
export function workScheduleSegmentSummary(
  segment: WorkScheduleSegment,
  places: readonly WorkPlaceOut[],
): string {
  const time = (minute: number): string =>
    new Date(2000, 0, 1, Math.floor(minute / 60), minute % 60).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  const end = segment.startMinute + segment.durationMinutes;
  const endDay = Math.floor(end / DAY_MINUTES);
  const placeId = segment.location.type === 'saved_place' ? segment.location.placeId : null;
  const location =
    placeId !== null
      ? (places.find((place) => place.id === placeId)?.name ?? 'Saved place')
      : segment.location.type === 'mobile'
        ? 'Mobile'
        : 'Location undecided';
  return `${time(segment.startMinute)}–${time(end % DAY_MINUTES)}${endDay ? ` +${String(endDay)}d` : ''} · ${location}`;
}

/** Props for the default-cycle editor. */
export interface WorkScheduleEditorDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly plan: WorkSchedulePlanOut | null;
  readonly places: readonly WorkPlaceOut[];
  readonly fallbackTimezone: string;
  readonly pending: boolean;
  readonly error?: string | null;
  readonly onSave: (value: WorkSchedulePlanCreate) => void;
}

function cloneDays(days: readonly WorkScheduleCycleDay[]): WorkScheduleCycleDay[] {
  return days.map((day) => ({
    segments: day.segments.map((segment) => ({
      ...segment,
      location: { ...segment.location },
    })),
  }));
}

function orderedSegments(segments: readonly WorkScheduleSegment[]): WorkScheduleSegment[] {
  return [...segments].sort((left, right) => left.startMinute - right.startMinute);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentWeekAnchor(): string {
  const current = new Date(`${today()}T12:00:00.000Z`);
  const daysAfterMonday = (current.getUTCDay() + 6) % 7;
  current.setUTCDate(current.getUTCDate() - daysAfterMonday);
  return current.toISOString().slice(0, 10);
}

function nextVersionStart(plan: WorkSchedulePlanOut | null): string {
  if (!plan) return today();
  const firstUnusedDate = addCalendarDays(plan.effectiveFrom, 1);
  return firstUnusedDate > today() ? firstUnusedDate : today();
}

function emptyWeek(): WorkScheduleCycleDay[] {
  return Array.from({ length: 7 }, () => ({ segments: [] }));
}

function timeValue(minute: number): string {
  const normalized = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function endDayLabel(offset: number): string {
  if (offset === 0) return 'Same day';
  return `+${String(offset)} ${offset === 1 ? 'day' : 'days'}`;
}

function parseTime(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

function resizeCycle(
  days: readonly WorkScheduleCycleDay[],
  length: number,
): WorkScheduleCycleDay[] {
  return Array.from({ length }, (_, index) => days[index] ?? { segments: [] }).map((day) => ({
    segments: [...day.segments],
  }));
}

/** Edit the complete default cycle one selected day at a time. */
export function WorkScheduleEditorDialog({
  open,
  onOpenChange,
  plan,
  places,
  fallbackTimezone,
  pending,
  error,
  onSave,
}: WorkScheduleEditorDialogProps): JSX.Element {
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [anchorDate, setAnchorDate] = useState(currentWeekAnchor);
  const [timezone, setTimezone] = useState(fallbackTimezone);
  const [days, setDays] = useState<WorkScheduleCycleDay[]>(emptyWeek);
  const [selectedDay, setSelectedDay] = useState(0);

  useEffect(() => {
    if (!open) return;
    setEffectiveFrom(nextVersionStart(plan));
    setAnchorDate(plan?.anchorDate ?? currentWeekAnchor());
    setTimezone(plan?.timezone ?? fallbackTimezone);
    setDays(plan ? cloneDays(plan.cycleDays) : emptyWeek());
    setSelectedDay(0);
  }, [fallbackTimezone, open, plan]);

  const selected = days[selectedDay] ?? { segments: [] };
  const selectedLabel = workScheduleDayLabel(anchorDate, days.length, selectedDay);

  const updateSegment = (index: number, next: WorkScheduleSegment): void => {
    setDays((current) =>
      current.map((day, dayIndex) =>
        dayIndex === selectedDay
          ? {
              segments: day.segments.map((segment, segmentIndex) =>
                segmentIndex === index ? next : segment,
              ),
            }
          : day,
      ),
    );
  };

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (pending) return;
    onSave({
      anchorDate,
      timezone: timezone.trim(),
      effectiveFrom,
      effectiveUntil: null,
      cycleDays: days.map((day) => ({ segments: orderedSegments(day.segments) })),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent presentation={{ kind: 'centered', size: 'wide', height: 'tall' }}>
        <DialogHeader>
          <DialogTitle>{plan ? 'Edit default schedule' : 'Create default schedule'}</DialogTitle>
          <DialogDescription>
            Set the times and places that repeat. Saving starts a new version on the date you
            choose.
          </DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={submit}>
          <DialogBody className="flex min-h-0 flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
                Cycle length
                <Input
                  aria-label="Cycle length"
                  type="number"
                  min={1}
                  max={28}
                  value={days.length}
                  onChange={(event) => {
                    const length = Math.max(1, Math.min(28, Number(event.target.value) || 1));
                    setDays((current) => resizeCycle(current, length));
                    setSelectedDay((current) => Math.min(current, length - 1));
                  }}
                />
              </label>
              <div className="text-on-surface-variant text-label-medium flex flex-col gap-1">
                <span>Schedule applies from</span>
                <DatePicker
                  ariaLabel="Schedule applies from"
                  min={nextVersionStart(plan)}
                  placeholder="Pick a day"
                  triggerVariant="outline"
                  value={effectiveFrom || null}
                  onChange={(value) => {
                    setEffectiveFrom(value ?? '');
                  }}
                />
              </div>
              <div className="text-on-surface-variant text-label-medium flex flex-col gap-1">
                <span>Cycle starts</span>
                <DatePicker
                  ariaLabel="Cycle starts"
                  placeholder="Pick a day"
                  triggerVariant="outline"
                  value={anchorDate || null}
                  onChange={(value) => {
                    setAnchorDate(value ?? '');
                  }}
                />
              </div>
              <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
                Time zone
                <Input
                  aria-label="Time zone"
                  value={timezone}
                  onChange={(event) => {
                    setTimezone(event.target.value);
                  }}
                />
              </label>
            </div>

            <div className="grid min-h-0 gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
              <nav aria-label="Work cycle days" className="flex gap-2 overflow-x-auto md:flex-col">
                {days.map((day, index) => {
                  const label = workScheduleDayLabel(anchorDate, days.length, index);
                  const detail =
                    day.segments.length === 0
                      ? 'Not working'
                      : `${String(day.segments.length)} work ${day.segments.length === 1 ? 'period' : 'periods'}`;
                  return (
                    <button
                      key={`${label}-${String(index)}`}
                      type="button"
                      aria-pressed={selectedDay === index}
                      onClick={() => {
                        setSelectedDay(index);
                      }}
                      className="data-[pressed=true]:bg-secondary-container data-[pressed=true]:text-on-secondary-container hover:bg-surface-container-high focus-visible:ring-primary min-w-36 rounded-xl px-3 py-2 text-left outline-none focus-visible:ring-2 md:min-w-0"
                      data-pressed={selectedDay === index}
                    >
                      <span className="text-label-large block">{label}</span>
                      <span className="text-body-small block opacity-75">{detail}</span>
                    </button>
                  );
                })}
              </nav>

              <section className="bg-surface-container-low flex min-h-72 min-w-0 flex-col gap-3 rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Text as="h3" token="title-medium">
                      {selectedLabel}
                    </Text>
                    <Text token="body-small" tone="muted">
                      {selected.segments.length === 0
                        ? 'You do not normally work on this day.'
                        : 'Work periods may use different places and can cross midnight.'}
                    </Text>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        <Copy aria-hidden="true" />
                        Copy day
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" width="sm">
                      {days.map((_, index) =>
                        index === selectedDay ? null : (
                          <DropdownMenuItem
                            key={index}
                            onSelect={() => {
                              setDays((current) =>
                                current.map((day, dayIndex) =>
                                  dayIndex === index ? (cloneDays([selected])[0] ?? day) : day,
                                ),
                              );
                            }}
                          >
                            {workScheduleDayLabel(anchorDate, days.length, index)}
                          </DropdownMenuItem>
                        ),
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {selected.segments.map((segment, index) => {
                  const end = segment.startMinute + segment.durationMinutes;
                  const locationValue =
                    segment.location.type === 'saved_place'
                      ? `place:${segment.location.placeId}`
                      : segment.location.type;
                  return (
                    <div
                      key={index}
                      className="bg-surface-container grid gap-3 rounded-xl p-3 sm:grid-cols-[1fr_1fr_5.5rem_minmax(10rem,1.4fr)_auto] sm:items-end"
                    >
                      <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
                        Start
                        <Input
                          type="time"
                          value={timeValue(segment.startMinute)}
                          onChange={(event) => {
                            updateSegment(index, {
                              ...segment,
                              startMinute: parseTime(event.target.value),
                            });
                          }}
                        />
                      </label>
                      <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
                        End
                        <Input
                          type="time"
                          value={timeValue(end)}
                          onChange={(event) => {
                            const endMinute = parseTime(event.target.value);
                            const dayOffset = Math.floor(end / DAY_MINUTES);
                            let duration =
                              dayOffset * DAY_MINUTES + endMinute - segment.startMinute;
                            if (duration <= 0) duration += DAY_MINUTES;
                            updateSegment(index, {
                              ...segment,
                              durationMinutes: Math.min(duration, MAX_DURATION_MINUTES),
                            });
                          }}
                        />
                      </label>
                      <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
                        End day
                        <Select
                          aria-label={`End day for period ${String(index + 1)}`}
                          value={String(Math.floor(end / DAY_MINUTES))}
                          onChange={(event) => {
                            const dayOffset = Number(event.target.value);
                            let duration =
                              dayOffset * DAY_MINUTES + (end % DAY_MINUTES) - segment.startMinute;
                            if (duration <= 0) duration += DAY_MINUTES;
                            updateSegment(index, {
                              ...segment,
                              durationMinutes: Math.min(duration, MAX_DURATION_MINUTES),
                            });
                          }}
                        >
                          {Array.from({ length: 8 }, (_, offset) => (
                            <option key={offset} value={offset}>
                              {endDayLabel(offset)}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
                        Location
                        <Select
                          aria-label={`Location for period ${String(index + 1)}`}
                          value={locationValue}
                          onChange={(event) => {
                            const value = event.target.value;
                            const place = places.find(
                              (candidate) => candidate.id === value.slice('place:'.length),
                            );
                            const location: WorkScheduleSegment['location'] = place
                              ? { type: 'saved_place', placeId: place.id }
                              : value === 'mobile'
                                ? { type: 'mobile' }
                                : { type: 'undecided' };
                            updateSegment(index, { ...segment, location });
                          }}
                        >
                          {places.map((place) => (
                            <option key={place.id} value={`place:${place.id}`}>
                              {place.name}
                            </option>
                          ))}
                          <option value="mobile">Mobile</option>
                          <option value="undecided">Undecided</option>
                        </Select>
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove period ${String(index + 1)}`}
                        onClick={() => {
                          setDays((current) =>
                            current.map((day, dayIndex) =>
                              dayIndex === selectedDay
                                ? {
                                    segments: day.segments.filter(
                                      (_, segmentIndex) => segmentIndex !== index,
                                    ),
                                  }
                                : day,
                            ),
                          );
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  );
                })}

                <Button
                  type="button"
                  variant="outline"
                  className="self-start"
                  onClick={() => {
                    const location: WorkScheduleSegment['location'] = places[0]
                      ? { type: 'saved_place', placeId: places[0].id }
                      : { type: 'undecided' };
                    setDays((current) =>
                      current.map((day, index) =>
                        index === selectedDay
                          ? {
                              segments: [
                                ...day.segments,
                                { startMinute: 540, durationMinutes: 480, location },
                              ],
                            }
                          : day,
                      ),
                    );
                  }}
                >
                  <Plus aria-hidden="true" />
                  Add work period
                </Button>
              </section>
            </div>
            {error ? (
              <p role="alert" className="text-error text-body-small">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!effectiveFrom || !anchorDate || !timezone.trim() || pending}
            >
              Save schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Props for one-date replacement editor. */
export interface WorkScheduleDateDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly places: readonly WorkPlaceOut[];
  readonly minimumDate: string;
  readonly pending: boolean;
  readonly error?: string | null;
  readonly onSave: (value: WorkScheduleExceptionCreate) => void;
}

function defaultSegment(places: readonly WorkPlaceOut[]): WorkScheduleSegment {
  const location: WorkScheduleSegment['location'] = places[0]
    ? { type: 'saved_place', placeId: places[0].id }
    : { type: 'undecided' };
  return { startMinute: 540, durationMinutes: 480, location };
}

function segmentLocationValue(segment: WorkScheduleSegment): string {
  return segment.location.type === 'saved_place'
    ? `place:${segment.location.placeId}`
    : segment.location.type;
}

function segmentLocation(
  value: string,
  places: readonly WorkPlaceOut[],
): WorkScheduleSegment['location'] {
  const place = places.find((candidate) => candidate.id === value.slice('place:'.length));
  if (place) return { type: 'saved_place', placeId: place.id };
  return value === 'mobile' ? { type: 'mobile' } : { type: 'undecided' };
}

function durationFromEnd(
  segment: WorkScheduleSegment,
  endMinute: number,
  dayOffset: number,
): number {
  let duration = dayOffset * DAY_MINUTES + endMinute - segment.startMinute;
  if (duration <= 0) duration += DAY_MINUTES;
  return Math.min(duration, MAX_DURATION_MINUTES);
}

function DatedSegmentRow(props: {
  readonly index: number;
  readonly segment: WorkScheduleSegment;
  readonly places: readonly WorkPlaceOut[];
  readonly onChange: (segment: WorkScheduleSegment) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const end = props.segment.startMinute + props.segment.durationMinutes;
  const dayOffset = Math.floor(end / DAY_MINUTES);
  return (
    <div className="bg-surface-container grid gap-3 rounded-xl p-3 sm:grid-cols-[1fr_1fr_6rem_minmax(10rem,1.4fr)_auto] sm:items-end">
      <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
        Start
        <Input
          aria-label={`Start for period ${String(props.index + 1)}`}
          type="time"
          value={timeValue(props.segment.startMinute)}
          onChange={(event) => {
            props.onChange({ ...props.segment, startMinute: parseTime(event.target.value) });
          }}
        />
      </label>
      <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
        End
        <Input
          aria-label={`End for period ${String(props.index + 1)}`}
          type="time"
          value={timeValue(end)}
          onChange={(event) => {
            props.onChange({
              ...props.segment,
              durationMinutes: durationFromEnd(
                props.segment,
                parseTime(event.target.value),
                dayOffset,
              ),
            });
          }}
        />
      </label>
      <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
        End day
        <Select
          aria-label={`End day for period ${String(props.index + 1)}`}
          value={String(dayOffset)}
          onChange={(event) => {
            props.onChange({
              ...props.segment,
              durationMinutes: durationFromEnd(
                props.segment,
                end % DAY_MINUTES,
                Number(event.target.value),
              ),
            });
          }}
        >
          {Array.from({ length: 8 }, (_, offset) => (
            <option key={offset} value={offset}>
              {endDayLabel(offset)}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-on-surface-variant text-label-medium flex flex-col gap-1">
        Location
        <Select
          aria-label={`Location for period ${String(props.index + 1)}`}
          value={segmentLocationValue(props.segment)}
          onChange={(event) => {
            props.onChange({
              ...props.segment,
              location: segmentLocation(event.target.value, props.places),
            });
          }}
        >
          {props.places.map((place) => (
            <option key={place.id} value={`place:${place.id}`}>
              {place.name}
            </option>
          ))}
          <option value="mobile">Mobile</option>
          <option value="undecided">Undecided</option>
        </Select>
      </label>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove period ${String(props.index + 1)}`}
        onClick={props.onRemove}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  );
}

/** Create a whole-date replacement without exposing provider event mechanics. */
export function WorkScheduleDateDialog({
  open,
  onOpenChange,
  places,
  minimumDate,
  pending,
  error,
  onSave,
}: WorkScheduleDateDialogProps): JSX.Element {
  const [date, setDate] = useState(minimumDate);
  const [segments, setSegments] = useState<WorkScheduleSegment[]>([]);

  useEffect(() => {
    if (!open) return;
    setDate(minimumDate);
    setSegments([]);
  }, [minimumDate, open]);

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!pending) onSave({ date, segments: orderedSegments(segments) });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent presentation={{ kind: 'centered', size: 'wide', height: 'tall' }}>
        <DialogHeader>
          <DialogTitle>Add date change</DialogTitle>
          <DialogDescription>
            This date replaces the default day. Leave it empty for a day off, or define every work
            period that should apply.
          </DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={submit}>
          <DialogBody className="flex flex-col gap-4">
            <div className="text-on-surface-variant text-label-medium flex max-w-56 flex-col gap-1">
              <span>Date</span>
              <DatePicker
                ariaLabel="Date change"
                min={minimumDate}
                placeholder="Pick a day"
                triggerVariant="outline"
                value={date || null}
                onChange={(value) => {
                  setDate(value ?? '');
                }}
              />
            </div>
            {segments.length === 0 ? (
              <div className="bg-surface-container rounded-xl p-4">
                <Text token="title-small">Not working</Text>
                <Text token="body-small" tone="muted">
                  This date has no work periods and replaces the complete default day.
                </Text>
              </div>
            ) : (
              segments.map((segment, index) => (
                <DatedSegmentRow
                  key={index}
                  index={index}
                  segment={segment}
                  places={places}
                  onChange={(next) => {
                    setSegments((current) =>
                      current.map((item, itemIndex) => (itemIndex === index ? next : item)),
                    );
                  }}
                  onRemove={() => {
                    setSegments((current) => current.filter((_, itemIndex) => itemIndex !== index));
                  }}
                />
              ))
            )}
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => {
                setSegments((current) => [...current, defaultSegment(places)]);
              }}
            >
              <Plus aria-hidden="true" />
              Add work period
            </Button>
            {error ? (
              <p role="alert" className="text-error text-body-small">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!date || pending}>
              Save date change
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
