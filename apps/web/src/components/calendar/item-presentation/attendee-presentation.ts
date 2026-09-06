/**
 * `calendar/item-presentation/attendee-presentation` — the guest list, in reading order.
 *
 * @remarks
 * "Who is coming" is the first question a calendar event raises, and Docket has been dropping the
 * answer: the API has carried `organizer` and `attendees` since the Google adapter landed and no
 * web surface read either one. Docket cannot yet change a response — there is no attendee field on
 * `CalendarItemUpdate` and no RSVP route — so this module only orders and names people.
 *
 * `responseStatus` is a free-form provider string. It is mapped to a closed set here and never
 * rendered directly, because provider text is not this application's copy.
 */
import type {
  CalendarEventAttendee,
  CalendarEventOrganizer,
  CalendarItemOut,
} from '@docket/planning/calendar-contract';

/** A guest's answer, normalized away from the provider's own vocabulary. */
export type GuestResponse = 'yes' | 'maybe' | 'no' | 'none';

/** One person on an event, ready to render. */
export interface EventGuest {
  /** Stable list key — the email when there is one, otherwise the position. */
  readonly key: string;
  /** What to call this person. */
  readonly name: string;
  /** The address, when it is known and differs from the name. */
  readonly email: string | null;
  /** Whether this row is the viewer. */
  readonly isSelf: boolean;
  /** Whether this person called the meeting. */
  readonly isOrganizer: boolean;
  /** Whether their attendance is optional. */
  readonly isOptional: boolean;
  /** Their answer. */
  readonly response: GuestResponse;
}

/** The label for each normalized response. */
export const GUEST_RESPONSE_LABEL: Record<GuestResponse, string> = {
  yes: 'Yes',
  maybe: 'Maybe',
  no: 'No',
  none: 'No reply',
};

const RESPONSE_BY_PROVIDER_VALUE: Record<string, GuestResponse> = {
  accepted: 'yes',
  tentative: 'maybe',
  declined: 'no',
  needsaction: 'none',
};

/** Reading order: the viewer, then the organizer, then everyone by how they answered. */
const RESPONSE_ORDER: Record<GuestResponse, number> = { yes: 0, maybe: 1, none: 2, no: 3 };

function normalizeResponse(status: string | null | undefined): GuestResponse {
  if (!status) return 'none';
  return RESPONSE_BY_PROVIDER_VALUE[status.toLowerCase()] ?? 'none';
}

function personName(
  person: CalendarEventAttendee | CalendarEventOrganizer,
  fallback: string,
): string {
  // A provider may send an empty or whitespace-only display name, which is present but useless, so
  // each candidate has to be tested for content rather than merely for existence.
  const display = person.displayName?.trim() ?? '';
  if (display.length > 0) return display;
  const email = person.email?.trim() ?? '';
  return email.length > 0 ? email : fallback;
}

/**
 * Order an event's people for display, folding the organizer into their own attendee row.
 *
 * @remarks
 * Google lists the organizer both on `organizer` and, usually, again inside `attendees`. Emitting
 * both would show the same person twice, so a matching attendee is badged as the organizer instead
 * and only an organizer absent from the list earns a row of their own.
 *
 * @param item - The calendar item whose people are being listed.
 * @returns the guests in reading order; empty when the event has none.
 */
export function eventGuests(item: CalendarItemOut): readonly EventGuest[] {
  const organizerEmail = item.organizer?.email?.trim().toLowerCase() ?? null;
  const guests: EventGuest[] = item.attendees.map((attendee, index) => {
    const email = attendee.email?.trim() ?? null;
    const name = personName(attendee, 'Guest');
    return {
      key: email ?? `attendee-${String(index)}`,
      name,
      email: email && email !== name ? email : null,
      isSelf: attendee.self === true,
      isOrganizer: organizerEmail !== null && email?.toLowerCase() === organizerEmail,
      isOptional: attendee.optional === true,
      response: normalizeResponse(attendee.responseStatus),
    };
  });

  if (item.organizer && !guests.some((guest) => guest.isOrganizer)) {
    const name = personName(item.organizer, 'Organizer');
    guests.push({
      key: organizerEmail ?? 'organizer',
      name,
      email: item.organizer.email && item.organizer.email !== name ? item.organizer.email : null,
      isSelf: item.organizer.self === true,
      isOrganizer: true,
      isOptional: false,
      response: 'yes',
    });
  }

  return guests.sort((left, right) => {
    if (left.isSelf !== right.isSelf) return left.isSelf ? -1 : 1;
    if (left.isOrganizer !== right.isOrganizer) return left.isOrganizer ? -1 : 1;
    const byResponse = RESPONSE_ORDER[left.response] - RESPONSE_ORDER[right.response];
    return byResponse === 0 ? left.name.localeCompare(right.name) : byResponse;
  });
}

/**
 * A one-line summary of the guest list for a surface too small to show every row.
 *
 * @param guests - The ordered guests from {@link eventGuests}.
 * @returns the summary, or `null` when nobody is on the event.
 */
export function guestSummaryLabel(guests: readonly EventGuest[]): string | null {
  if (guests.length === 0) return null;
  const accepted = guests.filter((guest) => guest.response === 'yes').length;
  const people = guests.length === 1 ? '1 guest' : `${String(guests.length)} guests`;
  return accepted === guests.length ? people : `${people} · ${String(accepted)} yes`;
}
