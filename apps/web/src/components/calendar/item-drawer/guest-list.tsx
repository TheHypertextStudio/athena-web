'use client';

/**
 * `calendar/item-drawer/guest-list` — who is coming, and what they said.
 *
 * @remarks
 * Read-only, and honestly so. The API has carried `organizer` and `attendees` since the Google
 * adapter landed and no Docket surface rendered either, which left the first question a calendar
 * event raises unanswered. It stays read-only because there is nowhere to write an answer:
 * `CalendarItemUpdate` has no attendee field, the outbound provider patch carries only summary,
 * description, location, and bounds, and no RSVP route exists. A Yes/Maybe/No control here would
 * be a button that cannot do anything, which the craft rubric's placeholder gate exists to catch.
 * The provider link in the header is the way to answer, and it is already there.
 */
import type { CalendarItemOut } from '@docket/planning/calendar-contract';
import { Users } from '@docket/ui/icons';
import { Badge, Button } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { PropertyPanelRow } from '@/components/property-pickers/property-panel';

import {
  type EventGuest,
  eventGuests,
  GUEST_RESPONSE_LABEL,
} from '../item-presentation/attendee-presentation';

/** How many guests show before the rest fold away. */
const INLINE_GUEST_LIMIT = 5;

/** Props for {@link GuestList}. */
export interface GuestListProps {
  /** The event whose people are listed. */
  item: CalendarItemOut;
}

/** The organizer and the guests, in reading order, or nothing when the event has none. */
export function GuestList({ item }: GuestListProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const guests = eventGuests(item);
  if (guests.length === 0) return null;

  const hidden = expanded ? 0 : Math.max(0, guests.length - INLINE_GUEST_LIMIT);
  const shown = expanded ? guests : guests.slice(0, INLINE_GUEST_LIMIT);

  return (
    <PropertyPanelRow icon={<Users />} label={guestLabel(guests.length)}>
      <div className="flex flex-col gap-0.5 px-2">
        {shown.map((guest) => (
          <GuestRow key={guest.key} guest={guest} />
        ))}
        {hidden > 0 ? (
          <Button
            type="button"
            variant="ghost"
            controlSize="xs"
            className="text-on-surface-variant w-fit"
            onClick={() => {
              setExpanded(true);
            }}
          >
            {`${String(hidden)} more`}
          </Button>
        ) : null}
      </div>
    </PropertyPanelRow>
  );
}

function guestLabel(count: number): string {
  return count === 1 ? 'Guest' : 'Guests';
}

/** One person on the event, with the answer they gave. */
function GuestRow({ guest }: { readonly guest: EventGuest }): JSX.Element {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="text-on-surface text-body-medium min-w-0 truncate">{guest.name}</span>
      {guest.isSelf ? <Badge variant="secondary">You</Badge> : null}
      {guest.isOrganizer ? <Badge variant="secondary">Organizer</Badge> : null}
      <span className="text-on-surface-variant text-body-small shrink-0">
        {GUEST_RESPONSE_LABEL[guest.response]}
        {guest.isOptional ? ' · Optional' : ''}
      </span>
    </div>
  );
}
