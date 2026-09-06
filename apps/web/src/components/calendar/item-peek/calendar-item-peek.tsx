'use client';

/**
 * `calendar/item-peek/calendar-item-peek` — what a calendar event says when you click it.
 *
 * @remarks
 * Purely presentational, and deliberately so: the same body renders inside an anchored popover on a
 * laptop and inside a bottom sheet on a phone, and neither of those two hosts should have to know
 * how an event reads. Every fact comes from `item-presentation/`, which the detail dialog reads
 * too, so the two tiers cannot describe the same event differently.
 *
 * A row with nothing in it renders nothing. `docs/design/ghost-grammar.md` rule 6 — a lane with
 * nothing to show shows nothing — is why this surface stays short for a bare event instead of
 * padding itself out with headings and apologies.
 */
import type { CalendarItemOut, CalendarLayerOut } from '@docket/planning/calendar-contract';
import { FileText, MapPin, Maximize, Sparkles, Trash2, Users } from '@docket/ui/icons';
import { Badge, Button, ControlGroup } from '@docket/ui/primitives';
import { type JSX, type ReactNode } from 'react';

import {
  CALENDAR_ITEM_KIND_ICON,
  CALENDAR_ITEM_KIND_LABEL,
  READ_ONLY_REASON_LABEL,
  itemClockRangeLabel,
  itemDayLabel,
  itemDurationLabel,
} from '../item-presentation/event-identity';
import { eventGuests, guestSummaryLabel } from '../item-presentation/attendee-presentation';
import { syncNotice } from '../item-presentation/sync-presentation';
import { canDeleteCalendarItem } from '../item-drawer/status-actions';

/** Props for {@link CalendarItemPeek}. */
export interface CalendarItemPeekProps {
  /** The event being previewed. */
  item: CalendarItemOut;
  /** Its owning layer, for colour and calendar name. */
  layer: CalendarLayerOut | undefined;
  /** Hub display timezone the times are read in. */
  displayTimezone: string;
  /** Id given to the heading, so the host surface can name itself after the event. */
  titleId: string;
  /** Escalate to the full event detail. */
  onOpenDetail: () => void;
  /** Hand this event to Athena. */
  onAskAthena: () => void;
  /** Ask the host to close and raise its own delete confirmation. */
  onRequestDelete: () => void;
}

/** The gutter that keeps every fact on one axis under the title's icon. */
const FACT_GUTTER = 'pl-[1.875rem]';

/** The compact account of one calendar event. */
export function CalendarItemPeek({
  item,
  layer,
  displayTimezone,
  titleId,
  onOpenDetail,
  onAskAthena,
  onRequestDelete,
}: CalendarItemPeekProps): JSX.Element {
  const KindIcon = CALENDAR_ITEM_KIND_ICON[item.kind];
  const notice = syncNotice(item, layer);

  return (
    <>
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 shrink-0 [&_svg]:size-5"
          style={{ color: layer?.color ?? undefined }}
        >
          <KindIcon />
        </span>
        <h2 id={titleId} className="text-on-surface text-title-medium min-w-0 flex-1 break-words">
          {item.title}
        </h2>
      </div>

      <PeekWhen item={item} displayTimezone={displayTimezone} />
      <PeekBadges item={item} layer={layer} />

      <PeekFact icon={<MapPin />} text={item.location} />
      <PeekFact icon={<Users />} text={guestSummaryLabel(eventGuests(item))} />
      <PeekFact icon={<FileText />} text={item.description} clamp />

      {notice ? (
        <p
          className={
            notice.tone === 'attention'
              ? `text-error text-body-small ${FACT_GUTTER}`
              : `text-on-surface-variant text-body-small ${FACT_GUTTER}`
          }
        >
          {notice.text}
        </p>
      ) : null}

      <ControlGroup controlSize="sm" className="pt-1">
        <Button type="button" onClick={onOpenDetail}>
          <Maximize aria-hidden="true" />
          Open
        </Button>
        <Button type="button" variant="ghost" onClick={onAskAthena}>
          <Sparkles aria-hidden="true" />
          Athena
        </Button>
        {canDeleteCalendarItem(item) ? (
          <Button
            type="button"
            variant="ghost"
            iconOnly
            aria-label={`Delete ${item.title}`}
            className="text-error hover:text-error"
            onClick={onRequestDelete}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
      </ControlGroup>
    </>
  );
}

interface PeekWhenProps {
  readonly item: CalendarItemOut;
  readonly displayTimezone: string;
}

/** The day, then the clock range and how long it runs. */
function PeekWhen({ item, displayTimezone }: PeekWhenProps): JSX.Element | null {
  const day = itemDayLabel(item, displayTimezone);
  const clock = itemClockRangeLabel(item, displayTimezone);
  const duration = itemDurationLabel(item);
  if (!day && !clock) return null;
  return (
    <div className={`flex flex-col gap-0.5 ${FACT_GUTTER}`}>
      {day ? <p className="text-on-surface text-body-medium">{day}</p> : null}
      {clock ? (
        <p className="text-on-surface-variant text-body-small">
          {clock}
          {duration ? ` · ${duration}` : ''}
        </p>
      ) : null}
    </div>
  );
}

interface PeekBadgesProps {
  readonly item: CalendarItemOut;
  readonly layer: CalendarLayerOut | undefined;
}

/** Which calendar this is on, and anything about it a person cannot change. */
function PeekBadges({ item, layer }: PeekBadgesProps): JSX.Element | null {
  // A plain event says "event", which the surface already makes obvious; only the kinds Docket
  // invented are worth naming.
  const kindLabel =
    item.kind === 'provider_event' || item.kind === 'native_event'
      ? null
      : CALENDAR_ITEM_KIND_LABEL[item.kind];
  const readOnlyLabel = item.permissions.readOnlyReason
    ? READ_ONLY_REASON_LABEL[item.permissions.readOnlyReason]
    : null;
  if (!layer && !kindLabel && !readOnlyLabel && !item.recurringEventId) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${FACT_GUTTER}`}>
      {layer ? <LayerBadge layer={layer} /> : null}
      {kindLabel ? <Badge variant="secondary">{kindLabel}</Badge> : null}
      {item.recurringEventId ? <Badge variant="secondary">Repeats</Badge> : null}
      {readOnlyLabel ? <Badge variant="secondary">{readOnlyLabel}</Badge> : null}
    </div>
  );
}

/** The calendar an event lives on, in that calendar's own colour. */
function LayerBadge({ layer }: { readonly layer: CalendarLayerOut }): JSX.Element {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span
        aria-hidden="true"
        className="size-2 rounded-full"
        style={{ backgroundColor: layer.color ?? 'var(--color-outline-variant)' }}
      />
      {layer.title}
    </Badge>
  );
}

interface PeekFactProps {
  icon: ReactNode;
  text: string | null | undefined;
  clamp?: boolean;
}

/** One icon-led fact, or nothing at all when the event does not carry it. */
function PeekFact({ icon, text, clamp }: PeekFactProps): JSX.Element | null {
  if (!text) return null;
  return (
    <div className="flex items-start gap-2.5">
      <span aria-hidden="true" className="text-on-surface-variant mt-0.5 shrink-0 [&_svg]:size-4.5">
        {icon}
      </span>
      <p
        className={
          clamp
            ? 'text-on-surface-variant text-body-small line-clamp-3 min-w-0 flex-1 break-words whitespace-pre-line'
            : 'text-on-surface-variant text-body-small min-w-0 flex-1 break-words'
        }
      >
        {text}
      </p>
    </div>
  );
}
