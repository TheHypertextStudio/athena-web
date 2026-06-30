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
export const AuditSubjectType = z
  .enum([
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
  ])
  .describe(
    'The kind of Docket entity an audit event is about — what `subjectId` points to. Spans the work hierarchy (`organization`/`team`/`initiative`/`program`/`project`/`cycle`/`task`), identity/access (`actor`/`role`/`grant`/`membership`), collaboration (`comment`/`update`), integrations (`integration`), and the agent layer (`agent`, `agent_session` — the latter carries approve/reject gate decisions).',
  );
/** Audit-subject-type value. */
export type AuditSubjectType = z.infer<typeof AuditSubjectType>;

/** Audit-feed event kinds. */
export const AuditEventType = z
  .enum([
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
  ])
  .describe(
    'The action recorded: lifecycle (`created`/`updated`/`archived`/`deleted`), workflow (`state_changed`/`assigned`/`moved`/`linked`), collaboration (`commented`), access (`member_added`/`member_removed`/`role_changed`/`grant_changed`), and agent approval-gate decisions (`approved`/`rejected`, written on an `agent_session` subject when a human clears or vetoes a proposed agent action).',
  );
/** Audit-event-type value. */
export type AuditEventType = z.infer<typeof AuditEventType>;

/** Full audit-event representation returned by the org activity feed. */
export const AuditEventOut = z
  .object({
    id: AuditEventId.describe('The audit-event id.'),
    organizationId: OrganizationId.describe('The organization whose feed this event belongs to.'),
    actorId: ActorId.nullable()
      .optional()
      .describe(
        "WHO performed the action — for an agent action this is the agent's Actor, for a human action the human's Actor; null when system-generated.",
      ),
    initiatorId: ActorId.nullable()
      .optional()
      .describe(
        'WHO is accountable for triggering it — present (the human) on agent actions so the feed shows both the acting agent and the authorizing human; null/omitted for direct human actions.',
      ),
    subjectType: AuditSubjectType.describe(
      'The kind of entity acted upon — what `subjectId` references.',
    ),
    subjectId: z.string().describe('The id of the subject entity the event is about.'),
    type: AuditEventType.describe('What action was recorded.'),
    metadata: z
      .record(z.string(), z.unknown())
      .describe(
        'Event-specific detail — e.g. for `approved`/`rejected` the decided `activityId` and the `approverActorId`; for `state_changed` the before/after states.',
      ),
    createdAt: z
      .string()
      .describe('ISO-8601 timestamp the event was recorded — the feed sort key (descending).'),
  })
  .meta({ id: 'AuditEventOut', description: 'An entry in an organization activity feed.' });
/** Audit-event representation value. */
export type AuditEventOut = z.infer<typeof AuditEventOut>;
