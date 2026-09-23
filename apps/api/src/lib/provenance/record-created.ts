/**
 * `@docket/api` — record newly created work as a change set.
 *
 * @remarks
 * The task, project, and initiative routes are one way work enters Docket. A sync, an import, a
 * repeating series, a routing rule, an accepted email, a quick capture, and a timer are the others,
 * and each records the same `create` entries through this module so every row has an origin.
 *
 * The entry point declares the provenance, with `runWithProvenance`; a writer whose provenance is
 * fixed passes it as `base` instead. Either way {@link originFor} runs first, so a write path with
 * no declared provenance fails before anything is written.
 */
import { db } from '@docket/db';

import {
  recordChangeSet,
  recordChangeSetInTransaction,
  trackedFields,
  type ChangeRecord,
  type RecordableKind,
} from '../../mcp/change-set';
import { originFor, type OriginDetail, type ProvenanceBase } from './context';

/** An open database transaction. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A transaction, or the pooled connection when the writer holds none. */
export type RecordExecutor = Tx | typeof db;

/** A freshly inserted row of a recordable kind. */
export interface CreatedRow extends Record<string, unknown> {
  readonly id: string;
}

/** A freshly inserted row that names its workspace and creator. */
export interface OwnedCreatedRow extends CreatedRow {
  readonly organizationId: string;
  readonly createdBy: string | null;
}

/** One entity a writer created. */
export interface CreatedEntity {
  readonly kind: RecordableKind;
  readonly row: CreatedRow;
}

/** Where and how a batch of created work is recorded. */
export interface RecordOptions {
  /** Session, plan, or cause links only this writer knows. */
  readonly detail?: OriginDetail;
  /** Fixed provenance for this writer; defaults to the provenance in flight. */
  readonly base?: ProvenanceBase;
  /** The transaction the rows were written in; defaults to a transaction of its own. */
  readonly executor?: RecordExecutor;
  /** The line shown in the change report; defaults to one naming the created entity. */
  readonly summary?: string;
}

/** A batch of created work to record. */
export interface RecordCreatedInput extends RecordOptions {
  readonly orgId: string;
  /** The member the work is attributed to. Nothing is recorded when there is none. */
  readonly actorId: string | null | undefined;
  /** The operation name. Machine-only. */
  readonly tool: string;
  readonly summary: string;
  readonly created: readonly CreatedEntity[];
}

/**
 * The `create` entry for one created entity.
 *
 * @param entity - The kind and inserted row.
 * @returns the change to record.
 */
export function createdChange(entity: CreatedEntity): ChangeRecord {
  const { kind, row } = entity;
  return { kind, id: row.id, op: 'create', after: trackedFields(kind, row) };
}

/** Whether an executor is an open transaction rather than the pooled connection. */
function isTransaction(executor: RecordExecutor): executor is Tx {
  return executor !== db;
}

/**
 * Record a batch of created work as one change set.
 *
 * @remarks
 * A change set belongs to the member whose authority it ran under. Work that no member authorized
 * (a series or sync whose creator has since left) has no such member, and records nothing; its
 * `createdBy` is empty for the same reason.
 *
 * @param input - The workspace, authorizing member, operation, summary, and created rows.
 * @returns the change-set id, or null when nothing was recorded.
 * @throws {MissingProvenanceError} When no provenance was declared for this write.
 */
export async function recordCreated(input: RecordCreatedInput): Promise<string | null> {
  if (input.created.length === 0) return null;
  const origin = originFor(input.tool, input.detail, input.base);
  if (!input.actorId) return null;
  const write = {
    orgId: input.orgId,
    actorId: input.actorId,
    origin,
    summary: input.summary,
    changes: input.created.map(createdChange),
  };
  const executor = input.executor;
  if (executor && isTransaction(executor)) return recordChangeSetInTransaction(executor, write);
  return recordChangeSet(write);
}

/**
 * A count with its noun, for a summary line: "1 task", "3 tasks".
 *
 * @param count - How many.
 * @param noun - The singular noun; the plural adds an `s`.
 * @returns the phrase.
 */
export function countOf(count: number, noun: string): string {
  return `${String(count)} ${count === 1 ? noun : `${noun}s`}`;
}

/** The display name of a created row, for its summary line. */
function rowLabel(row: CreatedRow): string {
  const label = row['title'] ?? row['name'];
  return typeof label === 'string' ? label : row.id;
}

/**
 * Record one created row, attributed to the member who created it.
 *
 * @param kind - The entity kind.
 * @param row - The inserted row.
 * @param tool - The operation name. Machine-only.
 * @param options - Transaction, fixed provenance, cause links, and summary.
 * @returns the change-set id, or null when nothing was recorded.
 * @throws {MissingProvenanceError} When no provenance was declared for this write.
 */
export async function recordCreatedRow(
  kind: RecordableKind,
  row: OwnedCreatedRow,
  tool: string,
  options: RecordOptions = {},
): Promise<string | null> {
  return recordCreated({
    ...options,
    orgId: row.organizationId,
    actorId: row.createdBy,
    tool,
    summary: options.summary ?? `Created "${rowLabel(row)}"`,
    created: [{ kind, row }],
  });
}

/**
 * Record each of a batch of inserted rows as its own change set, and hand the rows back.
 *
 * @remarks
 * For an insert that returns its rows straight into a caller expecting them, so recording can wrap
 * the insert without splitting the statement.
 *
 * @param kind - The entity kind.
 * @param rows - The inserted rows.
 * @param tool - The operation name. Machine-only.
 * @param options - Transaction, fixed provenance, and cause links.
 * @returns the same rows.
 * @throws {MissingProvenanceError} When no provenance was declared for this write.
 */
export async function recordCreatedRows<R extends OwnedCreatedRow>(
  kind: RecordableKind,
  rows: R[],
  tool: string,
  options: RecordOptions = {},
): Promise<R[]> {
  for (const row of rows) await recordCreatedRow(kind, row, tool, options);
  return rows;
}
