/**
 * Event Zod schemas.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import {
  idSchema,
  timestampSchema,
  optionalTimestampSchema,
  successResponse,
  listResponse,
} from './common.js';

/**
 * Participant status enum.
 */
export const participantStatusSchema = z.enum(['pending', 'accepted', 'declined', 'tentative']);

/**
 * Base event schema.
 */
export const eventSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(500),
  description: z.string().nullable(),
  startTime: timestampSchema,
  endTime: timestampSchema.nullable(),
  isAllDay: z.boolean(),
  location: z.string().nullable(),
  recurrenceRule: z.string().nullable(),
  creatorId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * Event participant schema.
 */
export const eventParticipantSchema = z.object({
  id: idSchema,
  eventId: idSchema,
  userId: idSchema,
  status: participantStatusSchema,
  createdAt: timestampSchema,
  user: z
    .object({
      id: idSchema,
      name: z.string(),
      email: z.string().email(),
    })
    .optional(),
});

/**
 * Event with relations.
 */
export const eventWithRelationsSchema = eventSchema.extend({
  creator: z
    .object({
      id: idSchema,
      name: z.string(),
      email: z.string().email(),
    })
    .optional(),
  participants: z.array(eventParticipantSchema).optional(),
});

/**
 * Create event request.
 */
export const createEventSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  isAllDay: z.boolean().optional(),
  location: z.string().max(500).optional(),
  recurrenceRule: z.string().optional(),
  participantIds: z.array(idSchema).optional(),
});

/**
 * Update event request.
 */
export const updateEventSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  startTime: z.string().datetime().optional(),
  endTime: optionalTimestampSchema,
  isAllDay: z.boolean().optional(),
  location: z.string().max(500).nullable().optional(),
  recurrenceRule: z.string().nullable().optional(),
});

/**
 * Event query parameters.
 */
export const eventQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

/**
 * Add participant request.
 */
export const addParticipantSchema = z.object({
  userId: idSchema,
});

/**
 * Update participant status request.
 */
export const updateParticipantStatusSchema = z.object({
  status: participantStatusSchema,
});

/**
 * Event response.
 */
export const eventResponseSchema = successResponse(eventWithRelationsSchema);

/**
 * Event list response.
 */
export const eventListResponseSchema = listResponse(eventWithRelationsSchema);

export type Event = z.infer<typeof eventSchema>;
export type EventWithRelations = z.infer<typeof eventWithRelationsSchema>;
export type EventParticipant = z.infer<typeof eventParticipantSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
