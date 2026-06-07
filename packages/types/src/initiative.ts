/**
 * `@docket/types` — Initiative slice DTOs.
 */
import { z } from 'zod';

import { Health } from './capability';
import { ActorId, InitiativeId, OrganizationId, ProgramId, ProjectId } from './primitives';

/** Initiative (theme) status. */
export const InitiativeStatus = z.enum(['active', 'completed']);
/** Initiative status value. */
export type InitiativeStatus = z.infer<typeof InitiativeStatus>;

/** Body for creating an Initiative (organizationId comes from the path, never the body). */
export const InitiativeCreate = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    ownerId: ActorId.optional(),
    status: InitiativeStatus.optional(),
    targetDate: z.iso.date().optional(),
    health: Health.optional(),
  })
  .meta({ id: 'InitiativeCreate', description: 'Create an initiative within an organization.' });
/** Validated initiative-create body. */
export type InitiativeCreate = z.infer<typeof InitiativeCreate>;

/** Body for updating an Initiative (all fields optional). */
export const InitiativeUpdate = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    ownerId: ActorId.nullable().optional(),
    status: InitiativeStatus.optional(),
    targetDate: z.iso.date().nullable().optional(),
    health: Health.nullable().optional(),
  })
  .meta({ id: 'InitiativeUpdate', description: 'Update an initiative.' });
/** Validated initiative-update body. */
export type InitiativeUpdate = z.infer<typeof InitiativeUpdate>;

/** Full initiative representation returned by reads. */
export const InitiativeOut = z
  .object({
    id: InitiativeId,
    organizationId: OrganizationId,
    name: z.string(),
    description: z.string().nullable().optional(),
    ownerId: ActorId.nullable().optional(),
    status: InitiativeStatus,
    targetDate: z.string().nullable().optional(),
    health: Health.nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'InitiativeOut', description: 'An initiative.' });
/** Initiative representation value. */
export type InitiativeOut = z.infer<typeof InitiativeOut>;

/**
 * A health distribution: how many of an Initiative's associated children fall into each
 * `Health` bucket, plus the number that carry no health verdict.
 *
 * @remarks
 * An Initiative contains no work itself; its rolled-up signal is derived purely from the
 * `health` of the Projects + Programs it associates with (data-model §4.1/§7). A child
 * with a null `health` is counted in {@link InitiativeHealthDistribution.unknown} rather
 * than silently treated as on-track.
 */
export const InitiativeHealthDistribution = z
  .object({
    /** Children with `health = on_track`. */
    onTrack: z.number().int().min(0),
    /** Children with `health = at_risk`. */
    atRisk: z.number().int().min(0),
    /** Children with `health = off_track`. */
    offTrack: z.number().int().min(0),
    /** Children that carry no `health` verdict yet. */
    unknown: z.number().int().min(0),
  })
  .meta({
    id: 'InitiativeHealthDistribution',
    description: "Counts of an initiative's children per health bucket.",
  });
/** Initiative health-distribution value. */
export type InitiativeHealthDistribution = z.infer<typeof InitiativeHealthDistribution>;

/**
 * The count of each kind of child an Initiative associates with (its m2m membership mix).
 *
 * @remarks
 * The `childMix` referenced by the api-rpc-contract §3.3 `InitiativeOut` roll-up: how many
 * Programs and Projects the Initiative spans, regardless of their health/status.
 */
export const InitiativeChildMix = z
  .object({
    /** Number of associated Programs (`initiative_program`). */
    programs: z.number().int().min(0),
    /** Number of associated Projects (`initiative_project`). */
    projects: z.number().int().min(0),
  })
  .meta({ id: 'InitiativeChildMix', description: "An initiative's program/project counts." });
/** Initiative child-mix value. */
export type InitiativeChildMix = z.infer<typeof InitiativeChildMix>;

/**
 * Full Initiative detail: the base {@link InitiativeOut} plus the membership roll-up.
 *
 * @remarks
 * Because an Initiative carries no work, the detail enriches the stored row with values
 * derived from its associated children:
 * - `childMix` — how many Programs/Projects it spans.
 * - `distribution` — the per-health-bucket breakdown of those children.
 * - `rolledUpHealth` — the worst child health (`off_track > at_risk > on_track`), or `null`
 *   when no child carries a verdict. This is the auto-derived signal the contract calls for.
 * - `derivedStatus` — `completed` when there is at least one child and every associated
 *   Project has reached a terminal (`completed`/`canceled`) status; otherwise `active`.
 *   This reflects the children's reality independent of the stored `status` field.
 */
export const InitiativeDetail = InitiativeOut.extend({
  /** The program/project membership counts. */
  childMix: InitiativeChildMix,
  /** The per-health-bucket breakdown of associated children. */
  distribution: InitiativeHealthDistribution,
  /** The worst child health (off_track ≻ at_risk ≻ on_track), or null when none is set. */
  rolledUpHealth: Health.nullable(),
  /** Status auto-derived from children (`completed` iff every child Project is terminal). */
  derivedStatus: InitiativeStatus,
}).meta({ id: 'InitiativeDetail', description: 'An initiative with its child roll-up.' });
/** Initiative detail value. */
export type InitiativeDetail = z.infer<typeof InitiativeDetail>;

/** Body for linking a Project to an Initiative (the initiative id comes from the path). */
export const InitiativeProjectLink = z
  .object({
    /** The Project to associate with the Initiative. */
    projectId: ProjectId,
  })
  .meta({ id: 'InitiativeProjectLink', description: 'Associate a project with an initiative.' });
/** Validated initiative→project link body. */
export type InitiativeProjectLink = z.infer<typeof InitiativeProjectLink>;

/** Body for linking a Program to an Initiative (the initiative id comes from the path). */
export const InitiativeProgramLink = z
  .object({
    /** The Program to associate with the Initiative. */
    programId: ProgramId,
  })
  .meta({ id: 'InitiativeProgramLink', description: 'Associate a program with an initiative.' });
/** Validated initiative→program link body. */
export type InitiativeProgramLink = z.infer<typeof InitiativeProgramLink>;

/** Result of linking a Project to an Initiative. */
export const InitiativeProjectLinked = z
  .object({
    initiativeId: InitiativeId,
    projectId: ProjectId,
    /** Always `true`; the edge now exists (idempotent). */
    linked: z.literal(true),
  })
  .meta({ id: 'InitiativeProjectLinked', description: 'An initiative↔project link result.' });
/** Initiative→project link result value. */
export type InitiativeProjectLinked = z.infer<typeof InitiativeProjectLinked>;

/** Result of linking a Program to an Initiative. */
export const InitiativeProgramLinked = z
  .object({
    initiativeId: InitiativeId,
    programId: ProgramId,
    /** Always `true`; the edge now exists (idempotent). */
    linked: z.literal(true),
  })
  .meta({ id: 'InitiativeProgramLinked', description: 'An initiative↔program link result.' });
/** Initiative→program link result value. */
export type InitiativeProgramLinked = z.infer<typeof InitiativeProgramLinked>;

/** Result of unlinking a child (Project or Program) from an Initiative. */
export const InitiativeUnlinked = z
  .object({
    /** Always `true`; the edge no longer exists. */
    unlinked: z.literal(true),
  })
  .meta({ id: 'InitiativeUnlinked', description: 'An initiative child-unlink result.' });
/** Initiative child-unlink result value. */
export type InitiativeUnlinked = z.infer<typeof InitiativeUnlinked>;

/**
 * One timeline bar for an associated Project (a bounded, dated effort).
 *
 * @remarks
 * The roadmap-first roll-up (api-rpc-contract §3.3 `GET /:initiativeId/timeline`): each
 * associated Project becomes a dated bar with its current `status`/`health`. `startDate`
 * and `targetDate` may be null when the Project has not been scheduled.
 */
export const InitiativeTimelineBar = z
  .object({
    id: ProjectId,
    /** The Project's display name. */
    name: z.string(),
    /** The Project's lifecycle status (`planned`/`active`/`completed`/`canceled`). */
    status: z.string(),
    /** The Project's health verdict, when set. */
    health: Health.nullable(),
    /** ISO start date, when scheduled. */
    startDate: z.string().nullable(),
    /** ISO target/end date, when scheduled. */
    targetDate: z.string().nullable(),
  })
  .meta({ id: 'InitiativeTimelineBar', description: 'A project bar on an initiative timeline.' });
/** Initiative timeline project-bar value. */
export type InitiativeTimelineBar = z.infer<typeof InitiativeTimelineBar>;

/**
 * One timeline lane for an associated Program (an ongoing area of operations).
 *
 * @remarks
 * Programs have no end state, so a lane carries no end date — only its identity, current
 * `status`, and `health`. Lanes render above the Project bars on the roadmap.
 */
export const InitiativeTimelineLane = z
  .object({
    id: ProgramId,
    /** The Program's display name. */
    name: z.string(),
    /** The Program's status (`active`/`paused`/`archived`). */
    status: z.string(),
    /** The Program's health verdict, when set. */
    health: Health.nullable(),
  })
  .meta({ id: 'InitiativeTimelineLane', description: 'A program lane on an initiative timeline.' });
/** Initiative timeline program-lane value. */
export type InitiativeTimelineLane = z.infer<typeof InitiativeTimelineLane>;

/**
 * The roadmap-first timeline roll-up for an Initiative: its Program lanes + Project bars.
 *
 * @remarks
 * Returned by `GET /:initiativeId/timeline`. The optional `from`/`to` query window filters
 * the Project bars to those that overlap the window (a Project overlaps when it has no
 * dates, or its `[startDate, targetDate]` intersects `[from, to]`); Program lanes are
 * always returned (they are ongoing and undated).
 */
export const InitiativeTimelineOut = z
  .object({
    /** Ongoing Program lanes associated with the Initiative. */
    programs: z.array(InitiativeTimelineLane),
    /** Dated Project bars associated with the Initiative. */
    projects: z.array(InitiativeTimelineBar),
  })
  .meta({ id: 'InitiativeTimelineOut', description: 'An initiative roadmap roll-up.' });
/** Initiative timeline value. */
export type InitiativeTimelineOut = z.infer<typeof InitiativeTimelineOut>;

/** Query window for the Initiative timeline (both bounds optional ISO dates). */
export const InitiativeTimelineQuery = z
  .object({
    /** Lower bound (ISO date) of the timeline window. */
    from: z.iso.date().optional(),
    /** Upper bound (ISO date) of the timeline window. */
    to: z.iso.date().optional(),
  })
  .meta({ id: 'InitiativeTimelineQuery', description: 'Initiative timeline window query.' });
/** Validated initiative-timeline query value. */
export type InitiativeTimelineQuery = z.infer<typeof InitiativeTimelineQuery>;
