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
  initiative,
  label,
  milestone,
  program,
  project,
  task,
  team,
} from '@docket/db';
import type { NotionMirrorEntity } from '@docket/types';
import type { MirrorValue } from '@docket/integrations';
import { and, eq, isNull, sql } from 'drizzle-orm';

/** One Docket record, ready to project. */
export interface MirrorEntityRecord {
  /** The Docket entity's id. */
  readonly entityId: string;
  /** Its values, keyed by the catalog's field keys. */
  readonly values: Readonly<Record<string, MirrorValue>>;
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
 * Person-valued fields resolve to the actor's display name, which is the `text` representation.
 * The other three representations (native Notion person, or a relation to a People table) need the
 * external-actor mapping and the People database's own page ids, so they are resolved by the
 * reconciler once those exist rather than guessed here.
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
  const nameOf = (id: string | null): MirrorValue => text(id === null ? null : names.get(id));

  switch (entity) {
    case 'task': {
      const rows = await db
        .select()
        .from(task)
        .where(
          and(
            eq(task.organizationId, orgId),
            isNull(task.archivedAt),
            // Already mirrored into this Notion workspace by the linked-database connector.
            sql`(${task.sourceIntegrationId} is distinct from ${integrationId})`,
          ),
        );
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          title: text(row.title),
          state: option(row.state),
          assignee: nameOf(row.assigneeId),
          dueDate: date(row.dueDate),
          startDate: date(row.startDate),
          priority: option(row.priority),
          estimateMinutes: number(row.estimateMinutes),
          description: text(row.description),
          docketUrl: docketUrl(orgId, `tasks/${row.id}`),
        },
      }));
    }
    case 'project': {
      const rows = await db
        .select()
        .from(project)
        .where(and(eq(project.organizationId, orgId), isNull(project.archivedAt)));
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          name: text(row.name),
          status: option(row.status),
          health: option(row.health),
          lead: nameOf(row.leadId),
          targetDate: date(row.targetDate),
          startDate: date(row.startDate),
          summary: text(row.summary),
          docketUrl: docketUrl(orgId, `projects/${row.id}`),
        },
      }));
    }
    case 'initiative': {
      const rows = await db
        .select()
        .from(initiative)
        .where(and(eq(initiative.organizationId, orgId), isNull(initiative.archivedAt)));
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          name: text(row.name),
          status: option(row.status),
          health: option(row.health),
          priority: option(row.priority),
          owner: nameOf(row.ownerId),
          targetDate: date(row.targetDate),
          updateCadence: option(row.updateCadence),
          summary: text(row.summary),
          docketUrl: docketUrl(orgId, `initiatives/${row.id}`),
        },
      }));
    }
    case 'program': {
      const rows = await db
        .select()
        .from(program)
        .where(and(eq(program.organizationId, orgId), isNull(program.archivedAt)));
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          name: text(row.name),
          status: option(row.status),
          health: option(row.health),
          owner: nameOf(row.ownerId),
          summary: text(row.summary),
          docketUrl: docketUrl(orgId, `programs/${row.id}`),
        },
      }));
    }
    case 'team': {
      const rows = await db
        .select()
        .from(team)
        .where(and(eq(team.organizationId, orgId), isNull(team.archivedAt)));
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          name: text(row.name),
          key: text(row.key),
          summary: text(row.summary),
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
          docketUrl: docketUrl(orgId, `projects/${row.projectId}`),
        },
      }));
    }
    case 'label': {
      const rows = await db.select().from(label).where(eq(label.organizationId, orgId));
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          name: text(row.name),
          color: option(row.color),
          group: option(row.group),
        },
      }));
    }
    case 'person': {
      // Humans only. Agent and team actors are assignable in Docket but are not people, and a
      // People database listing them would misrepresent the roster.
      const rows = await db
        .select()
        .from(actor)
        .where(
          and(eq(actor.organizationId, orgId), eq(actor.kind, 'human'), isNull(actor.archivedAt)),
        );
      return rows.map((row) => ({
        entityId: row.id,
        values: {
          displayName: text(row.displayName),
          jobTitle: text(row.title),
          // `user_id` is what distinguishes a person with an account from one without — the
          // account-less actors this whole feature exists to keep first-class.
          hasDocketAccount: boolean(row.userId !== null),
        },
      }));
    }
  }
}
