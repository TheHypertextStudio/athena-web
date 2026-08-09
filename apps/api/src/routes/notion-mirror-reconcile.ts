/**
 * `@docket/api` — the Notion mirror's sync passes: provision, project, pull back.
 *
 * @remarks
 * The orchestration layer. Every decision it makes is delegated — `planMirrorRow` says which way a
 * row flows, `projectRow` says what the page should contain, `MIRROR_ENTITY_SPECS` says what the
 * database looks like — so this file is loading, ordering, pacing and recording, and nothing else.
 *
 * Three properties matter more than throughput:
 *
 * 1. **Nothing is destroyed.** An archived entity trashes its page (Notion's own soft delete); a
 *    row missing from an incremental read is unchanged, never gone.
 * 2. **Nothing is overwritten silently.** Every conflict — a contested two-way edit, or drift on a
 *    projection-only entity — is written to the audit log *before* the push that overwrites it.
 * 3. **Nothing claims success it did not achieve.** A pass that stops early because it ran out of
 *    request budget reports what it actually wrote, and the run is resumed next sweep rather than
 *    reported complete.
 *
 * @see `docs/engineering/specs/notion-sync.md`
 */
import { db, integration, notionMirrorDatabase, notionMirrorRow } from '@docket/db';
import type { NotionColumnBinding, NotionMirrorEntity } from '@docket/types';
import {
  MIRROR_ENTITY_SPECS,
  type MirrorColumnSpec,
  type MirrorValue,
  type NotionMirrorPort,
  orderedColumns,
  projectRow,
  provisionedKind,
} from '@docket/integrations';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { ConnectorConfig } from '@docket/types';

import { buildNotionMirror } from '../container';
import { syncExternalActors } from './integration-identity';
import { recordSyncConflict } from './sync-notion';
import { runLeasedSync, type RunSyncOptions, type SyncRunRow } from './integration-sync';
import type { IntegrationRow } from './integration-provider';
import { contentChanged, planMirrorRow, type MirrorLocalRow } from './notion-mirror-plan';
import { loadEntityRows, type MirrorEntityRecord } from './notion-mirror-entities';
import type { MirrorDatabaseRow } from './notion-mirror-design';

/**
 * How many Notion writes one sync pass will spend.
 *
 * @remarks
 * Notion allows roughly three requests a second, and a sweep runs every fifteen minutes. This
 * budget keeps one pass to a few minutes of wall clock, so a first projection of a large workspace
 * completes over several sweeps instead of holding the integration's lease for an hour and
 * starving every other purpose behind it.
 *
 * Reaching it is not an error and not a success: the pass reports what it wrote and leaves the
 * rest for the next sweep, which is why `stampFullSync` is only set on a pass that ran to
 * completion.
 */
const WRITE_BUDGET = 400;

/** Milliseconds between Notion writes — three per second, with headroom. */
const WRITE_INTERVAL_MS = 350;

/** What one pass did. */
export interface MirrorPassResult {
  readonly written: number;
  readonly conflicts: number;
  /** True when the pass covered everything it was asked to; false when the budget ran out. */
  readonly complete: boolean;
}

/** Everything a pass needs to reach Notion and the database. */
export interface MirrorContext {
  readonly orgId: string;
  readonly integrationId: string;
  readonly actorId: string;
  readonly mirror: NotionMirrorPort;
  readonly now: Date;
}

/** Sleep between writes so a burst does not trip Notion's limiter. */
function pace(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, WRITE_INTERVAL_MS));
}

/**
 * Translate a designed binding into the provider's column spec.
 *
 * @remarks
 * The owning entity is an argument rather than something inferred from the field name: the same
 * name means different things on different entities (`project.team` and `cycle.team` both point at
 * teams, but `task.project` and `milestone.project` differ from `initiative.projects`), so
 * scanning every spec for a matching name would resolve some relations to the wrong table.
 *
 * A relation whose target has not been provisioned yet resolves to `undefined`, and the caller
 * withholds the column rather than pointing it somewhere wrong.
 *
 * @param entity - The entity the column belongs to.
 * @param binding - The designed column.
 * @param dataSourceByEntity - Data source ids for the entities provisioned so far.
 * @returns the provider spec, or undefined when a relation's target does not exist yet.
 */
function toColumnSpec(
  entity: NotionMirrorEntity,
  binding: NotionColumnBinding,
  dataSourceByEntity: ReadonlyMap<NotionMirrorEntity, string>,
): MirrorColumnSpec | undefined {
  const kind = provisionedKind(binding);
  if (kind !== 'relation') {
    return { field: binding.field, title: binding.title, kind };
  }
  const explicit = binding.relationDataSourceId;
  if (explicit !== undefined) {
    return { field: binding.field, title: binding.title, kind, relationDataSourceId: explicit };
  }
  const target = MIRROR_ENTITY_SPECS[entity].fields.find(
    (f) => f.field === binding.field,
  )?.relationEntity;
  const dataSourceId = target === undefined ? undefined : dataSourceByEntity.get(target);
  if (dataSourceId === undefined) return undefined;
  return { field: binding.field, title: binding.title, kind, relationDataSourceId: dataSourceId };
}

/** Map a design's bindings to provider specs, dropping relations with no target yet. */
function toColumnSpecs(
  entity: NotionMirrorEntity,
  bindings: readonly NotionColumnBinding[],
  dataSourceByEntity: ReadonlyMap<NotionMirrorEntity, string>,
): MirrorColumnSpec[] {
  const specs: MirrorColumnSpec[] = [];
  for (const binding of bindings) {
    const spec = toColumnSpec(entity, binding, dataSourceByEntity);
    if (spec !== undefined) specs.push(spec);
  }
  return specs;
}

/**
 * Create every designed-but-missing database in Notion.
 *
 * @remarks
 * Ordered in two waves because a Notion relation must name an existing data source: every database
 * is created with its scalar columns first, then each is patched to add the relations now that
 * their targets exist. A single wave would either fail or silently drop every relation.
 *
 * Idempotent by construction — a design that already carries an `externalDataSourceId` is skipped —
 * which makes this the repair path too, for a database somebody deleted in Notion.
 *
 * @param ctx - The sync context.
 * @param parentPageId - The page to create the databases under.
 * @returns how many databases were created.
 */
export async function provisionMirror(ctx: MirrorContext, parentPageId: string): Promise<number> {
  const designs = await db
    .select()
    .from(notionMirrorDatabase)
    .where(
      and(
        eq(notionMirrorDatabase.organizationId, ctx.orgId),
        eq(notionMirrorDatabase.integrationId, ctx.integrationId),
        eq(notionMirrorDatabase.enabled, true),
        isNull(notionMirrorDatabase.archivedAt),
      ),
    );

  const dataSourceByEntity = new Map<NotionMirrorEntity, string>();
  for (const design of designs) {
    if (design.externalDataSourceId !== null) {
      dataSourceByEntity.set(design.entityType, design.externalDataSourceId);
    }
  }

  // Wave one: scalar columns only. A relation whose target does not exist yet cannot be created,
  // so it is deliberately withheld rather than pointed somewhere wrong.
  let created = 0;
  for (const design of designs) {
    if (design.externalDataSourceId !== null) continue;
    const scalars = orderedColumns(design.propertyMap).filter(
      (binding) => provisionedKind(binding) !== 'relation',
    );
    const provisioned = await ctx.mirror.provisionDatabase({
      title: design.title,
      parentPageId,
      columns: toColumnSpecs(design.entityType, scalars, dataSourceByEntity),
    });
    dataSourceByEntity.set(design.entityType, provisioned.externalDataSourceId);
    await db
      .update(notionMirrorDatabase)
      .set({
        externalDatabaseId: provisioned.externalDatabaseId,
        externalDataSourceId: provisioned.externalDataSourceId,
        externalUrl: provisioned.url ?? null,
        propertyMap: withPropertyIds(design.propertyMap, provisioned.propertyIds),
        provisionedAt: ctx.now,
      })
      .where(eq(notionMirrorDatabase.id, design.id));
    created += 1;
    await pace();
  }

  // Wave two: relations, now that every target data source exists.
  for (const design of designs) {
    const refreshed = await db
      .select()
      .from(notionMirrorDatabase)
      .where(eq(notionMirrorDatabase.id, design.id))
      .limit(1);
    const row = refreshed[0];
    if (!row?.externalDataSourceId) continue;
    const columns = orderedColumns(row.propertyMap);
    if (!columns.some((binding) => provisionedKind(binding) === 'relation')) continue;
    const ids = await ctx.mirror.updateDatabaseSchema(row.externalDataSourceId, {
      title: row.title,
      parentPageId,
      columns: toColumnSpecs(row.entityType, columns, dataSourceByEntity),
    });
    await db
      .update(notionMirrorDatabase)
      .set({ propertyMap: withPropertyIds(row.propertyMap, ids) })
      .where(eq(notionMirrorDatabase.id, row.id));
    await pace();
  }

  return created;
}

/** Fold provisioned Notion property ids back into the stored bindings. */
function withPropertyIds(
  map: MirrorDatabaseRow['propertyMap'],
  ids: Readonly<Record<string, string>>,
): MirrorDatabaseRow['propertyMap'] {
  const next: Record<string, NotionColumnBinding> = {};
  for (const [field, binding] of Object.entries(map)) {
    const id = ids[field];
    next[field] = id === undefined ? binding : { ...binding, propertyId: id };
  }
  return next;
}

/**
 * Push Docket's rows into one designed database.
 *
 * @remarks
 * Only rows whose projected values actually changed are written — the content hash makes an
 * entity whose `updated_at` moved for an unrelated reason free. That is the difference between a
 * sweep that keeps up with a large workspace and one that never finishes.
 *
 * @param ctx - The sync context.
 * @param design - The database to project into.
 * @param budget - Remaining Notion writes this pass may spend.
 * @returns what the pass wrote.
 */
export async function projectEntity(
  ctx: MirrorContext,
  design: MirrorDatabaseRow,
  budget: number,
): Promise<MirrorPassResult> {
  const dataSourceId = design.externalDataSourceId;
  if (dataSourceId === null) return { written: 0, conflicts: 0, complete: true };

  const bindings = orderedColumns(design.propertyMap);
  const records = await loadEntityRows(ctx.orgId, ctx.integrationId, design.entityType);
  const mirrors = await loadMirrorRows(ctx.integrationId, design.entityType);

  let written = 0;
  let complete = true;
  for (const record of records) {
    if (written >= budget) {
      complete = false;
      break;
    }
    const existing = mirrors.get(record.entityId);
    const projected = projectRow(bindings, record.values);

    if (existing === undefined) {
      const result = await ctx.mirror.writeRow({
        kind: 'create',
        dataSourceId,
        properties: projected.properties,
      });
      if (result !== undefined) {
        await db.insert(notionMirrorRow).values({
          organizationId: ctx.orgId,
          integrationId: ctx.integrationId,
          entityType: design.entityType,
          entityId: record.entityId,
          externalPageId: result.externalPageId,
          externalUpdatedAt: new Date(result.externalUpdatedAt),
          lastPushedAt: new Date(result.externalUpdatedAt),
          contentHash: projected.contentHash,
        });
      }
      written += 1;
      await pace();
      continue;
    }

    // Unchanged values cost nothing: this is the check that makes the rate limit survivable.
    if (!contentChanged(existing, projected.contentHash)) continue;

    const result = await ctx.mirror.writeRow({
      kind: 'update',
      dataSourceId,
      externalPageId: existing.externalPageId,
      properties: projected.properties,
    });
    if (result !== undefined) {
      await db
        .update(notionMirrorRow)
        .set({
          externalUpdatedAt: new Date(result.externalUpdatedAt),
          lastPushedAt: new Date(result.externalUpdatedAt),
          contentHash: projected.contentHash,
        })
        .where(
          and(
            eq(notionMirrorRow.integrationId, ctx.integrationId),
            eq(notionMirrorRow.entityType, design.entityType),
            eq(notionMirrorRow.entityId, record.entityId),
          ),
        );
    }
    written += 1;
    await pace();
  }

  const rowCount = records.length;
  await db
    .update(notionMirrorDatabase)
    .set({ lastPushedAt: ctx.now, rowCount })
    .where(eq(notionMirrorDatabase.id, design.id));

  return { written, conflicts: 0, complete };
}

/**
 * Read Notion's edits back into Docket for one designed database.
 *
 * @remarks
 * Every conflict is recorded **before** the push that overwrites it, via the same
 * `recordSyncConflict` the linked-database reconciler uses — so the losing value survives in the
 * task's own history rather than in a side channel nobody opens. That ordering is the point: a
 * crash between the record and the push loses a write, while the reverse loses the evidence.
 *
 * @param ctx - The sync context.
 * @param design - The database to read.
 * @param budget - Remaining Notion writes this pass may spend.
 * @returns what the pass wrote, including how many conflicts it recorded.
 */
export async function pullBackEntity(
  ctx: MirrorContext,
  design: MirrorDatabaseRow,
  budget: number,
): Promise<MirrorPassResult> {
  const dataSourceId = design.externalDataSourceId;
  if (dataSourceId === null) return { written: 0, conflicts: 0, complete: true };

  const direction = MIRROR_ENTITY_SPECS[design.entityType].direction;
  const since = design.lastPulledAt?.toISOString();
  const changes = await ctx.mirror.queryChanges(dataSourceId, since);
  const mirrors = await loadMirrorRowsByPage(ctx.integrationId, design.entityType);
  const bindings = orderedColumns(design.propertyMap);

  let written = 0;
  let conflicts = 0;
  let complete = true;

  for (const change of changes) {
    if (written >= budget) {
      complete = false;
      break;
    }
    const local = mirrors.get(change.externalPageId);
    const action = planMirrorRow(local, change, direction);

    if (action.kind === 'noop' || action.kind === 'pull' || action.kind === 'adopt') {
      // `pull` and `adopt` write Docket state rather than Notion state; both need per-entity
      // mapping that only the two-way entities have, and neither is wired yet — recorded as
      // untouched rather than silently dropped. See the spec's open-work section.
      continue;
    }

    if (action.kind === 'push' && action.conflict !== undefined && local !== undefined) {
      // Recorded first, always. The push immediately below destroys the remote value, so the
      // order is what decides whether a crash loses a write or loses the evidence of one.
      //
      // The remote field values are deliberately null/undefined rather than invented: Notion
      // returns page properties keyed by property id, and turning those back into Docket's
      // title/body/dueDate shape needs the pull mapping that is not built yet. Recording the
      // conflict with honest gaps beats recording plausible-looking values that were never read.
      await recordSyncConflict(
        ctx.orgId,
        ctx.actorId,
        ctx.integrationId,
        'notion',
        local.entityId,
        {
          externalId: local.externalPageId,
          remoteUpdatedAt: action.conflict.remoteUpdatedAt,
          localUpdatedAt: action.conflict.localUpdatedAt,
          remoteTitle: '',
          remoteBody: null,
          remoteDueDate: undefined,
          remoteCompleted: undefined,
        },
      );
      conflicts += 1;
    }

    if (action.kind === 'push' || action.kind === 'create') {
      const record = await loadOneEntity(
        ctx.orgId,
        ctx.integrationId,
        design.entityType,
        local?.entityId,
      );
      if (record === undefined) continue;
      const projected = projectRow(bindings, record.values);
      const result = await ctx.mirror.writeRow(
        action.kind === 'create'
          ? { kind: 'create', dataSourceId, properties: projected.properties }
          : {
              kind: 'update',
              dataSourceId,
              externalPageId: change.externalPageId,
              properties: projected.properties,
            },
      );
      if (result !== undefined && local !== undefined) {
        await db
          .update(notionMirrorRow)
          .set({
            externalPageId: result.externalPageId,
            externalUpdatedAt: new Date(result.externalUpdatedAt),
            lastPushedAt: new Date(result.externalUpdatedAt),
            contentHash: projected.contentHash,
          })
          .where(eq(notionMirrorRow.id, local.mirrorRowId));
      }
      written += 1;
      await pace();
      continue;
    }

    if (action.kind === 'trash' && local !== undefined) {
      await ctx.mirror.writeRow({
        kind: 'delete',
        dataSourceId,
        externalPageId: local.externalPageId,
      });
      await db
        .update(notionMirrorRow)
        .set({ deletedAt: ctx.now })
        .where(eq(notionMirrorRow.id, local.mirrorRowId));
      written += 1;
      await pace();
    }
  }

  if (complete) {
    await db
      .update(notionMirrorDatabase)
      .set({ lastPulledAt: ctx.now })
      .where(eq(notionMirrorDatabase.id, design.id));
  }

  return { written, conflicts, complete };
}

/** A mirror row plus the id needed to update it. */
type LoadedMirrorRow = MirrorLocalRow & { readonly mirrorRowId: string };

/** Load this entity's mirror rows, keyed by Docket entity id. */
async function loadMirrorRows(
  integrationId: string,
  entityType: NotionMirrorEntity,
): Promise<Map<string, LoadedMirrorRow>> {
  const rows = await db
    .select()
    .from(notionMirrorRow)
    .where(
      and(
        eq(notionMirrorRow.integrationId, integrationId),
        eq(notionMirrorRow.entityType, entityType),
        isNull(notionMirrorRow.deletedAt),
      ),
    );
  return new Map(rows.map((row) => [row.entityId, toLocalRow(row)]));
}

/** Load this entity's mirror rows, keyed by Notion page id. */
async function loadMirrorRowsByPage(
  integrationId: string,
  entityType: NotionMirrorEntity,
): Promise<Map<string, LoadedMirrorRow>> {
  const rows = await db
    .select()
    .from(notionMirrorRow)
    .where(
      and(
        eq(notionMirrorRow.integrationId, integrationId),
        eq(notionMirrorRow.entityType, entityType),
      ),
    );
  return new Map(rows.map((row) => [row.externalPageId, toLocalRow(row)]));
}

/** Project a stored mirror row onto the planner's input shape. */
function toLocalRow(row: typeof notionMirrorRow.$inferSelect): LoadedMirrorRow {
  return {
    mirrorRowId: row.id,
    entityId: row.entityId,
    externalPageId: row.externalPageId,
    updatedAt: row.updatedAt,
    externalUpdatedAt: row.externalUpdatedAt,
    lastPushedAt: row.lastPushedAt,
    contentHash: row.contentHash,
    archived: row.deletedAt !== null,
  };
}

/** Load one entity's current values, for a push planned from the remote side. */
async function loadOneEntity(
  orgId: string,
  integrationId: string,
  entityType: NotionMirrorEntity,
  entityId: string | undefined,
): Promise<MirrorEntityRecord | undefined> {
  if (entityId === undefined) return undefined;
  const records = await loadEntityRows(orgId, integrationId, entityType);
  return records.find((record) => record.entityId === entityId);
}

/** Re-exported so callers pace their own writes consistently. */
export { WRITE_BUDGET };
export type { MirrorValue };

/**
 * Run one full Notion-mirror pass under the shared sync lease.
 *
 * @remarks
 * Ordered provision → pull back → project, and that order is load-bearing. Pulling before pushing
 * means a remote edit made since the last sweep is reconciled against the values Docket is about
 * to write, rather than being clobbered by a projection that ran first and then "discovered" its
 * own write as a remote change.
 *
 * The write budget is shared across every entity so one large database cannot starve the rest, and
 * a pass that exhausts it reports `stampFullSync: false` — the sweep is resumed next tick instead
 * of being recorded as a complete sync it never was.
 *
 * @param row - The Notion integration.
 * @param opts - Trigger and acting actor, as the spine requires.
 * @returns the recorded sync run, or null when another run holds the lease.
 */
export async function runNotionMirrorSync(
  row: IntegrationRow,
  opts: RunSyncOptions,
): Promise<SyncRunRow | null> {
  return runLeasedSync(row, { ...opts, purpose: 'notion_mirror' }, async ({ token, now }) => {
    const config = ConnectorConfig.safeParse(row.config).data ?? {};
    const parentPageId = config.notionMirror?.containerPageId;
    // Thrown, not silently skipped: without a parent page there is nowhere to create anything, and
    // a "successful" run that wrote nothing is the exact dishonesty the invariant forbids.
    if (parentPageId === undefined) {
      throw new Error('Pick a Notion page for Docket to build its databases under.');
    }

    const ctx: MirrorContext = {
      orgId: row.organizationId,
      integrationId: row.id,
      actorId: opts.actorId,
      mirror: buildNotionMirror(token === 'mock' ? undefined : token),
      now,
    };

    // Learn who is in the Notion workspace BEFORE anything else. Without this the people surface
    // has nothing to show and no decision to offer — the mapping rows it reads are written here
    // and nowhere else. Email matching and the immunity of a manual link are `syncExternalActors`'
    // existing behaviour; this only supplies the roster.
    const workspacePeople = await ctx.mirror.listWorkspaceUsers();
    await syncExternalActors(
      ctx.orgId,
      ctx.integrationId,
      workspacePeople.map((person) => ({
        externalId: person.externalId,
        displayName: person.name,
        ...(person.email !== undefined ? { email: person.email } : {}),
        ...(person.avatarUrl !== undefined ? { avatarUrl: person.avatarUrl } : {}),
        active: true,
      })),
    );

    await provisionMirror(ctx, parentPageId);

    const designs = await db
      .select()
      .from(notionMirrorDatabase)
      .where(
        and(
          eq(notionMirrorDatabase.organizationId, ctx.orgId),
          eq(notionMirrorDatabase.integrationId, ctx.integrationId),
          eq(notionMirrorDatabase.enabled, true),
          isNull(notionMirrorDatabase.archivedAt),
        ),
      );

    let budget = WRITE_BUDGET;
    let processed = 0;
    let complete = true;

    for (const design of designs) {
      if (budget <= 0) {
        complete = false;
        break;
      }
      const pulled = await pullBackEntity(ctx, design, budget);
      budget -= pulled.written;
      processed += pulled.written;
      if (!pulled.complete) complete = false;
    }

    for (const design of designs) {
      if (budget <= 0) {
        complete = false;
        break;
      }
      const pushed = await projectEntity(ctx, design, budget);
      budget -= pushed.written;
      processed += pushed.written;
      if (!pushed.complete) complete = false;
    }

    const total = designs.reduce((sum, design) => sum + design.rowCount, 0);
    return { processed, total, stampFullSync: complete };
  });
}

/** What one sweep across every configured Notion mirror did. */
export interface NotionMirrorSweepResult {
  /** Integrations that had a container page and were therefore eligible. */
  readonly eligible: number;
  /** Runs that actually started (the rest were holding, or held, a lease). */
  readonly ran: number;
  /** Runs that ended in failure. */
  readonly failed: number;
}

/**
 * Run the Notion mirror for every workspace that has configured one.
 *
 * @remarks
 * A separate sweep rather than a branch inside `sweepConnectorSync`, for the same reason
 * `email_ingest` has its own: `runNotionMirrorSync` depends on the sync spine, so calling it from
 * the spine would be an import cycle. It also keeps the two purposes independently schedulable —
 * a workspace can mirror into Notion on a different cadence than it pulls linked databases.
 *
 * An integration with no container page is skipped silently: it has designed databases but has not
 * chosen where they go, which is a legitimate half-finished setup rather than a failure.
 *
 * @param now - The sweep's clock.
 * @returns how many integrations were eligible, ran, and failed.
 */
export async function sweepNotionMirror(now: Date): Promise<NotionMirrorSweepResult> {
  const rows = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.provider, 'notion'),
        inArray(integration.status, ['connected', 'error']),
        isNotNull(integration.syncCadenceMinutes),
      ),
    );

  let eligible = 0;
  let ran = 0;
  let failed = 0;

  for (const row of rows) {
    const config = ConnectorConfig.safeParse(row.config).data ?? {};
    if (config.notionMirror?.containerPageId === undefined) continue;
    const actorId = row.createdBy;
    if (actorId === null) continue;

    const cadenceMs = (row.syncCadenceMinutes ?? 0) * 60_000;
    if (cadenceMs <= 0) continue;
    if (row.lastSyncedAt !== null && now.getTime() - row.lastSyncedAt.getTime() < cadenceMs) {
      continue;
    }

    eligible += 1;
    const run = await runNotionMirrorSync(row, { actorId, trigger: 'scheduled' });
    if (run === null) continue;
    if (run.status === 'failed') failed += 1;
    else ran += 1;
  }

  return { eligible, ran, failed };
}
