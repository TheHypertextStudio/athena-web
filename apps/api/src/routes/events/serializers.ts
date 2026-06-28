/**
 * Event route serializers.
 *
 * @packageDocumentation
 */

import type {
  Event,
  EventParticipant,
  EventParticipantWithUser,
  EventWithRelations,
} from '@athena/types/openapi/events';
import type { eventParticipants, events, users } from '../../db/schema/index.js';

type EventRow = typeof events.$inferSelect;
type UserRow = typeof users.$inferSelect;
type EventParticipantRow = typeof eventParticipants.$inferSelect;

type EventParticipantWithUserRow = EventParticipantRow & {
  user?: UserRow | null;
};

type EventWithRelationsRow = EventRow & {
  creator?: UserRow | null;
  participants?: EventParticipantWithUserRow[];
};

const EVENT_SOURCE_VALUES = ['local', 'external'] as const;
type EventSource = (typeof EVENT_SOURCE_VALUES)[number];

const normalizeEventSource = (source: string): EventSource =>
  EVENT_SOURCE_VALUES.includes(source as EventSource) ? (source as EventSource) : 'local';

const EVENT_PARTICIPANT_STATUS_VALUES = ['pending', 'accepted', 'declined', 'tentative'] as const;
type EventParticipantStatus = (typeof EVENT_PARTICIPANT_STATUS_VALUES)[number];

const normalizeParticipantStatus = (status: string): EventParticipantStatus =>
  EVENT_PARTICIPANT_STATUS_VALUES.includes(status as EventParticipantStatus)
    ? (status as EventParticipantStatus)
    : 'pending';

export function toEvent(event: EventRow): Event {
  return {
    id: event.id,
    title: event.title,
    description: event.description ?? null,
    startTime: event.startTime,
    endTime: event.endTime ?? null,
    isAllDay: event.isAllDay,
    location: event.location ?? null,
    recurrenceRule: event.recurrenceRule ?? null,
    creatorId: event.creatorId,
    source: normalizeEventSource(event.source),
    sourceIntegrationId: event.sourceIntegrationId ?? null,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export function toEventParticipant(participant: EventParticipantRow): EventParticipant {
  return {
    id: participant.id,
    eventId: participant.eventId,
    userId: participant.userId,
    status: normalizeParticipantStatus(participant.status),
    createdAt: participant.createdAt,
  };
}

export function toEventParticipantWithUser(
  participant: EventParticipantWithUserRow,
): EventParticipantWithUser {
  const user = participant.user
    ? {
        id: participant.user.id,
        name: participant.user.name,
      }
    : undefined;

  return {
    ...toEventParticipant(participant),
    ...(user ? { user } : {}),
  };
}

export function toEventWithRelations(event: EventWithRelationsRow): EventWithRelations {
  const creator = event.creator
    ? {
        id: event.creator.id,
        name: event.creator.name,
      }
    : undefined;
  const participants = event.participants
    ? event.participants.map(toEventParticipantWithUser)
    : undefined;

  return {
    ...toEvent(event),
    ...(creator ? { creator } : {}),
    ...(participants ? { participants } : {}),
  };
}
