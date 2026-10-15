/**
 * `domain packages` — Template slice DTOs.
 *
 * @remarks
 * A template is a named, scoped, reusable *pre-filled draft* for one of the four authored work
 * kinds. Its `payload` is a discriminated union keyed on `targetType`, and each member is a
 * partial of that kind's `*Create` body, so applying a template is a merge into the create call
 * rather than a translation between two vocabularies.
 *
 * A payload deliberately carries no reference to an actor, team, project, milestone or cycle.
 * Those rows come and go; a template that names a departed person or a closed project is a
 * template that fails to apply, and pruning every such reference on delete costs more than the
 * convenience is worth. `labelIds` is the exception — labels are org-scoped, long-lived, and the
 * one reference a "Bug report" template genuinely needs.
 *
 * Absolute dates are excluded: reusable relative timing belongs to the separate blueprint rules.
 */
import { z } from 'zod';

import { Health } from './capability';
import { InitiativePriority, InitiativeStatus, InitiativeUpdateCadence } from './initiative';
import { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import { TemplateId, WorkTypeVersionId } from '../ids';
import { ViewScope } from './saved-view';
import {
  BlueprintTaskFields,
  BlueprintProjectFields,
  BlueprintProgramFields,
} from './work-template-blueprint';

/** The entity kinds a template may pre-fill. */
export const TemplateTargetType = z
  .enum(['task', 'project', 'initiative', 'program'])
  .describe(
    'The kind of work a template creates: `task`, `project`, `initiative`, or `program`. A Cycle is a date window and a Team is structural, so neither is templatable.',
  );
/** Template target-type value. */
export type TemplateTargetType = z.infer<typeof TemplateTargetType>;

/** The pre-filled draft a Task template applies. */
export const TaskTemplateDraft = z
  .object({
    targetType: z.literal('task'),
    ...BlueprintTaskFields.pick({
      title: true,
      description: true,
      priority: true,
      labelIds: true,
    }).partial().shape,
    title: z.string().optional(),
  })
  .meta({ id: 'TaskTemplateDraft', description: 'The reusable starting draft for Task work.' });
/** Task template draft value. */
export type TaskTemplateDraft = z.infer<typeof TaskTemplateDraft>;

/** The pre-filled draft a Project template applies. */
export const ProjectTemplateDraft = z
  .object({
    targetType: z.literal('project'),
    ...BlueprintProjectFields.omit({ priority: true }).partial().shape,
    name: z.string().optional(),
  })
  .meta({
    id: 'ProjectTemplateDraft',
    description: 'The reusable starting draft for Project work.',
  });
/** Project template draft value. */
export type ProjectTemplateDraft = z.infer<typeof ProjectTemplateDraft>;

/** The pre-filled draft an Initiative template applies. */
export const InitiativeTemplateDraft = z
  .object({
    targetType: z
      .literal('initiative')
      .describe('Discriminant; must equal the template’s `targetType`.'),
    name: z.string().optional().describe('Pre-filled initiative name.'),
    summary: z.string().max(280).optional().describe('Pre-filled one-line summary.'),
    description: z.string().optional().describe('Pre-filled markdown body.'),
    status: InitiativeStatus.optional().describe('Pre-filled lifecycle status.'),
    priority: InitiativePriority.optional().describe('Pre-filled priority.'),
    updateCadence: InitiativeUpdateCadence.optional().describe(
      'Pre-filled expected update interval — the cadence the template’s framing implies.',
    ),
    health: Health.optional().describe('Pre-filled health verdict.'),
  })
  .meta({
    id: 'InitiativeTemplateDraft',
    description: 'The draft an Initiative template pre-fills.',
  });
/** Initiative template draft value. */
export type InitiativeTemplateDraft = z.infer<typeof InitiativeTemplateDraft>;

/** The pre-filled draft a Program template applies. */
export const ProgramTemplateDraft = z
  .object({
    targetType: z.literal('program'),
    ...BlueprintProgramFields.partial().shape,
    name: z.string().optional(),
  })
  .meta({
    id: 'ProgramTemplateDraft',
    description: 'The reusable starting draft for Program work.',
  });
/** Program template draft value. */
export type ProgramTemplateDraft = z.infer<typeof ProgramTemplateDraft>;

/** The draft a template applies, discriminated by the kind it creates. */
export const TemplateDraft = z
  .discriminatedUnion('targetType', [
    TaskTemplateDraft,
    ProjectTemplateDraft,
    InitiativeTemplateDraft,
    ProgramTemplateDraft,
  ])
  .describe(
    'The pre-filled draft, discriminated on `targetType`. Every field is optional: a template that only sets a markdown outline is as valid as one that sets every property.',
  );
/** Template draft value. */
export type TemplateDraft = z.infer<typeof TemplateDraft>;

/** Canonical reusable starting fields reject unsupported literal references; legacy inputs still normalize them. */
export const CanonicalTemplateDraft = z.discriminatedUnion('targetType', [
  z.strictObject({
    targetType: z.literal('task'),
    ...BlueprintTaskFields.partial().shape,
    title: z.string().optional(),
  }),
  z.strictObject({
    targetType: z.literal('project'),
    ...BlueprintProjectFields.partial().shape,
    name: z.string().optional(),
  }),
  InitiativeTemplateDraft.strict(),
  ProgramTemplateDraft.strict(),
]);
/** Strict canonical starting-draft value. */
export type CanonicalTemplateDraft = z.infer<typeof CanonicalTemplateDraft>;

/** Body for creating a Template (organizationId comes from the path, never the body). */
export const TemplateCreate = z
  .object({
    targetType: TemplateTargetType.describe(
      'The kind this template creates. Must equal `payload.targetType`; a mismatch is rejected with 422. Immutable after creation.',
    ),
    name: z
      .string()
      .min(1)
      .describe(
        'The template’s own name, shown verbatim in the picker (e.g. "Bug report"). Required, non-empty. Not vocabulary-skinned — it is an ordinary editable string.',
      ),
    description: z
      .string()
      .optional()
      .describe('One line explaining when to reach for this template, shown under its name.'),
    scope: ViewScope.optional().describe(
      "Sharing scope: 'personal' | 'team' | 'organization'. Defaults to 'personal'.",
    ),
    ownerActorId: ActorId.optional().describe(
      'Owning actor. Defaults to the calling actor. Mainly meaningful for a `personal` template.',
    ),
    teamId: TeamId.optional().describe(
      'Team the template belongs to. Required when `scope` is `team`, ignored otherwise. Must be a team in the caller’s org.',
    ),
    payload: TemplateDraft.describe('The pre-filled draft this template applies.'),
  })
  .refine((value) => value.payload.targetType === value.targetType, {
    message: 'The payload must describe the same kind the template creates.',
    path: ['payload', 'targetType'],
  })
  .refine((value) => value.scope !== 'team' || value.teamId !== undefined, {
    message: 'A team-scoped template must name the team it belongs to.',
    path: ['teamId'],
  })
  .meta({ id: 'TemplateCreate', description: 'Create a template within an organization.' });
/** Validated template-create body. */
export type TemplateCreate = z.infer<typeof TemplateCreate>;

/**
 * Body for updating a Template (all fields optional).
 *
 * @remarks
 * `targetType` is absent on purpose: changing the kind would leave the stored payload describing
 * a different entity. Re-kinding a template means creating a new one.
 *
 * No field is nullable. `description` clears by sending an empty string, and `teamId` is dropped
 * by the server whenever `scope` moves away from `team`, so there is nothing an explicit null
 * would express that omission or an empty string does not.
 */
export const TemplateUpdate = z
  .object({
    name: z.string().min(1).optional().describe('New name (non-empty). Omit to leave unchanged.'),
    description: z
      .string()
      .optional()
      .describe(
        'New one-line description; send an empty string to clear. Omit to leave unchanged.',
      ),
    scope: ViewScope.optional().describe(
      "New sharing scope: 'personal' | 'team' | 'organization'. Omit to leave unchanged. Moving away from `team` clears `teamId`.",
    ),
    ownerActorId: ActorId.optional().describe('Re-owner the template. Omit to leave unchanged.'),
    teamId: TeamId.optional().describe(
      'Re-scope to this team. Required when `scope` becomes `team`. Omit to leave unchanged.',
    ),
    payload: TemplateDraft.optional().describe(
      'Replacement draft (replaces wholesale, not merged). Its `targetType` must match the template’s. Omit to leave unchanged.',
    ),
  })
  // Naming `team` scope requires naming the team in the same request. The stored `teamId` is not
  // consulted as a fallback: a template that was team-scoped, moved to personal, and is now moving
  // back would silently inherit a team the author never re-chose.
  .refine((value) => value.scope !== 'team' || value.teamId !== undefined, {
    message: 'A team-scoped template must name the team it belongs to.',
    path: ['teamId'],
  })
  .meta({ id: 'TemplateUpdate', description: 'Update a template.' });
/** Validated template-update body. */
export type TemplateUpdate = z.infer<typeof TemplateUpdate>;

/** Full template representation returned by reads. */
export const TemplateOut = z
  .object({
    workTypeVersionId: WorkTypeVersionId.nullable().optional(),
    publicationState: z.enum(['draft', 'published', 'archived']).optional(),
    isBase: z.boolean().optional(),
    id: TemplateId.describe('Opaque template id.'),
    organizationId: OrganizationId.describe('Owning org id (the tenant key).'),
    targetType: TemplateTargetType.describe('The kind this template creates.'),
    name: z.string().describe('The template’s name, shown in the picker.'),
    description: z.string().nullable().describe('One-line description; null when unset.'),
    scope: ViewScope.describe("Sharing scope: 'personal' | 'team' | 'organization'."),
    ownerActorId: ActorId.nullable().describe('Owning actor; null when ownerless.'),
    teamId: TeamId.nullable().describe('Team the template belongs to; null unless team-scoped.'),
    payload: TemplateDraft.describe('The pre-filled draft this template applies.'),
    isSeed: z
      .boolean()
      .describe(
        'Whether Docket seeded this template as a shipped default. Seeded rows are ordinary rows — editable, renamable, and deletable — so this is presentational, never a permission.',
      ),
    createdAt: z.string().describe('Creation timestamp (ISO 8601).'),
  })
  .meta({ id: 'TemplateOut', description: 'A template.' });
/** Template representation value. */
export type TemplateOut = z.infer<typeof TemplateOut>;
