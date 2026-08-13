/**
 * `@docket/api` — reading Docket entities as mirror values.
 *
 * @remarks
 * The one place that knows how each of the nine projected entities maps onto the catalog's field
 * keys. Kept apart from the reconciler so that file stays about ordering and pacing, and apart
 * from `notion-mirror-values` so *that* file stays free of the database.
 *
 * Every loader is org-scoped and skips archived records. The task loader additionally withholds
 * tasks already linked to a database on the same integration — projecting those would put the
 * same work in one Notion workspace twice.
 */
import {
  actor,
  cycle,
  db,
  health,
  initiative,
  initiativeProgram,
  initiativeProject,
  label,
  labelGroup,
  milestone,
  program,
  project,
  projectStatus,
  task,
  taskLabel,
  taskPriority,
  team,
  teamMember,
  user,
} from '@docket/db';
import type { NotionMirrorEntity } from '@docket/types';
import { personCompanionKey } from '@docket/integrations';
import type { MirrorSourceValue, MirrorValue } from '@docket/integrations';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { setTaskState } from '../lib/task-state';
import { enqueueSearchUpsert } from '../search/write-through';

import { resolveImportTeam } from './integration-import';
import { resolveStateKeys } from './integration-reconcile';
import type { IntegrationRow } from './integration-provider';

/** One Docket record, ready to resolve and then project. */
export interface MirrorEntityRecord {
  /** The Docket entity's id. */
  readonly entityId: string;
  /**
   * Its values, keyed by the catalog's field keys.
   *
   * @remarks
   * `MirrorSourceValue`, not `MirrorValue`: a person-valued field is emitted as an actor reference
   * and rendered by `resolveMirrorValues` once the id maps are loaded. That widening is deliberate
   * — it makes a projection path that skips the resolver a compile error rather than a silent
   * fallback to the display name.
   */
  readonly values: Readonly<Record<string, MirrorSourceValue>>;
}

/** Wrap a nullable string as a text value. */
const text = (value: string | null | undefined): MirrorValue => ({
  kind: 'text',
  value: value ?? null,
});

/** Wrap a nullable date column as an RFC3339 date value. */
const date = (value: Date | string | null | undefined): MirrorValue => {
  if (value === null || value === undefined) return { kind: 'date', value: null };
  const parsed = typeof value === 'string' ? new Date(value) : value;
  return {
    kind: 'date',
    value: Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10),
  };
};

/** Wrap an enum-ish column as a select option. */
const option = (value: string | null | undefined): MirrorValue => ({
  kind: 'option',
  value: value ?? null,
});

/** Wrap a number column. */
const number = (value: number | null | undefined): MirrorValue => ({
  kind: 'number',
  value: value ?? null,
});

/** Wrap a boolean column. */
const boolean = (value: boolean): MirrorValue => ({ kind: 'boolean', value });

/**
 * A deep link back into Docket.
 *
 * @remarks
 * Relative rather than absolute: the app's public origin is environment-specific, and baking a
 * host into rows that live in somebody's Notion workspace would leave every link pointing at the
 * wrong environment after a domain change.
 */
const docketUrl = (orgId: string, path: string): MirrorValue => ({
  kind: 'url',
  value: `/orgs/${orgId}/${path}`,
});

/**
 * Wrap a to-one foreign key as a reference to another projected entity.
 *
 * @remarks
 * A null key is an empty reference rather than an omitted field: "no project" is a fact worth
 * writing, and it clears the Notion cell. Absence would defer instead — see `resolveMirrorValues`.
 */
const ref = (entity: NotionMirrorEntity, id: string | null): MirrorSourceValue => ({
  kind: 'reference',
  entity,
  entityIds: id === null ? [] : [id],
});

/** Wrap a to-many set as a reference. */
const refs = (entity: NotionMirrorEntity, ids: readonly string[]): MirrorSourceValue => ({
  kind: 'reference',
  entity,
  entityIds: ids,
});

/**
 * Group a join table's rows into `owner id → related ids`.
 *
 * @remarks
 * One query per to-many relation, grouped in memory, rather than a query per row. The link tables
 * are narrow and org-scoped, and a projection pass already walks every row of the owning entity —
 * doing this per row would turn one pass into thousands of round trips.
 *
 * Each group is **sorted**, and that is load-bearing rather than cosmetic: Postgres returns link
 * rows in no guaranteed order, while the projected content hash stringifies the relation array in
 * order. An unsorted group would hash differently from one sweep to the next with nothing changed,
 * so every row with two or more links would be rewritten to Notion on every pass — burning the
 * write budget on no-ops and starving the entities projected after it.
 *
 * @param pairs - Rows of `{ ownerId, relatedId }`.
 * @returns the grouped map, each group in a stable order; an owner with no links is simply absent.
 */
function groupLinks(
  pairs: readonly { ownerId: string; relatedId: string }[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const pair of pairs) {
    const existing = grouped.get(pair.ownerId);
    if (existing === undefined) grouped.set(pair.ownerId, [pair.relatedId]);
    else existing.push(pair.relatedId);
  }
  for (const ids of grouped.values()) ids.sort();
  return grouped;
}

/** Display names for the actors an org's records point at. */
async function actorNames(orgId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: actor.id, displayName: actor.displayName })
    .from(actor)
    .where(eq(actor.organizationId, orgId));
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

/**
 * Load every projectable record for one entity, with its values.
 *
 * @remarks
 * Person-valued fields are emitted as **references** — an actor id plus a display name — rather
 * than as a rendered value. How one is written depends on the column's representation, which needs
 * the external-actor mapping and the People database's own page ids; neither belongs in a loader,
 * and both are per-pass rather than per-row. `resolveMirrorValues` turns them into Notion values.
 *
 * Each reference is emitted twice: once under the field's own key, and once under its companion
 * key. They render differently because their bindings differ — the parent as text or a relation,
 * the companion as a native Notion person — which is what lets a workspace get @-mentions for the
 * people who have Notion accounts without losing the ones who do not.
 *
 * @param orgId - The tenant.
 * @param integrationId - The Notion integration, for the task exclusion rule.
 * @param entity - Which entity to load.
 * @returns every record that should appear in the projected database.
 */
export async function loadEntityRows(
  orgId: string,
  integrationId: string,
  entity: NotionMirrorEntity,
): Promise<MirrorEntityRecord[]> {
  const names = await actorNames(orgId);
  /** One person-valued field, as both its own column and its native-Notion companion. */
  const personFields = (field: string, id: string | null): Record<string, MirrorSourceValue> => {
    const actorRef: MirrorSourceValue = {
      kind: 'actor',
      actorId: id,
      displayName: id === null ? null : (names.get(id) ?? null),
    };
    return { [field]: actorRef, [personCompanionKey(field)]: actorRef };
  };

  switch (entity) {
    case 'task': {
      const [rows, labelLinks] = await Promise.all([
        db
          .select()
          .from(task)
          .where(
            and(
              eq(task.organizationId, orgId),
              isNull(task.archivedAt),
              // Already mirrored into this Notion workspace by the linked-database connector.
              sql`(${task.sourceIntegrationId} is distinct from ${integrationId})`,
            ),
          ),
        db
          .select({ ownerId: taskLabel.taskId, relatedId: taskLabel.labelId })
          .from(taskLabel)
          .where(eq(taskLabel.organizationId, orgId)),
      ]);
      const labelsByTask = groupLinks(labelLinks);
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          title: text(row.title),
          state: option(row.state),
          ...personFields('assignee', row.assigneeId),
          dueDate: date(row.dueDate),
          startDate: date(row.startDate),
          priority: option(row.priority),
          estimateMinutes: number(row.estimateMinutes),
          description: text(row.description),
          project: ref('project', row.projectId),
          cycle: ref('cycle', row.cycleId),
          milestone: ref('milestone', row.milestoneId),
          team: ref('team', row.teamId),
          labels: refs('label', labelsByTask.get(row.id) ?? []),
          docketUrl: docketUrl(orgId, `tasks/${row.id}`),
        },
      }));
    }
    case 'project': {
      const [rows, initiativeLinks] = await Promise.all([
        db
          .select()
          .from(project)
          .where(and(eq(project.organizationId, orgId), isNull(project.archivedAt))),
        db
          .select({
            ownerId: initiativeProject.projectId,
            relatedId: initiativeProject.initiativeId,
          })
          .from(initiativeProject)
          .where(eq(initiativeProject.organizationId, orgId)),
      ]);
      const initiativesByProject = groupLinks(initiativeLinks);
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          name: text(row.name),
          status: option(row.status),
          health: option(row.health),
          ...personFields('lead', row.leadId),
          targetDate: date(row.targetDate),
          startDate: date(row.startDate),
          summary: text(row.summary),
          program: ref('program', row.programId),
          team: ref('team', row.teamId),
          initiatives: refs('initiative', initiativesByProject.get(row.id) ?? []),
          docketUrl: docketUrl(orgId, `projects/${row.id}`),
        },
      }));
    }
    case 'initiative': {
      const [rows, projectLinks, programLinks] = await Promise.all([
        db
          .select()
          .from(initiative)
          .where(and(eq(initiative.organizationId, orgId), isNull(initiative.archivedAt))),
        db
          .select({
            ownerId: initiativeProject.initiativeId,
            relatedId: initiativeProject.projectId,
          })
          .from(initiativeProject)
          .where(eq(initiativeProject.organizationId, orgId)),
        db
          .select({
            ownerId: initiativeProgram.initiativeId,
            relatedId: initiativeProgram.programId,
          })
          .from(initiativeProgram)
          .where(eq(initiativeProgram.organizationId, orgId)),
      ]);
      const projectsByInitiative = groupLinks(projectLinks);
      const programsByInitiative = groupLinks(programLinks);
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          name: text(row.name),
          status: option(row.status),
          health: option(row.health),
          priority: option(row.priority),
          ...personFields('owner', row.ownerId),
          targetDate: date(row.targetDate),
          updateCadence: option(row.updateCadence),
          summary: text(row.summary),
          projects: refs('project', projectsByInitiative.get(row.id) ?? []),
          programs: refs('program', programsByInitiative.get(row.id) ?? []),
          docketUrl: docketUrl(orgId, `initiatives/${row.id}`),
        },
      }));
    }
    case 'program': {
      // `program.projects` has no link table: it is the reverse of `project.program_id`, so the
      // grouping is by the FK on the projects themselves.
      const [rows, ownedProjects] = await Promise.all([
        db
          .select()
          .from(program)
          .where(and(eq(program.organizationId, orgId), isNull(program.archivedAt))),
        db
          .select({ ownerId: project.programId, relatedId: project.id })
          .from(project)
          .where(and(eq(project.organizationId, orgId), isNull(project.archivedAt))),
      ]);
      // The narrowing IS the filter — no `isNotNull` predicate beside it, which would state the
      // same rule twice and read as though a null could still reach the map.
      const projectsByProgram = groupLinks(
        ownedProjects.filter(
          (link): link is { ownerId: string; relatedId: string } => link.ownerId !== null,
        ),
      );
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          name: text(row.name),
          status: option(row.status),
          health: option(row.health),
          ...personFields('owner', row.ownerId),
          summary: text(row.summary),
          projects: refs('project', projectsByProgram.get(row.id) ?? []),
          docketUrl: docketUrl(orgId, `programs/${row.id}`),
        },
      }));
    }
    case 'team': {
      // `team_member` references actors of every kind, while the People database projects humans
      // only. The agents and team-shadow actors among them therefore have no page, which the
      // resolver reports as permanently unresolvable rather than waiting for one forever.
      const [rows, memberLinks] = await Promise.all([
        db
          .select()
          .from(team)
          .where(and(eq(team.organizationId, orgId), isNull(team.archivedAt))),
        db
          .select({ ownerId: teamMember.teamId, relatedId: teamMember.actorId })
          .from(teamMember)
          .where(eq(teamMember.organizationId, orgId)),
      ]);
      const membersByTeam = groupLinks(memberLinks);
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          name: text(row.name),
          key: text(row.key),
          summary: text(row.summary),
          members: refs('person', membersByTeam.get(row.id) ?? []),
          docketUrl: docketUrl(orgId, `teams/${row.id}`),
        },
      }));
    }
    case 'cycle': {
      const rows = await db
        .select()
        .from(cycle)
        .where(and(eq(cycle.organizationId, orgId), isNull(cycle.archivedAt)));
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          name: text(row.name ?? `Cycle ${String(row.number)}`),
          number: number(row.number),
          status: option(row.status),
          startsAt: date(row.startsAt),
          endsAt: date(row.endsAt),
          team: ref('team', row.teamId),
          docketUrl: docketUrl(orgId, `cycles/${row.id}`),
        },
      }));
    }
    case 'milestone': {
      const rows = await db
        .select()
        .from(milestone)
        .where(and(eq(milestone.organizationId, orgId), isNull(milestone.archivedAt)));
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          name: text(row.name),
          targetDate: date(row.targetDate),
          description: text(row.description),
          project: ref('project', row.projectId),
          docketUrl: docketUrl(orgId, `projects/${row.projectId}`),
        },
      }));
    }
    case 'label': {
      // `label.group` is a legacy always-null column (see its own doc comment); the real
      // cluster is `label.groupId`, a foreign key, so the projected "Group" select option is
      // the referenced `labelGroup.name`, not the id.
      const rows = await db
        .select({
          id: label.id,
          name: label.name,
          color: label.color,
          groupName: labelGroup.name,
        })
        .from(label)
        .leftJoin(labelGroup, eq(labelGroup.id, label.groupId))
        .where(eq(label.organizationId, orgId));
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          name: text(row.name),
          color: option(row.color),
          group: option(row.groupName),
        },
      }));
    }
    case 'person': {
      // Humans only. Agent and team actors are assignable in Docket but are not people, and a
      // People database listing them would misrepresent the roster.
      //
      // `email` comes from the Better Auth user an actor is backed by, and is therefore absent for
      // an account-less person. That is the truth, and the right thing to show: falling back to
      // `external_actor.email` would be echoing Notion's own copy of the address back into Notion
      // as though Docket knew it.
      const [rows, teamLinks] = await Promise.all([
        db
          .select({
            id: actor.id,
            displayName: actor.displayName,
            title: actor.title,
            userId: actor.userId,
            email: user.email,
          })
          .from(actor)
          .leftJoin(user, eq(actor.userId, user.id))
          .where(
            and(eq(actor.organizationId, orgId), eq(actor.kind, 'human'), isNull(actor.archivedAt)),
          ),
        db
          .select({ ownerId: teamMember.actorId, relatedId: teamMember.teamId })
          .from(teamMember)
          .where(eq(teamMember.organizationId, orgId)),
      ]);
      const teamsByActor = groupLinks(teamLinks);
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          displayName: text(row.displayName),
          email: text(row.email),
          jobTitle: text(row.title),
          // The roster's own native-Notion column: an actor reference resolved to the matched
          // Notion user, or left empty. Declared in the catalog and in `defaultColumns` since the
          // beginning, but never given a value — so the column was created in every workspace and
          // stayed permanently blank.
          notionUser: { kind: 'actor', actorId: row.id, displayName: row.displayName },
          teams: refs('team', teamsByActor.get(row.id) ?? []),
          // `user_id` is what distinguishes a person with an account from one without — the
          // account-less actors this whole feature exists to keep first-class.
          hasDocketAccount: boolean(row.userId !== null),
        },
      }));
    }
  }
}

/** Read a `text`-kind value, or undefined when the value is absent or a different kind. */
function pulledText(
  values: Readonly<Record<string, MirrorValue>>,
  field: string,
): string | undefined {
  const value = values[field];
  if (value?.kind !== 'text') return undefined;
  return value.value ?? '';
}

/** Read a `date`-kind value as a `Date`, or undefined when the value is absent or a different kind. */
function pulledDate(
  values: Readonly<Record<string, MirrorValue>>,
  field: string,
): Date | null | undefined {
  const value = values[field];
  if (value?.kind !== 'date') return undefined;
  return value.value === null ? null : new Date(value.value);
}

/** Read a `number`-kind value, or undefined when the value is absent or a different kind. */
function pulledNumber(
  values: Readonly<Record<string, MirrorValue>>,
  field: string,
): number | null | undefined {
  const value = values[field];
  if (value?.kind !== 'number') return undefined;
  return value.value;
}

/**
 * Read an `option`-kind value, but only when it exactly matches one of Docket's own enum values.
 *
 * @remarks
 * A Notion select is free text, edited by whoever has access to the page. Docket's `priority`/
 * `status`/`health` columns are not — writing an unrecognized option name would either fail the
 * query or, worse, succeed with a value the rest of the product does not know how to render. An
 * unrecognized option is treated as "not read", the same as an absent property: the column keeps
 * whatever Docket already had, rather than being cleared or corrupted by a rename in Notion.
 */
function pulledEnumOption<T extends string>(
  values: Readonly<Record<string, MirrorValue>>,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const value = values[field];
  if (value?.kind !== 'option' || value.value === null) return undefined;
  return (allowed as readonly string[]).includes(value.value) ? (value.value as T) : undefined;
}

/**
 * Apply Notion-sourced field values onto an existing two-way entity.
 *
 * @remarks
 * Deliberately narrower than the full field catalog {@link loadEntityRows} projects:
 *
 * - **Person fields** (`assignee`/`lead`) are projected as a resolved display name, and reversing
 *   free text into an actor id is a genuinely different, ambiguous problem — two actors can share
 *   a name, a typo matches nobody — that risks silently assigning the wrong person. Worse than not
 *   pulling it at all, so it is left alone.
 * - **`docketUrl`** is derived from the entity's own id, never stored, so there is nothing to pull.
 *
 * `priority`/`status`/`health` ARE applied, but only when the pulled option exactly matches one of
 * Docket's fixed enum values (see {@link pulledEnumOption}) — these are static enums the whole org
 * shares. `task.state` is per-team configurable instead, so it goes through `setTaskState` (the
 * same shared transition `PATCH /tasks/:id/status` uses) rather than a plain column write — that
 * gets `completedAt`/`canceledAt` derivation and event emission for free, and an unrecognized
 * state name (a rename, a typo) is caught and treated the same as "not read", exactly like an
 * unrecognized `priority`/`status`/`health` option.
 *
 * @param orgId - The tenant, for the scoped update.
 * @param actorId - Recorded on the emitted event for a `task.state` transition; unused otherwise.
 * @param entityType - Which entity kind; only `task` and `project` do anything here.
 * @param entityId - The Docket entity to update.
 * @param values - Field values read from Notion, keyed by the catalog's field keys.
 * @returns true when a matching, non-archived entity was found and updated.
 */
export async function applyPulledValues(
  orgId: string,
  actorId: string,
  entityType: NotionMirrorEntity,
  entityId: string,
  values: Readonly<Record<string, MirrorValue>>,
): Promise<boolean> {
  switch (entityType) {
    case 'task':
      return applyPulledTask(orgId, actorId, entityId, values);
    case 'project':
      return applyPulledProject(orgId, entityId, values);
    default:
      // Every other entity is projection-only (`push` direction), so `pullBackEntity` never
      // reaches this with one — see `MIRROR_ENTITY_SPECS[entity].direction` in notion-sync.md §8.6.
      return false;
  }
}

async function applyPulledTask(
  orgId: string,
  actorId: string,
  entityId: string,
  values: Readonly<Record<string, MirrorValue>>,
): Promise<boolean> {
  const title = pulledText(values, 'title');
  const description = pulledText(values, 'description');
  const dueDate = pulledDate(values, 'dueDate');
  const startDate = pulledDate(values, 'startDate');
  const estimateMinutes = pulledNumber(values, 'estimateMinutes');
  const priority = pulledEnumOption(values, 'priority', taskPriority.enumValues);
  const stateValue = values['state'];
  const state =
    stateValue?.kind === 'option' && stateValue.value !== null && stateValue.value.length > 0
      ? stateValue.value
      : undefined;

  const patch = {
    // An emptied Notion title cannot become a blank Docket title (NOT NULL, not-blank CHECK) — it
    // becomes "Untitled", the same substitution the linked-database mode already makes.
    ...(title !== undefined ? { title: title.length > 0 ? title : 'Untitled' } : {}),
    ...(description !== undefined
      ? { description: description.length > 0 ? description : null }
      : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(startDate !== undefined ? { startDate } : {}),
    ...(estimateMinutes !== undefined ? { estimateMinutes } : {}),
    ...(priority !== undefined ? { priority } : {}),
  };
  const where = and(eq(task.id, entityId), eq(task.organizationId, orgId), isNull(task.archivedAt));
  let exists: boolean;
  if (Object.keys(patch).length === 0) {
    // Nothing THIS PATCH applies changed, but the entity's existence still has to be reported
    // honestly — a caller cannot tell "found, nothing to do" from "gone" by return value alone
    // otherwise, and an empty Drizzle `.set({})` is not valid SQL to fall back on instead.
    const rows = await db.select({ id: task.id }).from(task).where(where).limit(1);
    exists = rows.length > 0;
  } else {
    const updated = await db.update(task).set(patch).where(where).returning({ id: task.id });
    exists = updated.length > 0;
  }

  if (exists && state !== undefined) {
    try {
      await setTaskState({ organizationId: orgId, taskId: entityId, state, actorId });
    } catch {
      // The state key does not exist in the team's own workflow — a rename or a typo on the
      // Notion side. Treated as "not read", the same as an unrecognized priority/status/health
      // option: this function's only other documented failure mode for a select property.
    }
  }

  return exists;
}

async function applyPulledProject(
  orgId: string,
  entityId: string,
  values: Readonly<Record<string, MirrorValue>>,
): Promise<boolean> {
  const name = pulledText(values, 'name');
  const summary = pulledText(values, 'summary');
  const targetDate = pulledDate(values, 'targetDate');
  const startDate = pulledDate(values, 'startDate');
  const status = pulledEnumOption(values, 'status', projectStatus.enumValues);
  const projectHealth = pulledEnumOption(values, 'health', health.enumValues);

  const patch = {
    ...(name !== undefined ? { name: name.length > 0 ? name : 'Untitled' } : {}),
    ...(summary !== undefined ? { summary: summary.length > 0 ? summary : null } : {}),
    ...(targetDate !== undefined ? { targetDate } : {}),
    ...(startDate !== undefined ? { startDate } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(projectHealth !== undefined ? { health: projectHealth } : {}),
  };
  const where = and(
    eq(project.id, entityId),
    eq(project.organizationId, orgId),
    isNull(project.archivedAt),
  );
  if (Object.keys(patch).length === 0) {
    const rows = await db.select({ id: project.id }).from(project).where(where).limit(1);
    return rows.length > 0;
  }

  const updated = await db.update(project).set(patch).where(where).returning({ id: project.id });
  return updated.length > 0;
}

/**
 * Create a new Docket entity from a row somebody made directly in Notion, on a two-way entity.
 *
 * @remarks
 * Reuses the exact team-landing answer the linked-database connector already settled on
 * (`resolveImportTeam` — `config.teamId` if configured, otherwise the org's earliest-created
 * team): a Notion-created row lands wherever a Notion-imported task would, which is the
 * consistent answer rather than a new one invented for this mode. A task additionally needs an
 * initial workflow state, resolved from the landing team's own `workflowStates` the same way
 * reconciliation resolves one for a freshly-inserted linked task — never a Notion status value,
 * since interpreting an arbitrary select option as a *starting* state (rather than validating an
 * edit against an existing one, which `applyPulledValues` already declines to do for the same
 * reason) has no more of a principled answer than "the team's own default".
 *
 * @param orgId - The tenant.
 * @param actorId - Recorded as the new entity's `createdBy`.
 * @param integrationRow - The Notion integration, for `resolveImportTeam`'s `config.teamId`.
 * @param entityType - Which entity kind; only `task` and `project` do anything here.
 * @param values - Field values read from Notion, keyed by the catalog's field keys.
 * @returns the new entity's id, or undefined for any entity this function does not create.
 */
export async function adoptEntity(
  orgId: string,
  actorId: string,
  integrationRow: IntegrationRow,
  entityType: NotionMirrorEntity,
  values: Readonly<Record<string, MirrorValue>>,
): Promise<string | undefined> {
  switch (entityType) {
    case 'task':
      return adoptTask(orgId, actorId, integrationRow, values);
    case 'project':
      return adoptProject(orgId, integrationRow, values);
    default:
      // Every other entity is projection-only (`push` direction) — see applyPulledValues's
      // matching default branch and MIRROR_ENTITY_SPECS[entity].direction.
      return undefined;
  }
}

async function adoptTask(
  orgId: string,
  actorId: string,
  integrationRow: IntegrationRow,
  values: Readonly<Record<string, MirrorValue>>,
): Promise<string | undefined> {
  const teamId = await resolveImportTeam(orgId, integrationRow);
  const teamRows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(eq(team.id, teamId))
    .limit(1);
  const openKey = resolveStateKeys(teamRows[0]?.workflowStates ?? []).openKey;

  const title = pulledText(values, 'title');
  const description = pulledText(values, 'description');
  const dueDate = pulledDate(values, 'dueDate');
  const startDate = pulledDate(values, 'startDate');
  const estimateMinutes = pulledNumber(values, 'estimateMinutes');
  const priority = pulledEnumOption(values, 'priority', taskPriority.enumValues);

  const inserted = await db
    .insert(task)
    .values({
      organizationId: orgId,
      teamId,
      // Same "Untitled" substitution as an edit — task.title is NOT NULL with a not-blank CHECK.
      title: title !== undefined && title.length > 0 ? title : 'Untitled',
      description: description !== undefined && description.length > 0 ? description : null,
      state: openKey,
      // Designed-mode provenance lives entirely in `notion_mirror_row`, never these columns — a
      // task can be linked from an existing database and projected into a designed one at once.
      source: 'native',
      createdBy: actorId,
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(startDate !== undefined ? { startDate } : {}),
      ...(estimateMinutes !== undefined ? { estimateMinutes } : {}),
      ...(priority !== undefined ? { priority } : {}),
    })
    .returning({ id: task.id });
  const row = inserted[0];
  if (!row) return undefined;
  await enqueueSearchUpsert(orgId, 'task', row.id);
  return row.id;
}

async function adoptProject(
  orgId: string,
  integrationRow: IntegrationRow,
  values: Readonly<Record<string, MirrorValue>>,
): Promise<string | undefined> {
  // Unlike task.teamId, project.teamId is optional — but resolving the same landing team keeps a
  // Notion-created project discoverable the same way a Notion-created task is, rather than
  // leaving it an org-wide orphan.
  const teamId = await resolveImportTeam(orgId, integrationRow);

  const name = pulledText(values, 'name');
  const summary = pulledText(values, 'summary');
  const targetDate = pulledDate(values, 'targetDate');
  const startDate = pulledDate(values, 'startDate');
  const status = pulledEnumOption(values, 'status', projectStatus.enumValues);
  const projectHealth = pulledEnumOption(values, 'health', health.enumValues);

  const inserted = await db
    .insert(project)
    .values({
      organizationId: orgId,
      teamId,
      name: name !== undefined && name.length > 0 ? name : 'Untitled',
      summary: summary !== undefined && summary.length > 0 ? summary : null,
      ...(targetDate !== undefined ? { targetDate } : {}),
      ...(startDate !== undefined ? { startDate } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(projectHealth !== undefined ? { health: projectHealth } : {}),
    })
    .returning({ id: project.id });
  const row = inserted[0];
  if (!row) return undefined;
  await enqueueSearchUpsert(orgId, 'project', row.id);
  return row.id;
}
