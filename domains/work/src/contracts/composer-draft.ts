/**
 * `domain packages` — Composer draft DTOs.
 *
 * @remarks
 * A composer draft is the unsent state of one of the five global create composers (task, project,
 * initiative, program, team), saved so a person can close the composer and pick the draft back up
 * later, on any device. Each payload mirrors that composer's own draft value field for field, with
 * every field optional, so a partially filled form round-trips without the server knowing which
 * fields the form requires. The server validates the shape and derives a title for lists; it
 * never interprets the fields. A draft expires {@link COMPOSER_DRAFT_TTL_DAYS} days after its last
 * edit.
 *
 * Ids are the branded ids the pickers hold; a status is the workspace's own status key, exactly as
 * the create bodies carry it.
 */
import { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import { z } from 'zod';

import { CycleId, InitiativeId, LabelId, MilestoneId, ProgramId, ProjectId } from '../ids';
import { DateResolution } from '../planning-timeframe';
import { Priority } from '../task-contract';
import { Health, Visibility } from './capability';
import { InitiativePriority, InitiativeStatus, InitiativeUpdateCadence } from './initiative';
import { ProgramStatus } from './program';

/** How long a draft stays reachable after its last edit. */
export const COMPOSER_DRAFT_TTL_DAYS = 183;

/** The composers whose unsent state is saved. */
export const ComposerDraftKind = z
  .enum(['task', 'project', 'initiative', 'program', 'team'])
  .describe('Which create composer the draft belongs to.');
/** Composer draft kind value. */
export type ComposerDraftKind = z.infer<typeof ComposerDraftKind>;

/** A saved planning date: the anchor day plus the resolution and fiscal basis a broad value used. */
export const ComposerTimeframe = z
  .object({
    date: z.iso.date().describe('The canonical anchor day, `YYYY-MM-DD`.'),
    resolution: DateResolution.nullable().describe(
      'The broad resolution, or null when a precise day was chosen.',
    ),
    fiscalYearStartMonth: z
      .number()
      .int()
      .min(0)
      .max(11)
      .nullable()
      .describe('The zero-based fiscal start month for a broad value, or null for a precise day.'),
  })
  .meta({ id: 'ComposerTimeframe', description: 'A planning date held by a draft.' });
/** Composer timeframe value. */
export type ComposerTimeframe = z.infer<typeof ComposerTimeframe>;

/**
 * A recurrence schedule as the task composer holds it.
 *
 * @remarks
 * The full schedule grammar belongs to the recurring-task create body; a draft only needs to keep
 * whatever the composer's repeat editor produced, so the arms are kept open beyond their `kind`.
 */
const CalendarScheduleDraft = z
  .looseObject({
    kind: z.enum(['daily', 'weekly', 'monthly', 'yearly']).describe('The calendar cadence.'),
  })
  .describe('A calendar-driven schedule, as the repeat editor produced it.');

const AfterCompletionScheduleDraft = z
  .looseObject({
    kind: z.literal('after_completion').describe('Anchored to the prior copy’s completion.'),
  })
  .describe('A completion-anchored schedule, as the repeat editor produced it.');

/** Whether and how the drafted task repeats. */
export const ComposerRepeatDraft = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('none').describe('The task is created once.') }),
    z.object({
      kind: z.literal('calendar').describe('The task repeats on calendar dates.'),
      schedule: CalendarScheduleDraft,
      missedPolicy: z
        .enum(['skip', 'carry', 'resolve'])
        .describe('What happens to an occurrence that passes unfinished.'),
      materialization: z
        .object({
          horizonDays: z
            .number()
            .int()
            .min(1)
            .max(366)
            .describe('Days ahead to create occurrences.'),
          minimumOccurrences: z
            .number()
            .int()
            .min(1)
            .max(100)
            .describe('The fewest upcoming occurrences to keep ready.'),
        })
        .describe('How far ahead copies are created.'),
    }),
    z.object({
      kind: z.literal('after_completion').describe('The next copy follows completion.'),
      schedule: AfterCompletionScheduleDraft,
    }),
  ])
  .meta({ id: 'ComposerRepeatDraft', description: 'The task composer’s repeat value.' });
/** Composer repeat draft value. */
export type ComposerRepeatDraft = z.infer<typeof ComposerRepeatDraft>;

/** The task composer's unsent state. */
export const TaskDraftPayload = z
  .object({
    kind: z.literal('task').describe('Marks a task composer draft.'),
    title: z.string().optional().describe('The title as typed.'),
    description: z.string().optional().describe('The body as typed.'),
    teamOverride: TeamId.nullable()
      .optional()
      .describe('The team chosen in the picker, or null to follow the workspace default.'),
    state: z.string().min(1).nullable().optional().describe('The chosen workflow state key.'),
    priority: Priority.optional().describe('The chosen priority.'),
    assigneeId: ActorId.nullable().optional().describe('Who the task is assigned to.'),
    projectId: ProjectId.nullable().optional().describe('The project the task belongs to.'),
    milestoneId: MilestoneId.nullable().optional().describe('The milestone the task targets.'),
    cycleId: CycleId.nullable().optional().describe('The cycle the task is scheduled into.'),
    startDate: z.iso.date().nullable().optional().describe('The start day, `YYYY-MM-DD`.'),
    dueDate: z.iso.date().nullable().optional().describe('The due day, `YYYY-MM-DD`.'),
    labelIds: z.array(LabelId).optional().describe('Labels to attach on create.'),
    estimate: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe('The effort estimate in the workspace scale, or null for none.'),
    estimateMinutes: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe('The time estimate in minutes, or null for none.'),
    repeat: ComposerRepeatDraft.optional().describe('Whether and how the task repeats.'),
  })
  .meta({ id: 'TaskDraftPayload', description: 'A saved task composer draft.' });
/** Task draft payload value. */
export type TaskDraftPayload = z.infer<typeof TaskDraftPayload>;

/** One unsaved milestone row in a project draft. */
export const ComposerMilestoneDraft = z
  .object({
    name: z.string().describe('The milestone name as typed.'),
    targetDate: z.iso.date().nullable().describe('The planned day, `YYYY-MM-DD`, or null.'),
    description: z.string().describe('The note, empty when none was written.'),
  })
  .meta({ id: 'ComposerMilestoneDraft', description: 'One milestone in a project draft.' });
/** Composer milestone draft value. */
export type ComposerMilestoneDraft = z.infer<typeof ComposerMilestoneDraft>;

/** The project composer's unsent state. */
export const ProjectDraftPayload = z
  .object({
    kind: z.literal('project').describe('Marks a project composer draft.'),
    name: z.string().optional().describe('The name as typed.'),
    summary: z.string().optional().describe('The one-line summary as typed.'),
    description: z.string().optional().describe('The body as typed.'),
    teamOverride: TeamId.nullable()
      .optional()
      .describe('The team chosen in the picker, or null to follow the workspace default.'),
    leadId: ActorId.nullable().optional().describe('The project lead.'),
    programId: ProgramId.nullable().optional().describe('The program the project belongs to.'),
    status: z.string().min(1).optional().describe('The chosen project status key.'),
    health: Health.nullable().optional().describe('The chosen health, or null for unset.'),
    startTimeframe: ComposerTimeframe.nullable().optional().describe('The planned start.'),
    targetTimeframe: ComposerTimeframe.nullable().optional().describe('The planned finish.'),
    initiativeIds: z.array(InitiativeId).optional().describe('Initiatives the project serves.'),
    milestones: z
      .array(ComposerMilestoneDraft)
      .max(50)
      .optional()
      .describe('Milestones in the order they will be created.'),
  })
  .meta({ id: 'ProjectDraftPayload', description: 'A saved project composer draft.' });
/** Project draft payload value. */
export type ProjectDraftPayload = z.infer<typeof ProjectDraftPayload>;

/** The initiative composer's unsent state. */
export const InitiativeDraftPayload = z
  .object({
    kind: z.literal('initiative').describe('Marks an initiative composer draft.'),
    name: z.string().optional().describe('The name as typed.'),
    summary: z.string().optional().describe('The one-line summary as typed.'),
    description: z.string().optional().describe('The body as typed.'),
    ownerId: ActorId.nullable().optional().describe('The accountable owner.'),
    status: InitiativeStatus.optional().describe('The chosen initiative status key.'),
    targetTimeframe: ComposerTimeframe.nullable().optional().describe('The planned finish.'),
    health: Health.nullable().optional().describe('The chosen health, or null for unset.'),
    priority: InitiativePriority.optional().describe('The chosen priority.'),
    updateCadence: InitiativeUpdateCadence.optional().describe('The expected update interval.'),
  })
  .meta({ id: 'InitiativeDraftPayload', description: 'A saved initiative composer draft.' });
/** Initiative draft payload value. */
export type InitiativeDraftPayload = z.infer<typeof InitiativeDraftPayload>;

/** The program composer's unsent state. */
export const ProgramDraftPayload = z
  .object({
    kind: z.literal('program').describe('Marks a program composer draft.'),
    name: z.string().optional().describe('The name as typed.'),
    summary: z.string().optional().describe('The one-line summary as typed.'),
    description: z.string().optional().describe('The body as typed.'),
    ownerId: ActorId.nullable().optional().describe('The accountable owner.'),
    status: ProgramStatus.optional().describe('The chosen program status key.'),
    health: Health.nullable().optional().describe('The chosen health, or null for unset.'),
    visibility: Visibility.optional().describe('Who in the workspace can see the program.'),
  })
  .meta({ id: 'ProgramDraftPayload', description: 'A saved program composer draft.' });
/** Program draft payload value. */
export type ProgramDraftPayload = z.infer<typeof ProgramDraftPayload>;

/** The team composer's unsent state. */
export const TeamDraftPayload = z
  .object({
    kind: z.literal('team').describe('Marks a team composer draft.'),
    name: z.string().optional().describe('The name as typed.'),
    key: z.string().optional().describe('The short key as typed or derived from the name.'),
    summary: z.string().optional().describe('The one-line summary as typed.'),
    description: z.string().optional().describe('The body as typed.'),
    triageEnabled: z.boolean().optional().describe('Whether new work lands in triage first.'),
    agentGuidance: z.string().optional().describe('Standing guidance for Athena on this team.'),
  })
  .meta({ id: 'TeamDraftPayload', description: 'A saved team composer draft.' });
/** Team draft payload value. */
export type TeamDraftPayload = z.infer<typeof TeamDraftPayload>;

/** The unsent state of any composer, discriminated by `kind`. */
export const ComposerDraftPayload = z
  .discriminatedUnion('kind', [
    TaskDraftPayload,
    ProjectDraftPayload,
    InitiativeDraftPayload,
    ProgramDraftPayload,
    TeamDraftPayload,
  ])
  .meta({ id: 'ComposerDraftPayload', description: 'A composer’s saved, unsent state.' });
/** Composer draft payload value. */
export type ComposerDraftPayload = z.infer<typeof ComposerDraftPayload>;

/** A composer draft as the API returns it. */
export const ComposerDraftOut = z
  .object({
    id: z.string().describe('The draft id.'),
    organizationId: OrganizationId.describe('The workspace the composer will create into.'),
    kind: ComposerDraftKind,
    revision: z
      .number()
      .int()
      .describe('Incremented on every save; an edit names the revision it was written against.'),
    payload: ComposerDraftPayload,
    title: z
      .string()
      .nullable()
      .describe('The drafted title or name, trimmed, or null when nothing has been typed yet.'),
    createdAt: z.string().describe('When the draft was first saved, ISO 8601.'),
    updatedAt: z.string().describe('When the draft was last saved, ISO 8601.'),
    expiresAt: z.string().describe('When the draft is removed unless edited again, ISO 8601.'),
  })
  .meta({ id: 'ComposerDraftOut', description: 'A saved composer draft.' });
/** Composer draft value. */
export type ComposerDraftOut = z.infer<typeof ComposerDraftOut>;

/** The caller's drafts. */
export const ComposerDraftListOut = z
  .object({ items: z.array(ComposerDraftOut).describe('Drafts, most recently saved first.') })
  .meta({ id: 'ComposerDraftListOut', description: 'The caller’s composer drafts.' });
/** Composer draft list value. */
export type ComposerDraftListOut = z.infer<typeof ComposerDraftListOut>;

/** Filters for listing drafts. */
export const ComposerDraftListQuery = z
  .object({
    kind: ComposerDraftKind.optional().describe('Only drafts for this composer.'),
    organizationId: OrganizationId.optional().describe('Only drafts for this workspace.'),
  })
  .meta({ id: 'ComposerDraftListQuery', description: 'Filters for listing composer drafts.' });
/** Composer draft list query value. */
export type ComposerDraftListQuery = z.infer<typeof ComposerDraftListQuery>;

/** Save a new draft. */
export const ComposerDraftCreate = z
  .object({
    organizationId: OrganizationId.describe('The workspace the composer will create into.'),
    kind: ComposerDraftKind.describe(
      'Which composer the draft belongs to. Must equal `payload.kind`; a mismatch is rejected with 422. Immutable after creation.',
    ),
    payload: ComposerDraftPayload.describe('The composer’s current state.'),
  })
  .refine((value) => value.payload.kind === value.kind, {
    message: 'The payload must describe the same composer the draft belongs to.',
    path: ['payload', 'kind'],
  })
  .meta({ id: 'ComposerDraftCreate', description: 'Save a new composer draft.' });
/** Composer draft create value. */
export type ComposerDraftCreate = z.infer<typeof ComposerDraftCreate>;

/** Replace a draft's payload against the revision it was read at. */
export const ComposerDraftPatch = z
  .object({
    revision: z.number().int().min(0).describe('The revision the payload was written against.'),
    payload: ComposerDraftPayload.describe('The composer’s whole current state.'),
  })
  .meta({ id: 'ComposerDraftPatch', description: 'Save a composer draft against one revision.' });
/** Composer draft patch value. */
export type ComposerDraftPatch = z.infer<typeof ComposerDraftPatch>;

/**
 * The title a draft shows in a list: the trimmed `title` or `name` the composer holds.
 *
 * @returns The trimmed text, or null when nothing has been typed yet.
 */
export function composerDraftTitle(payload: ComposerDraftPayload): string | null {
  const raw = payload.kind === 'task' ? payload.title : payload.name;
  const trimmed = raw?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
