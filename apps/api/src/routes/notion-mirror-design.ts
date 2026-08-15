/**
 * `@docket/api` — the Notion mirror's design layer: seeding, previews, and saves.
 *
 * @remarks
 * Everything the table designer reads and writes, with no provider I/O at all. Provisioning and
 * syncing are separate concerns (`notion-mirror-reconcile.ts`) so that shaping a database never
 * depends on Notion being reachable — a user can design, review and adjust while the connection
 * is down, and only the act of creating the databases needs the network.
 *
 * The preview is filled from the org's **real** rows wherever there are any. That is the whole
 * point of the surface: you are looking at your own work in the shape it will take, not at a
 * schema diagram. When an entity has no rows yet the preview falls back to illustrative ones and
 * says so, because a designer that quietly shows invented data teaches you to distrust every
 * number on the page.
 *
 * @see `docs/engineering/specs/notion-sync.md`
 */
import {
  actor,
  cycle,
  db,
  initiative,
  label,
  milestone,
  notionMirrorDatabase,
  organization,
  program,
  project,
  task,
  team,
} from '@docket/db';
import type {
  NotionColumnBinding,
  NotionMirrorDatabaseOut,
  NotionMirrorDesignOut,
  NotionMirrorDesignPatch,
  NotionMirrorEntity,
  NotionMirrorFieldOut,
  NotionMirrorPreviewRow,
  NotionPropertyMap,
} from '@docket/connections/notion/mirror-contract';
import type { VocabularySkin } from '@docket/work/vocabulary';
import {
  MIRROR_ENTITY_ORDER,
  MIRROR_ENTITY_SPECS,
  defaultColumnTitle,
  defaultDatabaseTitle,
  defaultPropertyMap,
  personCompanionKey,
  provisionedKind,
} from '@docket/connections/notion/mirror-schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../error';

/** How many rows the designer preview shows. Enough to see the shape, cheap enough to be instant. */
const PREVIEW_LIMIT = 3;

/** One row of the mirror-database table. */
export type MirrorDatabaseRow = typeof notionMirrorDatabase.$inferSelect;

/** Serialize a mirror-database row to its DTO. */
export function toMirrorDatabaseOut(row: MirrorDatabaseRow): NotionMirrorDatabaseOut {
  return {
    id: row.id,
    entityType: row.entityType,
    title: row.title,
    enabled: row.enabled,
    direction: MIRROR_ENTITY_SPECS[row.entityType].direction,
    propertyMap: row.propertyMap,
    externalDatabaseId: row.externalDatabaseId,
    externalDataSourceId: row.externalDataSourceId,
    externalUrl: row.externalUrl,
    rowCount: row.rowCount,
    provisionedAt: row.provisionedAt?.toISOString() ?? null,
    lastPushedAt: row.lastPushedAt?.toISOString() ?? null,
    lastPulledAt: row.lastPulledAt?.toISOString() ?? null,
  };
}

/** Read the org's vocabulary skin, so designed titles use the org's own words. */
async function orgVocabulary(orgId: string): Promise<VocabularySkin | null> {
  const rows = await db
    .select({ vocabulary: organization.vocabulary })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  return rows[0]?.vocabulary ?? null;
}

/**
 * Ensure every entity has a design row, creating the missing ones from the catalog defaults.
 *
 * @remarks
 * Idempotent and safe to call on every read: a workspace that connected Notion before a new
 * entity kind existed gets the new one seeded on its next visit rather than silently missing it.
 * Seeding writes **no** `external*` columns, so a seeded row makes no claim that anything exists
 * in Notion — only `provisionedAt` does that.
 *
 * @param orgId - The tenant.
 * @param integrationId - The Notion integration these designs belong to.
 * @param actorId - The human seeding them, for `createdBy`.
 * @returns every design row for the integration, in designer order.
 */
export async function ensureDesigns(
  orgId: string,
  integrationId: string,
  actorId: string,
): Promise<MirrorDatabaseRow[]> {
  const skin = await orgVocabulary(orgId);
  const existing = await db
    .select()
    .from(notionMirrorDatabase)
    .where(
      and(
        eq(notionMirrorDatabase.organizationId, orgId),
        eq(notionMirrorDatabase.integrationId, integrationId),
        isNull(notionMirrorDatabase.archivedAt),
      ),
    );
  const have = new Set(existing.map((row) => row.entityType));
  const missing = MIRROR_ENTITY_ORDER.filter((entity) => !have.has(entity));

  if (missing.length > 0) {
    await db
      .insert(notionMirrorDatabase)
      .values(
        missing.map((entity) => ({
          organizationId: orgId,
          integrationId,
          createdBy: actorId,
          entityType: entity,
          title: defaultDatabaseTitle(entity, skin),
          propertyMap: defaultPropertyMap(entity, skin),
        })),
      )
      // A concurrent first visit from two tabs would otherwise collide on the uniqueness of
      // (integration, entity); the row either side wins is identical, so neither needs to lose.
      .onConflictDoNothing({
        target: [notionMirrorDatabase.integrationId, notionMirrorDatabase.entityType],
      });
  }

  const rows = await db
    .select()
    .from(notionMirrorDatabase)
    .where(
      and(
        eq(notionMirrorDatabase.organizationId, orgId),
        eq(notionMirrorDatabase.integrationId, integrationId),
        isNull(notionMirrorDatabase.archivedAt),
      ),
    );
  const order = new Map(MIRROR_ENTITY_ORDER.map((entity, index) => [entity, index]));
  return rows.sort((a, b) => (order.get(a.entityType) ?? 0) - (order.get(b.entityType) ?? 0));
}

/** Load one design row or 404 (existence-hiding across tenants). */
export async function loadDesign(
  orgId: string,
  integrationId: string,
  entity: NotionMirrorEntity,
): Promise<MirrorDatabaseRow> {
  const rows = await db
    .select()
    .from(notionMirrorDatabase)
    .where(
      and(
        eq(notionMirrorDatabase.organizationId, orgId),
        eq(notionMirrorDatabase.integrationId, integrationId),
        eq(notionMirrorDatabase.entityType, entity),
        isNull(notionMirrorDatabase.archivedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Notion database design not found');
  return row;
}

/**
 * The fields an entity can expose, with titles resolved through the org vocabulary.
 *
 * @remarks
 * Derived companion columns are excluded. They are not a choice — they exist because a person
 * column was set to `notion_person`, and offering one on its own would let somebody add a native
 * Notion person column with nothing feeding it.
 *
 * @param entity - The entity kind.
 * @param skin - The org's vocabulary skin.
 * @returns the designer's field palette.
 */
export function availableFields(
  entity: NotionMirrorEntity,
  skin: VocabularySkin | null,
): NotionMirrorFieldOut[] {
  return MIRROR_ENTITY_SPECS[entity].fields
    .filter((field) => field.personCompanionOf === undefined)
    .map((field) => ({
      field: field.field,
      label: defaultColumnTitle(entity, field.field, skin) ?? field.label,
      kind: field.kind,
      personValued: field.personValued === true,
      required: field.required === true,
    }));
}

/**
 * The representation a column was last saved with.
 *
 * @param row - The stored design.
 * @param field - The field key.
 * @returns the stored representation, or undefined when the column is new.
 */
function previousRepresentation(
  row: MirrorDatabaseRow,
  field: string,
): NotionColumnBinding['representation'] {
  return row.propertyMap[field]?.representation;
}

/**
 * Apply a designer save.
 *
 * @remarks
 * `columns` is a wholesale replace, so the saved order is the column order. Two rules are
 * enforced rather than trusted:
 *
 * 1. The required title column cannot be dropped. Notion requires exactly one title property, and
 *    a design without it is one that can never be provisioned — better rejected at save time,
 *    while the user is looking at the designer, than at provision time with no context.
 * 2. A column must name a field the entity actually has, so a stale client cannot persist a
 *    binding the sync engine has no way to fill.
 *
 * Provisioned columns keep their `propertyId`: a rename in the designer changes the title Docket
 * will push, never the identity it binds to. That is what makes renaming safe on either side.
 *
 * @param row - The current design row.
 * @param patch - The requested change.
 * @returns the updated row.
 * @throws {ConflictError} When the title column is missing or a field is unknown.
 */
export async function applyDesignPatch(
  row: MirrorDatabaseRow,
  patch: NotionMirrorDesignPatch,
): Promise<MirrorDatabaseRow> {
  const spec = MIRROR_ENTITY_SPECS[row.entityType];
  const update: Partial<typeof notionMirrorDatabase.$inferInsert> = {};

  if (patch.title !== undefined) update.title = patch.title;
  if (patch.enabled !== undefined) update.enabled = patch.enabled;

  if (patch.columns !== undefined) {
    const required = spec.fields.find((f) => f.required === true);
    const chosen = new Set(patch.columns.map((c) => c.field));
    if (required && !chosen.has(required.field)) {
      throw new ConflictError(
        `The ${required.label} column cannot be removed — Notion requires one title column.`,
      );
    }
    // Companions are derived from their parent's representation, so a client echoing back the map
    // it was given — which is exactly what the designer does — must have them dropped BEFORE
    // anything else looks at the list. Leaving them in made the regenerated companion collide with
    // its own echo in the title check below, so the second save of any `notion_person` column
    // 409'd and the table could never be edited again.
    const authored = patch.columns.filter((column) => {
      const field = spec.fields.find((f) => f.field === column.field);
      if (!field) throw new ConflictError(`Unknown column "${column.field}".`);
      return field.personCompanionOf === undefined;
    });

    // Notion keys a database's schema by property NAME, so two columns sharing a title collapse
    // into one property — the second silently replacing the first, and both Docket fields then
    // binding to the same property id. The designer lets titles be edited freely, so this is one
    // ordinary rename away; refuse it here rather than lose a column on provision.
    //
    // Derived companions are checked against this same set as they are generated below, so a user
    // column that happens to be called "Assignee (Notion)" collides here rather than at provision.
    const seenTitles = new Map<string, string>();
    for (const column of authored) {
      const key = column.title.trim().toLowerCase();
      const claimed = seenTitles.get(key);
      if (claimed !== undefined) {
        throw new ConflictError(
          `Two columns are both called "${column.title.trim()}". Notion needs each column to have its own name.`,
        );
      }
      seenTitles.set(key, column.field);
    }

    const next: Record<string, NotionColumnBinding> = {};
    let order = 0;
    for (const column of authored) {
      const field = spec.fields.find((f) => f.field === column.field);
      /* v8 ignore next -- @preserve defensive: `authored` already threw on an unknown column. */
      if (!field) throw new ConflictError(`Unknown column "${column.field}".`);

      const representation =
        field.personValued === true
          ? (column.representation ?? previousRepresentation(row, column.field) ?? 'text')
          : undefined;
      // Docket owns no page ids in a database it did not create, so there is nothing it could
      // write into a relation pointing at one — matching names against a foreign table is the same
      // ambiguity the pull path already refuses. Refused here rather than accepted and silently
      // left blank, which is what happened before.
      if (representation === 'existing_table') {
        throw new ConflictError(
          `Linking ${field.label} to a database you already keep isn’t available yet. Use a name, a Notion person, or Docket’s own People database.`,
        );
      }

      const previous = row.propertyMap[column.field];
      const binding: NotionColumnBinding = {
        field: column.field,
        title: column.title.trim().length > 0 ? column.title.trim() : field.label,
        kind: field.kind,
        // The array's index IS the column order. Stored explicitly because `property_map` is
        // jsonb and PostgreSQL normalizes object key order, so the order columns were written in
        // is gone by the first read back.
        order: order++,
        // Carried over so a rename never re-binds: the id is the identity, the title is a label.
        ...(previous?.propertyId !== undefined ? { propertyId: previous.propertyId } : {}),
        ...(representation !== undefined ? { representation } : {}),
        ...(column.relationDataSourceId !== undefined
          ? { relationDataSourceId: column.relationDataSourceId }
          : previous?.relationDataSourceId !== undefined
            ? { relationDataSourceId: previous.relationDataSourceId }
            : {}),
      };
      // A person column rendered as a relation must resolve its target before provisioning; the
      // provisioner fills it in for the Docket People table, so an unresolved one here is simply
      // left for provisioning to complete.
      next[column.field] = binding;

      // The native-Notion companion, added BESIDE the column rather than replacing it. Notion's
      // people property cannot hold anyone outside the workspace, so substituting it would drop
      // every person without a Notion account from the database entirely.
      if (representation === 'notion_person') {
        const companionField = personCompanionKey(column.field);
        const companionPrevious = row.propertyMap[companionField];
        const companionTitle = `${binding.title} (Notion)`;
        const claimed = seenTitles.get(companionTitle.trim().toLowerCase());
        if (claimed !== undefined) {
          throw new ConflictError(
            `Adding a Notion account column for ${binding.title} needs the name "${companionTitle}", which another column already uses.`,
          );
        }
        seenTitles.set(companionTitle.trim().toLowerCase(), companionField);
        next[companionField] = {
          field: companionField,
          title: companionTitle,
          kind: 'people',
          order: order++,
          ...(companionPrevious?.propertyId !== undefined
            ? { propertyId: companionPrevious.propertyId }
            : {}),
        };
      }
    }
    update.propertyMap = next;
    // Bumped so the sync engine knows the shape in Notion is behind the design.
    update.schemaVersion = row.schemaVersion + 1;
  }

  if (Object.keys(update).length === 0) return row;
  const updated = await db
    .update(notionMirrorDatabase)
    .set(update)
    .where(eq(notionMirrorDatabase.id, row.id))
    .returning();
  const next = updated[0];
  /* v8 ignore next -- @preserve defensive: the row was loaded in this same request. */
  if (!next) throw new NotFoundError('Notion database design not found');
  return next;
}

/** One preview row plus the counts that describe the whole projection. */
export interface PreviewResult {
  readonly rows: NotionMirrorPreviewRow[];
  readonly sample: boolean;
  readonly totalRows: number;
  readonly excludedRows: number;
}

/**
 * Format a date column the way Notion renders it, so the preview does not lie about width.
 *
 * @param value - A stored date, provider date string, or absent value.
 * @returns The ISO calendar date, or null when the value is absent or invalid.
 */
export function formatDate(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Build the designer preview for one entity from the org's real rows.
 *
 * @remarks
 * The excluded count is the honest part. Tasks already linked to a database on this same
 * integration are withheld from the projection, because projecting them would put the same work
 * in the same Notion workspace twice. Reporting how many are withheld is what stops the row count
 * from looking like data loss.
 *
 * @param orgId - The tenant.
 * @param integrationId - The Notion integration, for the exclusion rule.
 * @param row - The design being previewed.
 * @returns real rows where they exist, illustrative rows where they do not.
 */
export async function buildPreview(
  orgId: string,
  integrationId: string,
  row: MirrorDatabaseRow,
): Promise<PreviewResult> {
  const fields = Object.keys(row.propertyMap);
  const entity = row.entityType;

  const counted = await countAndSample(orgId, integrationId, entity);
  if (counted.rows.length === 0) {
    return {
      rows: sampleRows(entity, fields),
      sample: true,
      totalRows: 0,
      excludedRows: counted.excluded,
    };
  }
  return {
    rows: counted.rows.map((record) => ({
      cells: Object.fromEntries(fields.map((field) => [field, cellFor(entity, field, record)])),
    })),
    sample: false,
    totalRows: counted.total,
    excludedRows: counted.excluded,
  };
}

/**
 * A read row, seen through one shape for formatting.
 *
 * @remarks
 * The preview formats nine different row types into strings, and the alternative to one loose
 * shape is nine near-identical formatters. `cellFor` reads only known keys and returns null for
 * anything it does not recognise, so a missing column is a blank cell rather than a crash.
 */
type EntityRecord = Record<string, unknown>;

/**
 * Count the projectable rows for an entity and read a preview page of them.
 *
 * @remarks
 * Written out per entity rather than behind one generic helper: Drizzle's table generics do not
 * survive that abstraction without an `any`, and an `any` here would silently defeat the
 * org-scoping the whole query exists to enforce.
 */
async function countAndSample(
  orgId: string,
  integrationId: string,
  entity: NotionMirrorEntity,
): Promise<{ rows: EntityRecord[]; total: number; excluded: number }> {
  switch (entity) {
    case 'task': {
      // Tasks already linked to a database on THIS integration are excluded: they exist in this
      // Notion workspace already, and projecting them would duplicate the same work.
      const excludedRows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(task)
        .where(
          and(
            eq(task.organizationId, orgId),
            isNull(task.archivedAt),
            eq(task.sourceIntegrationId, integrationId),
          ),
        );
      const where = and(
        eq(task.organizationId, orgId),
        isNull(task.archivedAt),
        sql`(${task.sourceIntegrationId} is distinct from ${integrationId})`,
      );
      const total = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(task)
        .where(where);
      const rows = await db
        .select()
        .from(task)
        .where(where)
        .orderBy(desc(task.updatedAt))
        .limit(PREVIEW_LIMIT);
      return { rows, total: total[0]?.n ?? 0, excluded: excludedRows[0]?.n ?? 0 };
    }
    case 'project': {
      const where = and(eq(project.organizationId, orgId), isNull(project.archivedAt));
      const total = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(project)
        .where(where);
      const rows = await db.select().from(project).where(where).limit(PREVIEW_LIMIT);
      return { rows, total: total[0]?.n ?? 0, excluded: 0 };
    }
    case 'initiative': {
      const where = and(eq(initiative.organizationId, orgId), isNull(initiative.archivedAt));
      const total = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(initiative)
        .where(where);
      const rows = await db.select().from(initiative).where(where).limit(PREVIEW_LIMIT);
      return { rows, total: total[0]?.n ?? 0, excluded: 0 };
    }
    case 'program': {
      const where = and(eq(program.organizationId, orgId), isNull(program.archivedAt));
      const total = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(program)
        .where(where);
      const rows = await db.select().from(program).where(where).limit(PREVIEW_LIMIT);
      return { rows, total: total[0]?.n ?? 0, excluded: 0 };
    }
    case 'team': {
      const where = and(eq(team.organizationId, orgId), isNull(team.archivedAt));
      const total = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(team)
        .where(where);
      const rows = await db.select().from(team).where(where).limit(PREVIEW_LIMIT);
      return { rows, total: total[0]?.n ?? 0, excluded: 0 };
    }
    case 'cycle': {
      const where = and(eq(cycle.organizationId, orgId), isNull(cycle.archivedAt));
      const total = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(cycle)
        .where(where);
      const rows = await db.select().from(cycle).where(where).limit(PREVIEW_LIMIT);
      return { rows, total: total[0]?.n ?? 0, excluded: 0 };
    }
    case 'milestone': {
      const where = and(eq(milestone.organizationId, orgId), isNull(milestone.archivedAt));
      const total = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(milestone)
        .where(where);
      const rows = await db.select().from(milestone).where(where).limit(PREVIEW_LIMIT);
      return { rows, total: total[0]?.n ?? 0, excluded: 0 };
    }
    case 'label': {
      // The one projected table with no soft-delete column.
      const where = eq(label.organizationId, orgId);
      const total = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(label)
        .where(where);
      const rows = await db.select().from(label).where(where).limit(PREVIEW_LIMIT);
      return { rows, total: total[0]?.n ?? 0, excluded: 0 };
    }
    case 'person': {
      // Humans only. Agent and team actors are assignable in Docket but are not people, and a
      // People database listing them would misrepresent the roster.
      const where = and(
        eq(actor.organizationId, orgId),
        eq(actor.kind, 'human'),
        isNull(actor.archivedAt),
      );
      const total = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(actor)
        .where(where);
      const rows = await db.select().from(actor).where(where).limit(PREVIEW_LIMIT);
      return { rows, total: total[0]?.n ?? 0, excluded: 0 };
    }
  }
}

/**
 * Map one Docket field of one record to the string the preview cell shows.
 *
 * @param entity - The record's entity kind, retained for the formatter boundary.
 * @param field - The designed field to render.
 * @param record - The database record behind the preview row.
 * @returns The compact Notion-like cell text, or null for an empty/unresolved value.
 */
export function cellFor(
  entity: NotionMirrorEntity,
  field: string,
  record: EntityRecord,
): string | null {
  const direct = record[field];
  if (typeof direct === 'string') return direct;
  if (typeof direct === 'number') return String(direct);
  if (typeof direct === 'boolean') return direct ? 'Yes' : 'No';
  if (direct instanceof Date) return formatDate(direct);

  switch (field) {
    case 'title':
    case 'name':
    case 'displayName':
      return (record['title'] ?? record['name'] ?? record['displayName']) as string | null;
    case 'jobTitle':
      return (record['title'] as string | null) ?? null;
    case 'hasDocketAccount':
      return record['userId'] ? 'Yes' : 'No';
    case 'dueDate':
    case 'startDate':
    case 'targetDate':
    case 'startsAt':
    case 'endsAt':
      return formatDate(record[field] as Date | string | null);
    case 'docketUrl':
      return null;
    default:
      // A relation or person column has no scalar to show until the projection resolves it; an
      // empty cell is the truthful preview rather than an invented placeholder.
      return null;
  }
}

/** Illustrative rows for an entity the workspace has none of yet. */
function sampleRows(
  entity: NotionMirrorEntity,
  fields: readonly string[],
): NotionMirrorPreviewRow[] {
  const samples = SAMPLE_VALUES[entity];
  return samples.map((sample) => ({
    cells: Object.fromEntries(fields.map((field) => [field, sample[field] ?? null])),
  }));
}

/**
 * Illustrative values, used only when an entity has no real rows.
 *
 * @remarks
 * Kept plainly generic on purpose. The UI labels these as samples, and inventing realistic-looking
 * names or dates would make the label easy to miss.
 */
const SAMPLE_VALUES: Record<NotionMirrorEntity, readonly Record<string, string>[]> = {
  task: [
    { title: 'First task', state: 'To do', dueDate: '2026-01-15', priority: 'Medium' },
    { title: 'Second task', state: 'In progress', dueDate: '2026-01-22', priority: 'High' },
  ],
  project: [
    { name: 'First project', status: 'Active', health: 'On track', targetDate: '2026-03-01' },
  ],
  initiative: [{ name: 'First initiative', status: 'Active', health: 'On track' }],
  program: [{ name: 'First program', status: 'Active', health: 'On track' }],
  team: [{ name: 'First team', key: 'TEAM' }],
  cycle: [{ name: 'Cycle 1', number: '1', status: 'Active' }],
  milestone: [{ name: 'First milestone', targetDate: '2026-02-01' }],
  label: [{ name: 'First label', color: 'blue' }],
  person: [{ displayName: 'First person', email: 'person@example.com', hasDocketAccount: 'Yes' }],
};

/**
 * Assemble the full designer payload for one entity.
 *
 * @param orgId - The tenant.
 * @param integrationId - The Notion integration.
 * @param entity - The entity being designed.
 * @returns the design, its field palette, and a preview.
 */
export async function buildDesignOut(
  orgId: string,
  integrationId: string,
  entity: NotionMirrorEntity,
): Promise<NotionMirrorDesignOut> {
  const row = await loadDesign(orgId, integrationId, entity);
  const skin = await orgVocabulary(orgId);
  const preview = await buildPreview(orgId, integrationId, row);
  return {
    database: toMirrorDatabaseOut(row),
    availableFields: availableFields(entity, skin),
    rows: preview.rows,
    sample: preview.sample,
    totalRows: preview.totalRows,
    excludedRows: preview.excludedRows,
  };
}

/** Re-exported so the provisioner resolves a binding's Notion type through one implementation. */
export { provisionedKind };
export type { NotionPropertyMap };
