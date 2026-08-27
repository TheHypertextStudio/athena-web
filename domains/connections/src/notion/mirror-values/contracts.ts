/** Shared types for pure Notion mirror value resolution and payload projection. */
import type { NotionMirrorEntity } from '../mirror-contract';

/** A Docket value ready to write to or read from a Notion property. */
export type MirrorValue =
  | { readonly kind: 'text'; readonly value: string | null }
  | { readonly kind: 'number'; readonly value: number | null }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'date'; readonly value: string | null }
  | { readonly kind: 'option'; readonly value: string | null }
  | { readonly kind: 'people'; readonly externalIds: readonly string[] }
  | { readonly kind: 'relation'; readonly externalPageIds: readonly string[] }
  | { readonly kind: 'url'; readonly value: string | null };

/** A Docket actor before a mirror column's person representation is resolved. */
export interface MirrorActorValue {
  /** Discriminates actor references from Notion-ready values. */
  readonly kind: 'actor';
  /** The actor to resolve, or null when the field is explicitly empty. */
  readonly actorId: string | null;
  /** The safe text representation when the column is not a relation or native person. */
  readonly displayName: string | null;
}

/** A relation to other Docket records before their projected Notion page ids are known. */
export interface MirrorReferenceValue {
  /** Discriminates relation references from Notion-ready values. */
  readonly kind: 'reference';
  /** The type of entity whose projected page is needed. */
  readonly entity: NotionMirrorEntity;
  /** One or more Docket ids to resolve. */
  readonly entityIds: readonly string[];
}

/**
 * What a database loader produces.
 *
 * References remain wider than MirrorValue so a caller cannot project a row without first
 * resolving its person and relation values.
 */
export type MirrorSourceValue = MirrorValue | MirrorActorValue | MirrorReferenceValue;

/** Pages projected for one entity type during the current mirror pass. */
export interface MirrorEntityPages {
  /** Docket entity id to external Notion page id. */
  readonly pageByEntityId: ReadonlyMap<string, string>;
  /** Whether a missing page is final rather than deferred to a future pass. */
  readonly settled: boolean;
}

/** Lookups needed to resolve actor and relation references for a mirror pass. */
export interface MirrorReferences {
  /** Docket actor id to native Notion user id for known workspace members only. */
  readonly notionUserByActor: ReadonlyMap<string, string>;
  /** Projected pages by entity kind. No entry means the entity is not projected. */
  readonly pages: ReadonlyMap<NotionMirrorEntity, MirrorEntityPages>;
}

/** Why a reference could not be written. */
export type MirrorUnresolvedReason =
  'no_notion_account' | 'person_page_missing' | 'related_page_missing' | 'related_page_impossible';

/** One unresolved reference and whether later work can fix it. */
export interface MirrorUnresolvedRef {
  /** The source field that could not be written. */
  readonly field: string;
  /** The actor or entity id that could not resolve. */
  readonly targetId: string;
  /** The reason resolution did not produce a page or user id. */
  readonly reason: MirrorUnresolvedReason;
  /** Whether a later projection pass can resolve the reference. */
  readonly retryable: boolean;
}

/** Notion-ready values plus every reference that did not resolve. */
export interface ResolvedMirrorValues {
  /** Values safe to send into the payload projector. */
  readonly values: Readonly<Record<string, MirrorValue>>;
  /** Missing references, including their retry behavior. */
  readonly unresolved: readonly MirrorUnresolvedRef[];
}

/** Something removed to remain inside a Notion request limit. */
export interface MirrorTruncation {
  /** The field whose payload was trimmed. */
  readonly field: string;
  /** The Notion limit that applied. */
  readonly limit: 'text' | 'relation';
  /** Number of characters or relation targets removed. */
  readonly dropped: number;
}

/** The projected payload for one Notion page. */
export interface ProjectedRow {
  /** Payload keyed by Notion property id, never by mutable title. */
  readonly properties: Record<string, unknown>;
  /** Stable digest of the exact projected payload. */
  readonly contentHash: string;
  /** Every value that had to be truncated to fit Notion's limits. */
  readonly truncations: readonly MirrorTruncation[];
}
