'use client';

/**
 * `calendar/item-drawer/event-core-fields` — the event's own fields, as properties rather than a form.
 *
 * @remarks
 * These are exactly the fields a provider round-trips: what the event is called, when it runs,
 * where it is, and what it says. They used to render as six stacked labelled boxes, which made the
 * one detail surface in Docket that looked like a settings page rather than a thing. They now use
 * the shared property rail every other detail surface uses — a muted icon gutter, a calm label, and
 * a value that is itself the control.
 *
 * The saved place is deliberately not among them. A saved place is Docket's own idea and never
 * reaches the provider, so it belongs on the other side of the seam.
 *
 * Every accessible name here is unchanged from the form this replaces. The daylight-saving and
 * refetch-hydration tests address these fields by label, and they are the reason this rewrite is
 * safe: the state lives in {@link useCoreFieldDrafts} and the rules in `schedule-commit.ts`, so
 * only the presentation moved.
 */
import type { CalendarItemOut } from '@docket/planning/calendar-contract';
import { FileText, MapPin, Schedule } from '@docket/ui/icons';
import { Input, Textarea } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { DatePicker } from '@/components/date-picker';
import { PropertyPanelRow } from '@/components/property-pickers/property-panel';

import { CalendarTimeField } from '../calendar-time-field';
import { useAutoGrow } from './auto-grow';
import type { CoreFieldEditor } from './use-core-field-drafts';

/** Props for {@link EventCoreFields}. */
export interface EventCoreFieldsProps {
  /** The event being edited, for the read-only fallbacks. */
  item: CalendarItemOut;
  /** Hub display timezone used to interpret wall-clock values. */
  displayTimezone: string;
  /** The bound drafts and save state. */
  editor: CoreFieldEditor;
}

/** When, where, and what the event says — the parts a provider shares. */
export function EventCoreFields({
  item,
  displayTimezone,
  editor,
}: EventCoreFieldsProps): JSX.Element {
  const notesRef = useAutoGrow(editor.description.value);
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3 py-2.5">
        <span aria-hidden="true" className="text-on-surface-variant mt-6 flex size-4 shrink-0">
          <Schedule />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <EventSchedule item={item} displayTimezone={displayTimezone} editor={editor} />
          {editor.timeError ? (
            <p id={editor.timeErrorId} role="alert" className="text-error text-body-small">
              {editor.timeError}
            </p>
          ) : null}
        </div>
      </div>

      <PropertyPanelRow icon={<MapPin />} label="Where">
        <Input
          variant="plain"
          aria-label="Location"
          placeholder="Add a place"
          value={editor.location.value}
          disabled={!editor.canEdit}
          onChange={(event) => {
            editor.location.onChange(event.target.value);
          }}
          onBlur={editor.location.onBlur}
        />
      </PropertyPanelRow>

      <PropertyPanelRow icon={<FileText />} label="Notes">
        <Textarea
          variant="plain"
          aria-label="Description"
          placeholder="Add notes"
          ref={notesRef}
          value={editor.description.value}
          disabled={!editor.canEdit}
          rows={2}
          className="resize-none overflow-hidden"
          onChange={(event) => {
            editor.description.onChange(event.target.value);
          }}
          onBlur={editor.description.onBlur}
        />
      </PropertyPanelRow>
    </div>
  );
}

interface EventScheduleProps {
  item: CalendarItemOut;
  displayTimezone: string;
  editor: CoreFieldEditor;
}

/**
 * The start and end controls, in whichever shape the item's own bounds call for.
 *
 * @remarks
 * Both controls stay mounted rather than hiding behind a disclosure. A collapsed schedule would
 * read more calmly and would break the hydration tests outright, which depend on the fields
 * surviving a `displayTimezone` change without remounting.
 */
function EventSchedule({ item, displayTimezone, editor }: EventScheduleProps): JSX.Element {
  const invalid = Boolean(editor.timeError);
  const describedBy = editor.timeError ? editor.timeErrorId : undefined;
  if (!editor.timed) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <DatePicker
          ariaLabel="Starts"
          placeholder="Pick a day"
          triggerVariant="ghost"
          disabled={!editor.canEdit}
          invalid={invalid}
          describedBy={describedBy}
          value={editor.allDayStart === '' ? null : editor.allDayStart}
          onChange={(next) => {
            editor.setAllDayStart(next ?? '');
            editor.clearTimeError();
          }}
        />
        <DatePicker
          ariaLabel="Ends"
          placeholder="Pick a day"
          triggerVariant="ghost"
          disabled={!editor.canEdit}
          invalid={invalid}
          describedBy={describedBy}
          value={editor.allDayEnd === '' ? null : editor.allDayEnd}
          onChange={(next) => {
            editor.setAllDayEnd(next ?? '');
            editor.clearTimeError();
          }}
        />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <CalendarTimeField
        label="Starts"
        value={editor.start.wallValue}
        displayTimezone={displayTimezone}
        occurrence={editor.start.occurrence}
        disabled={!editor.canEdit}
        invalid={invalid}
        describedBy={describedBy}
        onValueChange={(value) => {
          editor.start.setWallValue(value);
          editor.clearTimeError();
        }}
        onOccurrenceChange={(occurrence) => {
          editor.start.setOccurrence(occurrence);
          editor.clearTimeError();
        }}
      />
      <CalendarTimeField
        label="Ends"
        value={editor.end.wallValue}
        displayTimezone={displayTimezone}
        occurrence={editor.end.occurrence}
        disabled={!editor.canEdit}
        invalid={invalid}
        describedBy={describedBy}
        onValueChange={(value) => {
          editor.end.setWallValue(value);
          editor.clearTimeError();
        }}
        onOccurrenceChange={(occurrence) => {
          editor.end.setOccurrence(occurrence);
          editor.clearTimeError();
        }}
      />
      {item.timezone && item.timezone !== displayTimezone ? (
        <p className="text-on-surface-variant text-body-small col-span-2">
          Shown in your timezone.
        </p>
      ) : null}
    </div>
  );
}
