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
import {
  db,
  integration,
  notionMirrorDatabase,
  notionMirrorRow,
  notionMirrorState,
  syncRun,
} from '@docket/db';
import type {
  NotionColumnBinding,
  NotionMirrorEntity,
} from '@docket/connections/notion/mirror-contract';
import {
  MIRROR_ENTITY_SPECS,
  MIRROR_PROJECTION_ORDER,
  orderedColumns,
  provisionedKind,
} from '@docket/connections/notion/mirror-schema';
import type {
  MirrorColumnSpec,
  MirrorDatabaseSpec,
  MirrorRowResult,
  NotionMirrorPort,
  ProvisionedMirrorDatabase,
} from '@docket/connections/notion/mirror-port';
import { isProviderMissingObjectError, ProviderError } from '@docket/connections/provider-error';
import {
  type MirrorEntityPages,
  type MirrorReferences,
  type MirrorValue,
  projectRow,
  readMirrorProperties,
  resolveMirrorValues,
} from '@docket/connections/notion/mirror-values';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { ConnectorConfig } from '@docket/types';

import { buildNotionMirror } from '../container';
import { externalActorReverseMap, syncExternalActors } from './integration-identity';
import { recordSyncConflict } from './sync-notion';
import { runLeasedSync, type RunSyncOptions, type SyncRunRow } from './integration-sync';
import type { IntegrationRow } from './integration-provider';
import { contentChanged, planMirrorRow, type MirrorLocalRow } from './notion-mirror-plan';
import {
  adoptEntity,
  applyPulledValues,
  loadEntityRows,
  type MirrorEntityRecord,
} from './notion-mirror-entities';
import type { MirrorDatabaseRow } from './notion-mirror-design';
import {
  applyNotionMirrorGeneration,
  captureNotionMirrorGeneration,
  failNotionMirrorGeneration,
  wakeNotionMirror,
} from './notion-mirror-wake';

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

/** How many times one pass may rebuild databases Notion reports as gone. */
const MAX_REBUILD_PASSES = 1;

/** Milliseconds between Notion writes — three per second, with headroom. */
const WRITE_INTERVAL_MS = 350;

/** What one pass did. */
export interface MirrorPassResult {
  readonly written: number;
  readonly conflicts: number;
  /**
   * True when the pass covered everything it was asked to.
   *
   * @remarks
   * False when the write budget ran out, and false when a reference could not be resolved *yet* —
   * both mean the sweep should come back rather than record a complete sync.
   */
  readonly complete: boolean;
  /** References a later pass can still fill in, because the target row is not written yet. */
  readonly unresolvedPending: number;
  /**
   * References nothing will ever fill in, because the target has no page and never will.
   *
   * @remarks
   * A person with no Notion account, or a related record the target database does not project at
   * all — an agent on a team, an archived project. Reported but deliberately NOT allowed to mark
   * the pass incomplete: one of either would otherwise stop the workspace ever recording a full
   * sync, while the column is doing exactly what it says and holding the subset it can represent.
   */
  readonly unresolvedPermanent: number;
  /**
   * `entityId → page id` for this entity after the pass, when it projected one.
   *
   * @remarks
   * Handed to the entities projected next, so a relation written later in the same pass points at
   * a page created earlier in it rather than waiting a whole sweep. Absent on a pull-back pass,
   * which creates pages for adopted rows but is not the authority on what this entity projects.
   */
  readonly pageByEntityId?: ReadonlyMap<string, string>;
  /**
   * Whether every row of this entity was written, regardless of what its references resolved to.
   *
   * @remarks
   * The signal `settled` is built from. Distinct from {@link complete}, which is additionally
   * false when a reference is still pending — a fact about OTHER entities that says nothing about
   * whether this one's page set is final.
   */
  readonly wroteEveryRow?: boolean;
}

/** Everything a pass needs to reach Notion and the database. */
export interface MirrorContext {
  readonly orgId: string;
  readonly integrationId: string;
  readonly integrationRow: IntegrationRow;
  readonly actorId: string;
  readonly mirror: NotionMirrorPort;
  readonly now: Date;
}

/**
 * A pass that had nothing to do.
 *
 * @remarks
 * `pageByEntityId` is present and empty rather than absent, and `settled` follows from `complete`
 * being true. An unprovisioned design projects nothing and will project nothing later in this
 * pass either, so references to it are final — leaving it unsettled instead would classify them
 * as retryable and withhold `stampFullSync` on this sweep and every one after it.
 */
const EMPTY_PASS: MirrorPassResult = {
  written: 0,
  conflicts: 0,
  complete: true,
  unresolvedPending: 0,
  unresolvedPermanent: 0,
  pageByEntityId: new Map(),
};

/** Sleep between writes so a burst does not trip Notion's limiter. */
function pace(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, WRITE_INTERVAL_MS));
}

/**
 * The content hash of a record as it would be projected right now.
 *
 * @remarks
 * Resolution has to happen before hashing, or the hash describes values the projection would never
 * write — and the next pass would read that as "changed" and push a row that did not need pushing.
 *
 * @param bindings - The design's columns.
 * @param record - The Docket record.
 * @param refs - The pass's reference maps.
 * @returns the stable content hash.
 */
function projectedHash(
  bindings: readonly NotionColumnBinding[],
  record: MirrorEntityRecord,
  refs: MirrorReferences,
): string {
  return projectRow(bindings, resolveMirrorValues(bindings, record.values, refs).values)
    .contentHash;
}

/**
 * Load every id map the pass needs to turn references into Notion ids.
 *
 * @remarks
 * Per-pass rather than per-row: the maps are small, they are read by every entity with a relation
 * or person column, and re-reading them per row would turn a projection into a query storm.
 *
 * Only entities the pass will actually project get an entry. An absent entry is meaningful — it
 * says the target database is disabled or unprovisioned, so references to it can never resolve and
 * must be reported as permanent rather than deferred forever.
 *
 * Every entity starts `settled: false`, because at load time none has been projected yet.
 *
 * @param ctx - The sync context.
 * @param entities - The entities this pass will project.
 * @returns the reference maps for the start of the pass.
 */
async function loadReferences(
  ctx: MirrorContext,
  entities: readonly NotionMirrorEntity[],
): Promise<MirrorReferences> {
  const [notionUserByActor, rowsPerEntity] = await Promise.all([
    externalActorReverseMap(ctx.integrationId),
    Promise.all(entities.map((entity) => loadMirrorRows(ctx.integrationId, entity))),
  ]);

  const pages = new Map<NotionMirrorEntity, MirrorEntityPages>();
  entities.forEach((entity, index) => {
    const pageByEntityId = new Map<string, string>();
    for (const [entityId, row] of rowsPerEntity[index] ?? []) {
      pageByEntityId.set(entityId, row.externalPageId);
    }
    pages.set(entity, { pageByEntityId, settled: false });
  });

  return { notionUserByActor, pages };
}

/**
 * Fold one entity's freshly written pages back into the pass's reference maps.
 *
 * @remarks
 * Called after each entity projects, so everything projected later points at real pages rather
 * than waiting a whole sweep. `settled` is what turns "not written yet" into "will never be
 * written": once an entity has projected to completion, an id with no page is one its loader does
 * not project at all, and reporting that as retryable would keep the pass permanently unfinished.
 *
 * @param refs - The maps so far.
 * @param entity - The entity just projected.
 * @param pageByEntityId - Its pages, including any created in this pass.
 * @param settled - Whether that projection ran to completion.
 * @returns the updated maps.
 */
function withProjectedPages(
  refs: MirrorReferences,
  entity: NotionMirrorEntity,
  pageByEntityId: ReadonlyMap<string, string>,
  settled: boolean,
): MirrorReferences {
  const pages = new Map(refs.pages);
  pages.set(entity, { pageByEntityId, settled });
  return { notionUserByActor: refs.notionUserByActor, pages };
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
  // A person column rendered as a relation points at Docket's own People database. Without this
  // the lookup below found no `relationEntity` (person-valued fields have none — they are not
  // catalog relations), so the column was dropped from the spec and never created in Notion at
  // all: the representation was selectable and did nothing.
  const target =
    binding.representation === 'docket_people_table'
      ? 'person'
      : MIRROR_ENTITY_SPECS[entity].fields.find((f) => f.field === binding.field)?.relationEntity;
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

/** Exact marker that lets a retry adopt only a database this integration created. */
function mirrorOwnershipKey(integrationId: string, entityType: NotionMirrorEntity): string {
  return `docket:notion-mirror:${integrationId}:${entityType}`;
}

/**
 * Create every designed-but-missing database in Notion.
 *
 * @remarks
 * Ordered in two waves because a Notion relation must name an existing data source: every database
 * is created with its scalar columns first, then each is patched to add the relations now that
 * their targets exist. A single wave would either fail or silently drop every relation.
 *
 * Creation is skipped for a design that already carries an `externalDataSourceId`. The schema patch
 * still runs every pass for any design holding a relation column.
 *
 * @param ctx - The sync context.
 * @param parentPageId - The page to create the databases under.
 * @param rebuildsLeft - Remaining rebuild rounds; exhausting it throws.
 * @returns how many databases were created.
 */
export async function provisionMirror(
  ctx: MirrorContext,
  parentPageId: string,
  rebuildsLeft = MAX_REBUILD_PASSES,
): Promise<number> {
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
    const spec: MirrorDatabaseSpec = {
      title: design.title,
      parentPageId,
      ownershipKey: mirrorOwnershipKey(ctx.integrationId, design.entityType),
      columns: toColumnSpecs(design.entityType, scalars, dataSourceByEntity),
    };
    let provisioned: ProvisionedMirrorDatabase | undefined;
    if (design.provisioningStartedAt !== null) {
      const owned = await ctx.mirror.findDatabasesByOwnershipKey(spec);
      if (owned.length > 1) {
        throw new Error(
          `Notion contains more than one database owned by ${spec.ownershipKey}; Docket will not guess which one to use.`,
        );
      }
      provisioned = owned[0];
    } else {
      await db
        .update(notionMirrorDatabase)
        .set({ provisioningStartedAt: ctx.now })
        .where(eq(notionMirrorDatabase.id, design.id));
    }
    provisioned ??= await ctx.mirror.provisionDatabase(spec);
    dataSourceByEntity.set(design.entityType, provisioned.externalDataSourceId);
    await db
      .update(notionMirrorDatabase)
      .set({
        externalDatabaseId: provisioned.externalDatabaseId,
        externalDataSourceId: provisioned.externalDataSourceId,
        externalUrl: provisioned.url ?? null,
        propertyMap: withPropertyIds(design.propertyMap, provisioned.propertyIds),
        provisionedAt: ctx.now,
        provisioningStartedAt: null,
      })
      .where(eq(notionMirrorDatabase.id, design.id));
    created += 1;
    await pace();
  }

  // Wave two: relations, now that every target data source exists — plus any column that is still
  // missing a property id.
  //
  // That second condition is what makes a column ADDED to an already-provisioned database actually
  // get created. Gating on "has a relation" alone meant a design with no relation column was never
  // patched again after creation, so a column added later existed in Docket's map and nowhere in
  // Notion, and every value written to it was silently dropped.
  let forgotten = 0;
  for (const design of designs) {
    const refreshed = await db
      .select()
      .from(notionMirrorDatabase)
      .where(eq(notionMirrorDatabase.id, design.id))
      .limit(1);
    const row = refreshed[0];
    if (!row?.externalDataSourceId) continue;
    const columns = orderedColumns(row.propertyMap);
    const needsPatch =
      columns.some((binding) => provisionedKind(binding) === 'relation') ||
      columns.some((binding) => binding.propertyId === undefined);
    if (!needsPatch) continue;
    try {
      const bindings = await ctx.mirror.updateDatabaseSchema(row.externalDataSourceId, {
        title: row.title,
        parentPageId,
        ownershipKey: mirrorOwnershipKey(ctx.integrationId, row.entityType),
        columns: toColumnSpecs(row.entityType, columns, dataSourceByEntity),
      });
      await db
        .update(notionMirrorDatabase)
        .set({
          propertyMap: withPropertyIds(row.propertyMap, bindings.propertyIds),
        })
        .where(eq(notionMirrorDatabase.id, row.id));
    } catch (error) {
      if (!isProviderMissingObjectError(error)) throw error;
      await forgetProvisionedDatabase(row.id);
      forgotten += 1;
    }
    await pace();
  }

  if (forgotten > 0) {
    if (rebuildsLeft <= 0) {
      throw new Error(
        'Notion keeps reporting newly created databases as missing; stopped rebuilding.',
      );
    }
    created += await provisionMirror(ctx, parentPageId, rebuildsLeft - 1);
  }

  return created;
}

/**
 * Drop the Notion ids for a database that no longer exists, keeping the design.
 *
 * @remarks
 * Property ids are cleared too: a recreated database assigns new ones, and a stale id makes Notion
 * reject the row.
 *
 * @param id - The `notion_mirror_database` row to reset.
 */
async function forgetProvisionedDatabase(id: string): Promise<void> {
  const rows = await db
    .select()
    .from(notionMirrorDatabase)
    .where(eq(notionMirrorDatabase.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  const cleared: Record<string, NotionColumnBinding> = {};
  for (const [field, binding] of Object.entries(row.propertyMap)) {
    const { propertyId: _dropped, ...rest } = binding;
    cleared[field] = rest;
  }
  await db
    .update(notionMirrorDatabase)
    .set({
      externalDatabaseId: null,
      externalDataSourceId: null,
      externalUrl: null,
      provisionedAt: null,
      propertyMap: cleared,
    })
    .where(eq(notionMirrorDatabase.id, id));
  // Row mirrors point at pages inside the deleted database.
  await db
    .delete(notionMirrorRow)
    .where(
      and(
        eq(notionMirrorRow.integrationId, row.integrationId),
        eq(notionMirrorRow.entityType, row.entityType),
      ),
    );
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
 * A row whose person column cannot be resolved yet is still written, minus that one property,
 * rather than held back. An empty-looking Tasks database is a worse lie than a complete one with a
 * single column still filling in, and the content hash means the eventual fill costs exactly one
 * extra write per affected row.
 *
 * @param ctx - The sync context.
 * @param design - The database to project into.
 * @param budget - Remaining Notion writes this pass may spend.
 * @param refs - The reference maps, loaded once for the whole pass.
 * @returns what the pass wrote, including the pages it now has for this entity.
 */
export async function projectEntity(
  ctx: MirrorContext,
  design: MirrorDatabaseRow,
  budget: number,
  refs: MirrorReferences,
): Promise<MirrorPassResult> {
  const dataSourceId = design.externalDataSourceId;
  if (dataSourceId === null) return EMPTY_PASS;

  const bindings = orderedColumns(design.propertyMap);
  const records = await loadEntityRows(ctx.orgId, ctx.integrationId, design.entityType);
  const mirrors = await loadMirrorRows(ctx.integrationId, design.entityType);
  const creationIntents = await loadCreationIntents(ctx.integrationId, design.entityType);

  // Seeded from what already existed, then grown by this pass's creates, so the caller can hand
  // the result straight to the entities projected after this one.
  const pageByEntityId = new Map<string, string>();
  for (const [entityId, row] of mirrors) pageByEntityId.set(entityId, row.externalPageId);

  let written = 0;
  // Budget exhaustion ONLY. Kept apart from the unresolved tallies because the two answer
  // different questions: this one says whether every row of this entity got a page, which is what
  // decides if a missing page elsewhere is final. Folding a deferred reference into it would let
  // one back edge — `project.initiatives`, say — make `project` look unsettled to `milestone`,
  // which would then defer an archived project's page for ever instead of clearing it.
  let wroteEveryRow = true;
  let unresolvedPending = 0;
  let unresolvedPermanent = 0;
  for (const record of records) {
    if (written >= budget) {
      wroteEveryRow = false;
      break;
    }
    const existing = mirrors.get(record.entityId);
    const resolved = resolveMirrorValues(bindings, record.values, refs);
    for (const ref of resolved.unresolved) {
      if (ref.retryable) unresolvedPending += 1;
      else unresolvedPermanent += 1;
    }
    const projected = projectRow(bindings, resolved.values);

    if (existing === undefined) {
      const pendingIntent = creationIntents.get(record.entityId);
      if (pendingIntent !== undefined) {
        wroteEveryRow = false;
        unresolvedPending += 1;
        break;
      }
      const [intent] = await db
        .insert(notionMirrorRow)
        .values({
          organizationId: ctx.orgId,
          integrationId: ctx.integrationId,
          entityType: design.entityType,
          entityId: record.entityId,
          externalPageId: null,
          contentHash: projected.contentHash,
        })
        .returning({ id: notionMirrorRow.id });
      if (!intent) throw new Error('Notion mirror row intent did not return an id');
      creationIntents.set(record.entityId, intent.id);

      let result: MirrorRowResult | undefined;
      try {
        result = await ctx.mirror.writeRow({
          kind: 'create',
          dataSourceId,
          properties: projected.properties,
        });
        if (result === undefined) {
          throw new ProviderError('Notion accepted a page create without returning its page', {
            provider: 'notion',
            kind: 'provider',
          });
        }
      } catch (error) {
        if (createOutcomeIsAmbiguous(error)) {
          throw pendingCreateConfirmation(error);
        } else {
          await db.delete(notionMirrorRow).where(eq(notionMirrorRow.id, intent.id));
          creationIntents.delete(record.entityId);
        }
        throw error;
      }

      await db
        .update(notionMirrorRow)
        .set({
          externalPageId: result.externalPageId,
          externalUpdatedAt: new Date(result.externalUpdatedAt),
          lastPushedAt: new Date(result.externalUpdatedAt),
          contentHash: projected.contentHash,
        })
        .where(eq(notionMirrorRow.id, intent.id));
      pageByEntityId.set(record.entityId, result.externalPageId);
      creationIntents.delete(record.entityId);
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

  return {
    written,
    conflicts: 0,
    // A pending reference means a row this pass depends on has not been written yet, so the
    // projection is genuinely unfinished and the sweep must return. Permanent ones must not
    // count, or one account-less person would keep the workspace from ever recording a full sync.
    complete: wroteEveryRow && unresolvedPending === 0,
    unresolvedPending,
    unresolvedPermanent,
    pageByEntityId,
    // Deliberately NOT `complete`: see `wroteEveryRow`.
    wroteEveryRow,
  };
}

/** Whether a failed create may have reached Notion before Docket lost the response. */
function createOutcomeIsAmbiguous(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return true;
  if (error.kind === 'network' || error.kind === 'ambiguous' || error.kind === 'unknown')
    return true;
  if (error.status === undefined) return error.kind === 'provider';
  return error.status >= 500 && error.status !== 529;
}

/** Describe a create whose provider result Docket must confirm before it can write again. */
function pendingCreateConfirmation(cause?: unknown): ProviderError<'notion'> {
  return new ProviderError(
    'Docket is waiting for Notion to confirm one page creation. It will keep checking without creating a duplicate.',
    { provider: 'notion', kind: 'ambiguous', ...(cause !== undefined ? { cause } : {}) },
  );
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
  refs: MirrorReferences,
): Promise<MirrorPassResult> {
  const dataSourceId = design.externalDataSourceId;
  if (dataSourceId === null) return EMPTY_PASS;

  const direction = MIRROR_ENTITY_SPECS[design.entityType].direction;
  const since = design.lastPulledAt?.toISOString();
  const changes = await ctx.mirror.queryChanges(dataSourceId, since);
  const mirrors = await loadMirrorRowsByPage(ctx.integrationId, design.entityType);

  // Every page this entity has after the pull, so the projection loop can take it directly rather
  // than re-reading the whole mirror table. Seeded from what already existed and grown by the
  // adoptions below, which are the only thing a pull adds.
  const adoptedPages = new Map<string, string>();
  for (const row of mirrors.values()) adoptedPages.set(row.entityId, row.externalPageId);

  // Read through a lazy, invalidate-on-write view rather than reloading per row — see below.
  const records = recordLookup(ctx.orgId, ctx.integrationId, design.entityType);
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

    if (action.kind === 'noop') continue;

    if (action.kind === 'adopt') {
      // A row created directly in Notion, on a two-way entity. `adoptEntity` reuses the same
      // team-landing answer the linked-database mode already settled on (`resolveImportTeam`) —
      // see its own doc comment for why that is the consistent answer rather than a new one.
      if (written >= budget) {
        complete = false;
        break;
      }
      const values = readMirrorProperties(bindings, change.properties);
      const entityId = await adoptEntity(
        ctx.orgId,
        ctx.actorId,
        ctx.integrationRow,
        design.entityType,
        values,
      );
      if (entityId !== undefined) {
        // Just created, so anything already loaded predates it.
        records.invalidate();
        const record = await records.get(entityId);
        const contentHash = record === undefined ? '' : projectedHash(bindings, record, refs);
        await db.insert(notionMirrorRow).values({
          organizationId: ctx.orgId,
          integrationId: ctx.integrationId,
          entityType: design.entityType,
          entityId,
          externalPageId: change.externalPageId,
          externalUpdatedAt: new Date(change.externalUpdatedAt),
          lastPushedAt: null,
          contentHash,
        });
        adoptedPages.set(entityId, change.externalPageId);
        written += 1;
      }
      continue;
    }

    if (action.kind === 'pull') {
      /* v8 ignore next -- @preserve defensive: `pull` is only returned by planMirrorRow when its
       * `local` argument was defined (see notion-mirror-plan.ts) — this repeats that check because
       * the narrowing does not cross the function-call boundary. */
      if (local === undefined) continue;
      const values = readMirrorProperties(bindings, change.properties);
      const applied = await applyPulledValues(
        ctx.orgId,
        ctx.actorId,
        design.entityType,
        local.entityId,
        values,
      );
      if (applied) {
        // Recompute the content hash from Docket's now-current values, not just stamp the anchor.
        // Skipping this would leave the stored hash describing the pre-pull row: the very next
        // projection pass would see it as "changed" against a hash that predates the pull, and push
        // straight back to Notion the same values just read from it — a real wasted write, not
        // merely a stale flag, since the projected payload really would differ from what is stored.
        // `applyPulledValues` just changed this row, so the hash must come from its new values.
        records.invalidate();
        const record = await records.get(local.entityId);
        const contentHash = record === undefined ? null : projectedHash(bindings, record, refs);
        // No Notion call here — this is a local DB write, not a Notion write, so it is not paced
        // against the rate limit. It IS counted against the pass's write budget: the budget's real
        // job is capping how long one sweep runs, and a pull that reads Notion's full property set
        // is not free either.
        await db
          .update(notionMirrorRow)
          .set({
            externalUpdatedAt: new Date(change.externalUpdatedAt),
            ...(contentHash !== null ? { contentHash } : {}),
          })
          .where(eq(notionMirrorRow.id, local.mirrorRowId));
        written += 1;
      }
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
      const record = await records.get(local?.entityId);
      if (record === undefined) continue;
      const projected = projectRow(
        bindings,
        resolveMirrorValues(bindings, record.values, refs).values,
      );
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
        adoptedPages.set(local.entityId, result.externalPageId);
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

  // The pull path resolves references only to recompute content hashes, never to write a
  // relation property, so an unresolved one here changes nothing about what was read back.
  return {
    written,
    conflicts,
    complete,
    unresolvedPending: 0,
    unresolvedPermanent: 0,
    pageByEntityId: adoptedPages,
  };
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
        isNotNull(notionMirrorRow.externalPageId),
      ),
    );
  return new Map(rows.map((row) => [row.entityId, toLocalRow(row)]));
}

/** Load unfinished page creates, keyed by Docket entity id. */
async function loadCreationIntents(
  integrationId: string,
  entityType: NotionMirrorEntity,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: notionMirrorRow.id, entityId: notionMirrorRow.entityId })
    .from(notionMirrorRow)
    .where(
      and(
        eq(notionMirrorRow.integrationId, integrationId),
        eq(notionMirrorRow.entityType, entityType),
        isNull(notionMirrorRow.externalPageId),
        isNull(notionMirrorRow.deletedAt),
      ),
    );
  return new Map(rows.map((row) => [row.entityId, row.id]));
}

/** Attach pages from ambiguous create responses before pull-back can mistake them for new work. */
export async function recoverCreationIntents(
  ctx: MirrorContext,
  designs: readonly MirrorDatabaseRow[],
): Promise<number> {
  let recovered = 0;
  const botId = await ctx.mirror.botId();
  const linkedRows = await db
    .select({ externalPageId: notionMirrorRow.externalPageId })
    .from(notionMirrorRow)
    .where(
      and(
        eq(notionMirrorRow.integrationId, ctx.integrationId),
        isNotNull(notionMirrorRow.externalPageId),
      ),
    );
  const linkedPageIds = new Set(
    linkedRows.flatMap((row) => (row.externalPageId === null ? [] : [row.externalPageId])),
  );
  for (const design of designs) {
    const dataSourceId = design.externalDataSourceId;
    if (dataSourceId === null) continue;
    const intents = await db
      .select()
      .from(notionMirrorRow)
      .where(
        and(
          eq(notionMirrorRow.integrationId, ctx.integrationId),
          eq(notionMirrorRow.entityType, design.entityType),
          isNull(notionMirrorRow.externalPageId),
          isNull(notionMirrorRow.deletedAt),
        ),
      );
    if (intents.length === 0) continue;
    if (intents.length > 1) {
      throw new Error(
        `Docket is waiting for Notion to confirm multiple ${design.entityType} page creates; Docket will not guess which pages belong to them.`,
      );
    }
    const intent = intents[0];
    if (intent === undefined) continue;
    const candidates = (
      await ctx.mirror.queryCreatedRows(dataSourceId, intent.createdAt.toISOString())
    ).filter((page) => page.createdBy === botId && !linkedPageIds.has(page.externalPageId));
    if (candidates.length > 1) {
      throw new Error(
        `Notion returned more than one unlinked ${design.entityType} page for one pending create; Docket will not guess which page to use.`,
      );
    }
    const page = candidates[0];
    if (page === undefined) throw pendingCreateConfirmation();
    const updatedAt = new Date(page.externalUpdatedAt);
    await db
      .update(notionMirrorRow)
      .set({
        externalPageId: page.externalPageId,
        externalUpdatedAt: updatedAt,
        lastPushedAt: updatedAt,
      })
      .where(eq(notionMirrorRow.id, intent.id));
    linkedPageIds.add(page.externalPageId);
    recovered += 1;
    await pace();
  }
  return recovered;
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
        isNotNull(notionMirrorRow.externalPageId),
      ),
    );
  return new Map(
    rows.flatMap((row) =>
      row.externalPageId === null ? [] : [[row.externalPageId, toLocalRow(row)]],
    ),
  );
}

/** Project a stored mirror row onto the planner's input shape. */
function toLocalRow(row: typeof notionMirrorRow.$inferSelect): LoadedMirrorRow {
  if (row.externalPageId === null) {
    throw new Error('Notion mirror row has no external page anchor');
  }
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

/** Reads one entity's records, reloading only after something has changed them. */
interface RecordLookup {
  /** The record for `entityId`, or undefined when there is no id or no matching row. */
  get: (entityId: string | undefined) => Promise<MirrorEntityRecord | undefined>;
  /** Mark the set stale, after a write that changed what a record projects to. */
  invalidate: () => void;
}

/**
 * A per-pass, invalidate-on-write view of one entity's projectable records.
 *
 * @remarks
 * The pull used to call `loadEntityRows` per changed row and keep a single record of the result.
 * That was already a full table scan per change; once the loaders grew their link-table queries it
 * became several org-wide scans per change, so reconciling fifty rows issued hundreds of queries
 * to read fifty records.
 *
 * Caching outright is not safe, though: `applyPulledValues` and `adoptEntity` both *change* the
 * record whose hash is about to be computed, and a stale read there would store a hash describing
 * the pre-write row — the very thing the pull branch recomputes the hash to avoid, since the next
 * projection would see it as changed and push back the values it just read. So the set is loaded
 * lazily and dropped whenever the pass writes. A pass that only pushes drift (the common one)
 * loads once; a pass that mutates every row costs what it did before, and never reads stale.
 *
 * @param orgId - The tenant.
 * @param integrationId - The Notion integration.
 * @param entityType - Which entity to read.
 * @returns the lookup.
 */
function recordLookup(
  orgId: string,
  integrationId: string,
  entityType: NotionMirrorEntity,
): RecordLookup {
  let cached: Map<string, MirrorEntityRecord> | null = null;
  return {
    get: async (entityId) => {
      if (entityId === undefined) return undefined;
      cached ??= new Map(
        (await loadEntityRows(orgId, integrationId, entityType)).map((record) => [
          record.entityId,
          record,
        ]),
      );
      return cached.get(entityId);
    },
    invalidate: () => {
      cached = null;
    },
  };
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
  const captured = await captureNotionMirrorGeneration({
    integrationId: row.id,
    organizationId: row.organizationId,
  });
  const passState = { complete: false };
  const run = await runLeasedSync(
    row,
    { ...opts, purpose: 'notion_mirror' },
    async ({ token, now }) => {
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
        integrationRow: row,
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

      const found = await db
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

      // Sorted, because the select's order is whatever Postgres returns. A relation can only carry
      // a page id that already exists, so an entity has to be written before anything pointing at
      // it; `MIRROR_PROJECTION_ORDER` encodes that, and also makes budget spend predictable rather
      // than an accident of row layout.
      const designs = [...found].sort(
        (a, b) =>
          MIRROR_PROJECTION_ORDER.indexOf(a.entityType) -
          MIRROR_PROJECTION_ORDER.indexOf(b.entityType),
      );

      await recoverCreationIntents(ctx, designs);

      let budget = WRITE_BUDGET;
      let processed = 0;
      let complete = true;

      // Only the entities actually being projected get an entry. A relation pointing at one that is
      // absent — disabled, or never provisioned — can never resolve, and the resolver reads the
      // absence to say so rather than deferring forever.
      let refs = await loadReferences(
        ctx,
        designs.map((design) => design.entityType),
      );

      for (const design of designs) {
        if (budget <= 0) {
          complete = false;
          break;
        }
        const pulled = await pullBackEntity(ctx, design, budget, refs);
        budget -= pulled.written;
        processed += pulled.written;
        if (!pulled.complete) complete = false;
        // Adopting a row created in Notion mints a page the projection below can point at. Folded
        // forward from what the pull already knows rather than re-reading every mirror row for
        // every entity, which is a second full round of queries for a map we are holding.
        // `settled` stays false: the pull is not the authority on what this entity projects.
        if (pulled.pageByEntityId !== undefined) {
          refs = withProjectedPages(refs, design.entityType, pulled.pageByEntityId, false);
        }
      }

      for (const design of designs) {
        if (budget <= 0) {
          complete = false;
          break;
        }
        const pushed = await projectEntity(ctx, design, budget, refs);
        budget -= pushed.written;
        processed += pushed.written;
        if (!pushed.complete) complete = false;
        // Fold this entity's pages forward so everything projected after it points at real pages
        // instead of waiting a whole sweep. `settled` records whether the projection finished: an
        // id with no page after a complete run is one this entity does not project at all, which is
        // what lets the resolver call it permanent instead of retrying forever.
        if (pushed.pageByEntityId !== undefined) {
          refs = withProjectedPages(
            refs,
            design.entityType,
            pushed.pageByEntityId,
            pushed.wroteEveryRow ?? pushed.complete,
          );
        }
      }

      const total = designs.reduce((sum, design) => sum + design.rowCount, 0);
      passState.complete = complete;
      return { processed, total, stampFullSync: complete };
    },
  );

  if (run === null) return null;
  if (run.status === 'failed') {
    await failNotionMirrorGeneration({
      integrationId: row.id,
      kind: run.errorKind ?? 'unknown',
      error: run.error ?? 'Notion mirror failed',
    });
  } else if (passState.complete) {
    await applyNotionMirrorGeneration({
      integrationId: row.id,
      generation: captured.desiredGeneration,
    });
  }
  return run;
}

/** What one sweep across every configured Notion mirror did. */
export interface NotionMirrorSweepResult {
  /** Integrations that had a container page and were therefore eligible. */
  readonly eligible: number;
  /** Runs that actually started (the rest were holding, or held, a lease). */
  readonly ran: number;
  /** Runs that ended in failure. */
  readonly failed: number;
  /**
   * Connections that can never run as configured, and so are silently going nowhere.
   *
   * @remarks
   * A mirror with no container page, or with no owning actor whose credentials it can borrow, is
   * skipped every tick forever. Counting it is the difference between a sweep that reports
   * `{eligible: 0, ran: 0, failed: 0}` — indistinguishable from "nothing was due" — and one that
   * says a workspace is stuck. Not-yet-due is deliberately NOT counted here; that is a healthy
   * cadence, not a stall.
   */
  readonly stalled: number;
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
 * An integration with no container page — or none with an owning actor to borrow credentials
 * from — is not run, because there is nothing it could do. It is *counted* as `stalled` rather
 * than skipped in silence: a half-finished setup is a legitimate state, but one that never
 * finishes is indistinguishable from a working sync unless the sweep says so.
 *
 * @param now - The sweep's clock.
 * @returns how many integrations were eligible, ran, failed, and are stuck.
 */
export async function sweepNotionMirror(now: Date): Promise<NotionMirrorSweepResult> {
  const rows = await db
    .select()
    .from(integration)
    .where(
      and(eq(integration.provider, 'notion'), inArray(integration.status, ['connected', 'error'])),
    );

  const demandByIntegration = new Map<string, typeof notionMirrorState.$inferSelect>();
  if (rows.length > 0) {
    const states = await db
      .select()
      .from(notionMirrorState)
      .where(
        inArray(
          notionMirrorState.integrationId,
          rows.map((row) => row.id),
        ),
      );
    for (const state of states) demandByIntegration.set(state.integrationId, state);
  }

  // When each integration last attempted a mirror pass, from the run history.
  //
  // `integration.lastSyncedAt` cannot answer this: it is a roll-up written by whichever purpose ran
  // last, and a Notion connection runs two. A succeeding `task_sync` advances it every cadence, so
  // reading it here holds the mirror permanently undue.
  const lastMirrorAttempt = new Map<string, Date>();
  if (rows.length > 0) {
    const attempts = await db
      .select({ integrationId: syncRun.integrationId, startedAt: syncRun.startedAt })
      .from(syncRun)
      .where(
        and(
          eq(syncRun.purpose, 'notion_mirror'),
          inArray(
            syncRun.integrationId,
            rows.map((row) => row.id),
          ),
        ),
      );
    for (const attempt of attempts) {
      const seen = lastMirrorAttempt.get(attempt.integrationId);
      if (seen === undefined || attempt.startedAt > seen) {
        lastMirrorAttempt.set(attempt.integrationId, attempt.startedAt);
      }
    }
  }

  let eligible = 0;
  let ran = 0;
  let failed = 0;
  let stalled = 0;

  for (const row of rows) {
    const state = demandByIntegration.get(row.id);
    const pending = state !== undefined && state.desiredGeneration > state.appliedGeneration;
    if (pending) {
      if (state.nextAttemptAt !== null && state.nextAttemptAt > now) continue;
    } else {
      const cadenceMs = (row.syncCadenceMinutes ?? 0) * 60_000;
      if (cadenceMs <= 0) continue;
      const lastAttempt = lastMirrorAttempt.get(row.id);
      if (lastAttempt !== undefined && now.getTime() - lastAttempt.getTime() < cadenceMs) {
        continue;
      }
      await wakeNotionMirror({
        integrationId: row.id,
        organizationId: row.organizationId,
        now,
      });
    }

    const config = ConnectorConfig.safeParse(row.config).data ?? {};
    if (config.notionMirror?.containerPageId === undefined) {
      stalled += 1;
      continue;
    }
    const actorId = row.createdBy;
    if (actorId === null) {
      stalled += 1;
      continue;
    }

    eligible += 1;
    const run = await runNotionMirrorSync(row, { actorId, trigger: 'scheduled' });
    if (run === null) continue;
    if (run.status === 'failed') failed += 1;
    else ran += 1;
  }

  return { eligible, ran, failed, stalled };
}
