'use client';

/**
 * `calendar/item-drawer/event-masthead` — an event's identity, said once.
 *
 * @remarks
 * The old header printed the title and the time range, and then the body printed an editable Title
 * input and Starts/Ends fields holding the same two facts in a different visual register. A person
 * read the event's identity twice before learning anything new. The title and the day now live
 * here only, and the title is edited where it is read.
 *
 * The seam line under the badges is the one sentence that says what Docket is doing for you: the
 * provider owns the event, Docket owns the work around it. A Docket-native event has no seam, so
 * the line is absent rather than reworded.
 */
import type { CalendarItemOut, CalendarLayerOut } from '@docket/planning/calendar-contract';
import { OpenInNew } from '@docket/ui/icons';
import { Badge, Button, DialogTitle, Input } from '@docket/ui/primitives';
import { type JSX } from 'react';

import {
  CALENDAR_ITEM_KIND_ICON,
  CALENDAR_ITEM_KIND_LABEL,
  itemClockRangeLabel,
  itemDayLabel,
  itemDurationLabel,
  READ_ONLY_REASON_LABEL,
} from '../item-presentation/event-identity';
import { providerLabel, providerSeamLabel } from '../item-presentation/sync-presentation';
import type { CoreFieldEditor } from './use-core-field-drafts';

/** Props for {@link EventMasthead}. */
export interface EventMastheadProps {
  /** The event being described. */
  item: CalendarItemOut;
  /** Its owning layer, for colour, calendar name, and provider. */
  layer: CalendarLayerOut | undefined;
  /** Hub display timezone the times are read in. */
  displayTimezone: string;
  /** The title draft and its save state. */
  editor: CoreFieldEditor;
}

/** The event's name, when it runs, and which calendar it belongs to. */
export function EventMasthead({
  item,
  layer,
  displayTimezone,
  editor,
}: EventMastheadProps): JSX.Element {
  const KindIcon = CALENDAR_ITEM_KIND_ICON[item.kind];
  const day = itemDayLabel(item, displayTimezone);
  const clock = itemClockRangeLabel(item, displayTimezone);
  const duration = itemDurationLabel(item);
  const seam = providerSeamLabel(item, layer);

  return (
    <>
      {/* The visible title is an editable field, so the dialog takes its accessible name here. */}
      <DialogTitle className="sr-only">{item.title}</DialogTitle>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="shrink-0 [&_svg]:size-6"
          style={{ color: layer?.color ?? undefined }}
        >
          <KindIcon />
        </span>
        <Input
          variant="plain"
          aria-label="Title"
          className="text-headline-small min-w-0 flex-1"
          value={editor.title.value}
          disabled={!editor.canEdit}
          aria-invalid={Boolean(editor.titleError)}
          aria-describedby={editor.titleError ? editor.titleErrorId : undefined}
          onChange={(event) => {
            editor.title.onChange(event.target.value);
          }}
          onBlur={editor.title.onBlur}
        />
      </div>
      {editor.titleError ? (
        <p id={editor.titleErrorId} role="alert" className="text-error text-body-small">
          {editor.titleError}
        </p>
      ) : null}

      <p className="text-on-surface-variant text-body-medium">
        {day ?? 'No time set'}
        {clock ? ` · ${clock}` : ''}
        {duration ? ` · ${duration}` : ''}
      </p>

      <EventBadges item={item} layer={layer} />

      {seam ? <p className="text-on-surface-variant text-label-small">{seam}</p> : null}
    </>
  );
}

interface EventBadgesProps {
  item: CalendarItemOut;
  layer: CalendarLayerOut | undefined;
}

/** Which calendar, what sort of thing, and anything a person cannot change about it. */
function EventBadges({ item, layer }: EventBadgesProps): JSX.Element {
  const kindLabel =
    item.kind === 'provider_event' || item.kind === 'native_event'
      ? null
      : CALENDAR_ITEM_KIND_LABEL[item.kind];
  const readOnlyLabel = item.permissions.readOnlyReason
    ? READ_ONLY_REASON_LABEL[item.permissions.readOnlyReason]
    : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {layer ? (
        <Badge variant="outline" className="gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: layer.color ?? 'var(--color-outline-variant)' }}
          />
          {layer.title}
        </Badge>
      ) : null}
      {kindLabel ? <Badge variant="secondary">{kindLabel}</Badge> : null}
      {item.recurringEventId ? <Badge variant="secondary">Repeats</Badge> : null}
      {readOnlyLabel ? <Badge variant="secondary">{readOnlyLabel}</Badge> : null}
      {item.htmlLink ? (
        <Button asChild variant="link" controlSize="sm">
          <a href={item.htmlLink} target="_blank" rel="noreferrer">
            <OpenInNew aria-hidden="true" />
            {`Open in ${providerLabel(layer)}`}
          </a>
        </Button>
      ) : null}
    </div>
  );
}
