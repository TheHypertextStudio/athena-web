/**
 * `@docket/api` — page bodies and sync hashes for the Notion mirror.
 *
 * @remarks
 * A mirrored record reaches Notion as properties plus a Markdown page body. This module owns how
 * both are derived from one record, how they are hashed for change detection, and how page bodies
 * are read and written without mistaking a refused or truncated body for an empty one.
 *
 * @see `docs/engineering/specs/notion-sync.md` §9
 */
import { createHash } from 'node:crypto';

import type {
  NotionColumnBinding,
  NotionMirrorEntity,
} from '@docket/connections/notion/mirror-contract';
import { mirrorBodyField } from '@docket/connections/notion/mirror-schema';
import type { MirrorChange, NotionMirrorPort } from '@docket/connections/notion/mirror-port';
import { isProviderAuthError } from '@docket/connections/provider-error';
import {
  type MirrorReferences,
  type MirrorValue,
  projectRow,
  readMirrorProperties,
  resolveMirrorValues,
} from '@docket/connections/notion/mirror-values';

import type { MirrorEntityRecord } from './notion-mirror-entities';
import type { MirrorLocalRow } from './notion-mirror-plan';

/**
 * Hash one stable sync value without exposing its content in durable sync state.
 *
 * @param value - Any JSON-serializable value.
 * @returns a 32-character hex digest.
 */
export function syncHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

/**
 * Hash each field separately, so body-only edits are distinguishable from table-property edits.
 *
 * @param values - Resolved field values.
 * @returns field key to value hash, in key order.
 */
export function propertyAnchors(
  values: Readonly<Record<string, MirrorValue>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([field, value]) => [field, syncHash(value)]),
  );
}

/**
 * The long-form Docket text that lives in a Notion page body for this record.
 *
 * @param entity - The mirrored entity kind.
 * @param record - The Docket record.
 * @returns the Markdown body, `''` for an empty one, or `undefined` when the entity has no body.
 */
export function pageBody(
  entity: NotionMirrorEntity,
  record: MirrorEntityRecord,
): string | undefined {
  const field = mirrorBodyField(entity);
  if (field === undefined) return undefined;
  const value = record.values[field];
  return value?.kind === 'text' ? (value.value ?? '') : undefined;
}

/** Everything one Docket record contributes to its Notion page, and the hashes that track it. */
export interface RecordSyncState {
  /** The record's values with references resolved to Notion ids. */
  readonly resolved: ReturnType<typeof resolveMirrorValues>;
  /** The Notion properties those values project to. */
  readonly projected: ReturnType<typeof projectRow>;
  /** The Markdown page body, when the entity has one. */
  readonly body: string | undefined;
  /** The hash of {@link RecordSyncState.body}, or null when the entity has no body. */
  readonly bodyHash: string | null;
  /** The hash of properties and body together: what a mirror row's `contentHash` stores. */
  readonly contentHash: string;
  /** Per-field value hashes for field-level conflict merging. */
  readonly anchors: Record<string, string>;
}

/**
 * Derive a record's projected page and its sync hashes.
 *
 * @remarks
 * Every path that stores or compares `contentHash` must use this, so a pull-back and a projection
 * never disagree about whether a row changed. A properties-only hash here would make every row
 * look locally edited to the pull, turning a Notion-side edit into a push that overwrites it.
 *
 * @param entity - The mirrored entity kind.
 * @param bindings - The design's columns.
 * @param record - The Docket record.
 * @param refs - The pass's reference maps.
 * @returns the projection, body and hashes.
 */
export function recordSyncState(
  entity: NotionMirrorEntity,
  bindings: readonly NotionColumnBinding[],
  record: MirrorEntityRecord,
  refs: MirrorReferences,
): RecordSyncState {
  const resolved = resolveMirrorValues(bindings, record.values, refs);
  const projected = projectRow(bindings, resolved.values);
  const body = pageBody(entity, record);
  const bodyHash = body === undefined ? null : syncHash(body);
  return {
    resolved,
    projected,
    body,
    bodyHash,
    contentHash: syncHash({ properties: projected.contentHash, bodyHash }),
    anchors: propertyAnchors(resolved.values),
  };
}

/**
 * The `contentHash` a mirror row stores for a record: its projected properties and page body.
 *
 * @param entity - The mirrored entity kind.
 * @param bindings - The design's columns.
 * @param record - The Docket record.
 * @param refs - The pass's reference maps.
 * @returns the stable content hash.
 */
export function mirrorContentHash(
  entity: NotionMirrorEntity,
  bindings: readonly NotionColumnBinding[],
  record: MirrorEntityRecord,
  refs: MirrorReferences,
): string {
  return recordSyncState(entity, bindings, record, refs).contentHash;
}

/** A page body read, or `undefined` when the entity has no page body. */
export type PageBodyRead =
  | {
      readonly state: 'complete';
      readonly markdown: string;
      readonly unknownBlockIds: readonly string[];
    }
  | { readonly state: 'truncated' | 'inaccessible'; readonly unknownBlockIds: readonly string[] }
  | undefined;

/**
 * Read page content without confusing an authorization failure with an empty page.
 *
 * @param mirror - The Notion mirror port.
 * @param entity - The mirrored entity kind.
 * @param pageId - The Notion page.
 * @returns the body read, or `undefined` when the entity has no page body.
 * @throws When Notion fails for any reason other than missing content access.
 */
export async function readPageBody(
  mirror: NotionMirrorPort,
  entity: NotionMirrorEntity,
  pageId: string,
): Promise<PageBodyRead> {
  if (mirrorBodyField(entity) === undefined) return undefined;
  try {
    const content = await mirror.readPageContent(pageId);
    return content.state === 'complete'
      ? content
      : { state: content.state, unknownBlockIds: content.unknownBlockIds };
  } catch (error) {
    if (isProviderAuthError(error)) return { state: 'inaccessible', unknownBlockIds: [] };
    throw error;
  }
}

/** The values a pull applies from one changed Notion row, and what its page body read returned. */
export interface PulledRow {
  /** Field values from the row's properties, with the page body in the body field. */
  readonly values: Record<string, MirrorValue>;
  /** Field values from the row's properties alone, including any legacy Description column. */
  readonly properties: Record<string, MirrorValue>;
  /** The body read result, or `undefined` when the entity has no page body. */
  readonly pageContent: PageBodyRead;
}

/**
 * Read a changed Notion row's properties and page body into the values a pull applies.
 *
 * @remarks
 * A complete body becomes the entity's body field. When the body is truncated or unreadable, the
 * body field is left out of `values`: a legacy Description column is a clipped copy and must not
 * replace the full description Docket already holds. `properties` keeps it for a new record, which
 * has no description to protect.
 *
 * @param mirror - The Notion mirror port.
 * @param entity - The entity kind being pulled.
 * @param bindings - The design's columns.
 * @param change - The changed Notion row.
 * @returns the values to apply and the body read result.
 */
export async function readPulledRow(
  mirror: NotionMirrorPort,
  entity: NotionMirrorEntity,
  bindings: readonly NotionColumnBinding[],
  change: Pick<MirrorChange, 'externalPageId' | 'properties'>,
): Promise<PulledRow> {
  const properties = readMirrorProperties(bindings, change.properties);
  const bodyField = mirrorBodyField(entity);
  const pageContent = await readPageBody(mirror, entity, change.externalPageId);
  if (bodyField === undefined || pageContent === undefined) {
    return { values: properties, properties, pageContent };
  }
  const values = Object.fromEntries(
    Object.entries(properties).filter(([field]) => field !== bodyField),
  );
  if (pageContent.state === 'complete') {
    values[bodyField] = { kind: 'text', value: pageContent.markdown };
  }
  return { values, properties, pageContent };
}

/** The `notion_mirror_row` columns that record the outcome of a page body read or write. */
export interface BodyStateColumns {
  /** Whether Docket holds the page's complete body. */
  readonly bodyState?: 'complete' | 'truncated' | 'inaccessible';
  /** Blocks Notion could not represent as Markdown. */
  readonly bodyUnknownBlockIds?: string[];
}

/**
 * The row columns to record for a page body read or write.
 *
 * @param outcome - The read or write result, or `undefined` when no body was read or written.
 * @returns the columns to set, empty when there is nothing to record.
 */
export function bodyStateColumns(
  outcome: Pick<Exclude<PageBodyRead, undefined>, 'state' | 'unknownBlockIds'> | undefined,
): BodyStateColumns {
  if (outcome === undefined) return {};
  return { bodyState: outcome.state, bodyUnknownBlockIds: [...outcome.unknownBlockIds] };
}

/** A contested push: Docket's record, the stored mirror row, and what Notion held when it lost. */
export interface ContestedRow {
  /** The mirrored entity kind. */
  readonly entity: NotionMirrorEntity;
  /** The design's columns. */
  readonly bindings: readonly NotionColumnBinding[];
  /** The pass's reference maps. */
  readonly refs: MirrorReferences;
  /** Docket's current record. */
  readonly record: MirrorEntityRecord;
  /** The stored anchors from Docket's last sync of this row. */
  readonly anchors: Pick<MirrorLocalRow, 'propertyAnchors' | 'bodyHash'>;
  /** Notion's property values. */
  readonly remoteValues: Readonly<Record<string, MirrorValue>>;
  /** Notion's page body read. */
  readonly remoteContent: PageBodyRead;
}

/**
 * The fields Notion changed and Docket did not, on a row both sides edited.
 *
 * @remarks
 * Docket wins a field both sides changed. A field only Notion changed is kept, so a contested push
 * does not discard it. The page body is compared by its own hash; a legacy Description column is a
 * clipped copy and never merges into the body field.
 *
 * @param contested - The contested row.
 * @returns the remote-only values to apply before pushing.
 */
export function remoteOnlyChanges(contested: ContestedRow): Record<string, MirrorValue> {
  const { entity, bindings, refs, record, anchors, remoteValues, remoteContent } = contested;
  const bodyField = mirrorBodyField(entity);
  const localAnchors = propertyAnchors(resolveMirrorValues(bindings, record.values, refs).values);
  const remoteOnly: Record<string, MirrorValue> = {};
  for (const [field, remoteValue] of Object.entries(remoteValues)) {
    if (field === bodyField) continue;
    const anchor = anchors.propertyAnchors?.[field];
    if (syncHash(remoteValue) !== anchor && localAnchors[field] === anchor) {
      remoteOnly[field] = remoteValue;
    }
  }
  if (bodyField === undefined || remoteContent?.state !== 'complete') return remoteOnly;
  const remoteChanged = syncHash(remoteContent.markdown) !== anchors.bodyHash;
  const localChanged = syncHash(pageBody(entity, record) ?? '') !== anchors.bodyHash;
  if (remoteChanged && !localChanged) {
    remoteOnly[bodyField] = { kind: 'text', value: remoteContent.markdown };
  }
  return remoteOnly;
}

/**
 * Replace a page body while preserving property sync when this connection lacks content access.
 *
 * @remarks
 * An empty body is written only over a body Docket wrote before. Pages whose body Docket has never
 * written — new pages, and pages that predate page-body sync — may hold content someone wrote in
 * Notion, and replacing it with nothing would delete it.
 *
 * A 400 is Notion declining to replace this page's content as it stands, for example because it
 * holds sub-pages. The page is left as it is and recorded `truncated`, the state for a body Docket
 * does not hold in full, so the unchanged-row retry leaves it alone and the next edit tries again.
 *
 * @param mirror - The Notion mirror port.
 * @param entity - The mirrored entity kind.
 * @param pageId - The Notion page.
 * @param markdown - Docket's body, or `undefined` when the entity has none.
 * @param previousBodyHash - The body hash stored for the page, or null/undefined when none was.
 * @returns the write result, or `undefined` when nothing was written.
 * @throws When Notion fails for any reason other than missing access or a refused replacement.
 */
export async function writePageBody(
  mirror: NotionMirrorPort,
  entity: NotionMirrorEntity,
  pageId: string,
  markdown: string | undefined,
  previousBodyHash: string | null | undefined,
): Promise<Awaited<ReturnType<NotionMirrorPort['writePageContent']>> | undefined> {
  if (markdown === undefined || mirrorBodyField(entity) === undefined) return undefined;
  if (markdown === '' && (previousBodyHash ?? null) === null) return undefined;
  try {
    return await mirror.writePageContent(pageId, markdown);
  } catch (error) {
    if (isProviderAuthError(error)) {
      return { markdown, state: 'inaccessible', unknownBlockIds: [] };
    }
    if (isRefusedReplacement(error)) return { markdown, state: 'truncated', unknownBlockIds: [] };
    throw error;
  }
}

/** Whether Notion declined a content replacement as invalid for the page as it stands. */
function isRefusedReplacement(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 400;
}
