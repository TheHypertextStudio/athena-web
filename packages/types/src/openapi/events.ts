/**
 * Event OpenAPI schemas.
 *
 * These schemas define the API contract for event endpoints and are used for:
 * - Request/response validation
 * - OpenAPI spec generation
 * - Generated client types
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema, listResponseSchema } from './common.js';
import { UserRefSchema } from './tasks.js';

// =============================================================================
// Enums
// =============================================================================

export const EventParticipantStatusSchema = z
  .enum(['pending', 'accepted', 'declined', 'tentative'])
  .openapi({
    description: 'Event participant RSVP status',
    example: 'accepted',
  });

export const EventSourceSchema = z.enum(['local', 'external']).openapi({
  description: 'Event source (local or synced from external calendar)',
  example: 'local',
});

// =============================================================================
// Reference Schemas
// =============================================================================

export const EventRefSchema = z
  .object({
    id: z.uuid().openapi({ description: 'Event UUID' }),
    title: z.string().openapi({ description: 'Event title', example: 'Team Standup' }),
  })
  .openapi('EventRef');

// =============================================================================
// Participant Schemas
// =============================================================================

export const EventParticipantSchema = z
  .object({
    id: z.uuid().openapi({ description: 'Participant record UUID' }),
    eventId: z.uuid().openapi({ description: 'Event UUID' }),
    userId: z.uuid().openapi({ description: 'User UUID' }),
    status: EventParticipantStatusSchema,
    createdAt: TimestampSchema.openapi({ description: 'When participant was added' }),
  })
  .openapi('EventParticipant');

export const EventParticipantWithUserSchema = EventParticipantSchema.extend({
  user: UserRefSchema.optional().openapi({ description: 'Participant user details' }),
}).openapi('EventParticipantWithUser');

// =============================================================================
// Core Event Schemas
// =============================================================================

export const EventSchema = z
  .object({
    id: z.uuid().openapi({ description: 'Event UUID' }),
    title: z.string().min(1).max(500).openapi({
      description: 'Event title',
      example: 'Team Standup',
    }),
    description: z.string().nullable().openapi({
      description: 'Event description',
      example: 'Daily standup meeting for the engineering team',
    }),
    startTime: TimestampSchema.openapi({
      description: 'Event start time',
      example: '2025-01-10T09:00:00Z',
    }),
    endTime: TimestampSchema.nullable().openapi({
      description: 'Event end time',
      example: '2025-01-10T09:30:00Z',
    }),
    isAllDay: z.boolean().openapi({
      description: 'Whether this is an all-day event',
      example: false,
    }),
    location: z.string().nullable().openapi({
      description: 'Event location',
      example: 'Conference Room A',
    }),
    recurrenceRule: z.string().nullable().openapi({
      description: 'iCalendar RRULE for recurring events',
      example: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
    }),
    creatorId: z.uuid().openapi({ description: 'Event creator user UUID' }),
    source: EventSourceSchema,
    sourceIntegrationId: z.uuid().nullable().openapi({
      description: 'Integration ID if event is from external source',
    }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('Event');

export const EventWithRelationsSchema = EventSchema.extend({
  creator: UserRefSchema.optional().openapi({
    description: 'Event creator details',
  }),
  participants: z.array(EventParticipantWithUserSchema).optional().openapi({
    description: 'Event participants with user details',
  }),
}).openapi('EventWithRelations');

// =============================================================================
// Path Parameters
// =============================================================================

export const EventIdParamSchema = z
  .object({
    id: z.string().min(1).openapi({
      description: 'Event ID',
      example: 'event-123',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('EventIdParam');

export const EventParticipantParamsSchema = z
  .object({
    id: z.string().min(1).openapi({
      description: 'Event ID',
      param: { name: 'id', in: 'path' },
    }),
    participantId: z.string().min(1).openapi({
      description: 'Participant ID',
      param: { name: 'participantId', in: 'path' },
    }),
  })
  .openapi('EventParticipantParams');

// =============================================================================
// Query Parameters
// =============================================================================

export const ListEventsQuerySchema = z
  .object({
    startDate: z.coerce
      .date()
      .optional()
      .openapi({
        description: 'Filter events starting on or after this date',
        example: '2025-01-01T00:00:00Z',
        param: { name: 'startDate', in: 'query' },
      }),
    endDate: z.coerce
      .date()
      .optional()
      .openapi({
        description: 'Filter events starting before this date',
        example: '2025-01-31T23:59:59Z',
        param: { name: 'endDate', in: 'query' },
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .openapi({
        description: 'Maximum number of events to return',
        example: 50,
        param: { name: 'limit', in: 'query' },
      }),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .openapi({
        description: 'Number of events to skip',
        example: 0,
        param: { name: 'offset', in: 'query' },
      }),
  })
  .openapi('ListEventsQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateEventRequestSchema = z
  .object({
    title: z.string().min(1).max(500).openapi({
      description: 'Event title',
      example: 'Team Standup',
    }),
    description: z.string().max(10000).optional().openapi({
      description: 'Event description',
    }),
    startTime: z.coerce.date().openapi({
      description: 'Event start time (ISO 8601)',
      example: '2025-01-10T09:00:00Z',
    }),
    endTime: z.coerce.date().optional().openapi({
      description: 'Event end time (ISO 8601)',
      example: '2025-01-10T09:30:00Z',
    }),
    isAllDay: z.boolean().default(false).openapi({
      description: 'Whether this is an all-day event',
    }),
    location: z.string().max(500).optional().openapi({
      description: 'Event location',
    }),
    recurrenceRule: z.string().max(500).optional().openapi({
      description: 'iCalendar RRULE for recurring events',
    }),
    participantIds: z.array(z.string().min(1)).optional().openapi({
      description: 'User IDs to add as participants',
    }),
  })
  .openapi('CreateEventRequest');

export const UpdateEventRequestSchema = z
  .object({
    title: z.string().min(1).max(500).optional().openapi({
      description: 'Event title',
    }),
    description: z.string().max(10000).nullish().openapi({
      description: 'Event description (null to clear)',
    }),
    startTime: z.coerce.date().optional().openapi({
      description: 'Event start time (ISO 8601)',
    }),
    endTime: z.coerce.date().nullish().openapi({
      description: 'Event end time (null to clear)',
    }),
    isAllDay: z.boolean().optional().openapi({
      description: 'Whether this is an all-day event',
    }),
    location: z.string().max(500).nullish().openapi({
      description: 'Event location (null to clear)',
    }),
    recurrenceRule: z.string().max(500).nullish().openapi({
      description: 'Recurrence rule (null to clear)',
    }),
  })
  .openapi('UpdateEventRequest');

export const AddParticipantRequestSchema = z
  .object({
    userId: z.string().min(1).openapi({
      description: 'User ID to add as participant',
    }),
  })
  .openapi('AddParticipantRequest');

export const UpdateParticipantStatusRequestSchema = z
  .object({
    status: EventParticipantStatusSchema.openapi({
      description: 'New RSVP status',
    }),
  })
  .openapi('UpdateParticipantStatusRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const EventResponseSchema = successResponseSchema(
  EventWithRelationsSchema,
  'Event response',
).openapi('EventResponse');

export const EventListResponseSchema = listResponseSchema(
  EventWithRelationsSchema,
  'Event list response',
).openapi('EventListResponse');

export const EventParticipantResponseSchema = successResponseSchema(
  EventParticipantWithUserSchema,
  'Event participant response',
).openapi('EventParticipantResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type EventParticipantStatus = z.infer<typeof EventParticipantStatusSchema>;
export type EventSource = z.infer<typeof EventSourceSchema>;
export type EventRef = z.infer<typeof EventRefSchema>;
export type EventParticipant = z.infer<typeof EventParticipantSchema>;
export type EventParticipantWithUser = z.infer<typeof EventParticipantWithUserSchema>;
export type Event = z.infer<typeof EventSchema>;
export type EventWithRelations = z.infer<typeof EventWithRelationsSchema>;
export type EventIdParam = z.infer<typeof EventIdParamSchema>;
export type EventParticipantParams = z.infer<typeof EventParticipantParamsSchema>;
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;
export type CreateEventRequest = z.infer<typeof CreateEventRequestSchema>;
export type UpdateEventRequest = z.infer<typeof UpdateEventRequestSchema>;
export type AddParticipantRequest = z.infer<typeof AddParticipantRequestSchema>;
export type UpdateParticipantStatusRequest = z.infer<typeof UpdateParticipantStatusRequestSchema>;
export type EventResponse = z.infer<typeof EventResponseSchema>;
export type EventListResponse = z.infer<typeof EventListResponseSchema>;
export type EventParticipantResponse = z.infer<typeof EventParticipantResponseSchema>;
