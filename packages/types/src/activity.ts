/**
 * `@docket/types` — Activity (audit-feed) slice DTOs.
 *
 * @remarks
 * An audit event is one entry in an organization's universal activity feed. Agent
 * actions carry both an `actorId` (the agent's Actor) and an `initiatorId` (the human
 * who triggered it). The feed is org-scoped and read-only over the API surface; events
 * are written by the entity routers (optionally via the shared `writeAudit` helper).
 */
import { z } from 'zod';

import { ActorId, AuditEventId, OrganizationId } from './primitives';

/** Audit-feed subject kinds; `agent` is a first-class subject. */
export const AuditSubjectType = z.enum([
  'organization',
  'team',
  'initiative',
  'program',
  'project',
  'cycle',
  'task',
  'actor',
  'agent',
  'agent_session',
  'comment',
  'update',
  'integration',
  'role',
  'grant',
  'membership',
]);
/** Audit-subject-type value. */
export type AuditSubjectType = z.infer<typeof AuditSubjectType>;

/** Audit-feed event kinds. */
export const AuditEventType = z.enum([
  'created',
  'updated',
  'state_changed',
  'assigned',
  'commented',
  'archived',
  'deleted',
  'moved',
  'linked',
  'member_added',
  'member_removed',
  'role_changed',
  'grant_changed',
  'approved',
  'rejected',
]);
/** Audit-event-type value. */
export type AuditEventType = z.infer<typeof AuditEventType>;

/** Full audit-event representation returned by the org activity feed. */
export const AuditEventOut = z
  .object({
    id: AuditEventId,
    organizationId: OrganizationId,
    actorId: ActorId.nullable().optional(),
    initiatorId: ActorId.nullable().optional(),
    subjectType: AuditSubjectType,
    subjectId: z.string(),
    type: AuditEventType,
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .meta({ id: 'AuditEventOut', description: 'An entry in an organization activity feed.' });
/** Audit-event representation value. */
export type AuditEventOut = z.infer<typeof AuditEventOut>;
