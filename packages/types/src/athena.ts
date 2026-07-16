/**
 * `@docket/types` — personal Athena connection, assignment, and trigger contracts.
 *
 * @remarks
 * These records belong to a Better Auth user rather than a workspace. Workspace ids on
 * assignments identify only the target work context and never grant access.
 */
import { z } from 'zod';

import { AgentSessionId, Id, OrganizationId } from './primitives';
import { EventKind } from './event';
import { IntegrationStatus } from './integration';

/** Authentication mode for one personal remote MCP connection. */
export const PersonalMcpAuthMode = z.enum(['oauth', 'bearer', 'none']);
/** Personal MCP authentication mode. */
export type PersonalMcpAuthMode = z.infer<typeof PersonalMcpAuthMode>;

/** Stable, model-safe tool namespace assigned to one remote MCP connection. */
export const PersonalMcpAlias = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,20}$/)
  .describe('Lowercase tool prefix used as `<alias>__<tool>` inside Athena.');

/** Body for connecting a personal remote MCP server. */
export const PersonalMcpConnectionCreate = z
  .object({
    url: z.url(),
    name: z.string().trim().min(1).max(80),
    alias: PersonalMcpAlias,
    authMode: PersonalMcpAuthMode.default('oauth'),
    bearerToken: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.authMode === 'bearer' && !value.bearerToken) {
      ctx.addIssue({ code: 'custom', path: ['bearerToken'], message: 'Bearer token required' });
    }
    if (value.authMode !== 'bearer' && value.bearerToken) {
      ctx.addIssue({
        code: 'custom',
        path: ['bearerToken'],
        message: 'Bearer token is valid only for bearer authentication',
      });
    }
  })
  .meta({ id: 'PersonalMcpConnectionCreate' });
/** Validated personal MCP connection create body. */
export type PersonalMcpConnectionCreate = z.infer<typeof PersonalMcpConnectionCreate>;

/** Editable visible identity for a personal remote MCP connection. */
export const PersonalMcpConnectionUpdate = z
  .object({ name: z.string().trim().min(1).max(80).optional(), alias: PersonalMcpAlias.optional() })
  .refine((value) => value.name !== undefined || value.alias !== undefined, {
    message: 'At least one field is required',
  })
  .meta({ id: 'PersonalMcpConnectionUpdate' });
/** Validated personal MCP connection update body. */
export type PersonalMcpConnectionUpdate = z.infer<typeof PersonalMcpConnectionUpdate>;

/** Personal remote MCP connection returned to its owner; credentials are never exposed. */
export const PersonalMcpConnectionOut = z
  .object({
    id: Id,
    url: z.url(),
    name: z.string(),
    alias: PersonalMcpAlias,
    authMode: PersonalMcpAuthMode,
    status: IntegrationStatus,
    toolCount: z.number().int().nonnegative().nullable(),
    lastError: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'PersonalMcpConnectionOut' });
/** Personal MCP connection response. */
export type PersonalMcpConnectionOut = z.infer<typeof PersonalMcpConnectionOut>;

/** Preview returned after MCP initialization discovers the visible server name. */
export const PersonalMcpConnectionPreviewOut = z
  .object({ name: z.string().trim().min(1).max(80) })
  .meta({ id: 'PersonalMcpConnectionPreviewOut' });

/** Work entity types to which a user may delegate Athena. */
export const AthenaAssignmentEntityType = z.enum(['initiative', 'project', 'task']);
/** Athena assignment entity type. */
export type AthenaAssignmentEntityType = z.infer<typeof AthenaAssignmentEntityType>;

/** Lifecycle for a user-owned Athena assignment. */
export const AthenaAssignmentStatus = z.enum(['active', 'paused', 'completed']);
/** Athena assignment lifecycle value. */
export type AthenaAssignmentStatus = z.infer<typeof AthenaAssignmentStatus>;

/** Body for assigning personal Athena to one work entity. */
export const AthenaAssignmentCreate = z
  .object({
    organizationId: OrganizationId,
    entityType: AthenaAssignmentEntityType,
    entityId: Id,
    objective: z.string().trim().min(1).max(4_000),
  })
  .meta({ id: 'AthenaAssignmentCreate' });
/** Validated Athena assignment create body. */
export type AthenaAssignmentCreate = z.infer<typeof AthenaAssignmentCreate>;

/** User-owned Athena assignment returned to its owner. */
export const AthenaAssignmentOut = z
  .object({
    id: Id,
    organizationId: OrganizationId,
    entityType: AthenaAssignmentEntityType,
    entityId: Id,
    objective: z.string(),
    status: AthenaAssignmentStatus,
    activeSessionId: AgentSessionId.nullable(),
    pausedReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'AthenaAssignmentOut' });
/** Athena assignment response. */
export type AthenaAssignmentOut = z.infer<typeof AthenaAssignmentOut>;

/** Trigger source for an assignment: a Docket event or recurring schedule. */
export const AthenaTriggerType = z.enum(['event', 'scheduled']);
/** Athena trigger source. */
export type AthenaTriggerType = z.infer<typeof AthenaTriggerType>;

/** Body for adding one assignment-scoped trigger. */
export const AthenaTriggerCreate = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('event'),
      eventKinds: z.array(EventKind).min(1),
      cooldownMinutes: z.number().int().min(5).default(5),
    }),
    z.object({
      type: z.literal('scheduled'),
      scheduleMinutes: z.number().int().min(5),
      cooldownMinutes: z.number().int().min(5).default(5),
    }),
  ])
  .meta({ id: 'AthenaTriggerCreate' });
/** Validated Athena trigger create body. */
export type AthenaTriggerCreate = z.infer<typeof AthenaTriggerCreate>;

/** Body for pausing or resuming an assignment trigger. */
export const AthenaTriggerUpdate = z
  .object({ enabled: z.boolean() })
  .meta({ id: 'AthenaTriggerUpdate' });
/** Validated Athena trigger update body. */
export type AthenaTriggerUpdate = z.infer<typeof AthenaTriggerUpdate>;

/** Assignment-scoped trigger returned to the assignment owner. */
export const AthenaTriggerOut = z
  .object({
    id: Id,
    assignmentId: Id,
    type: AthenaTriggerType,
    eventKinds: z.array(EventKind),
    scheduleMinutes: z.number().int().nullable(),
    cooldownMinutes: z.number().int(),
    enabled: z.boolean(),
    lastTriggeredAt: z.string().nullable(),
    nextRunAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'AthenaTriggerOut' });
/** Athena trigger response. */
export type AthenaTriggerOut = z.infer<typeof AthenaTriggerOut>;
