/**
 * `@docket/api` — shared types for the search query service.
 *
 * @remarks
 * A true leaf: every module under `search/`, including `query.ts` itself, depends on the
 * row/caller/param shapes declared here, and this file depends on nothing else in the directory —
 * only the DB schema and the public API contract.
 */
import type { searchDocument } from '@docket/db';

import type { SearchOut } from '../contracts/search';

/**
 * Who is searching.
 *
 * @remarks
 * A human searches as a `user`, which reaches their own private documents and the activity they
 * are a recipient of, across every org they belong to. An `agent` searches as a single org-scoped
 * Actor: it has grants, but no personal document scope at all, so `user_private` rows and
 * recipient-only activity are invisible to it rather than matched against a stand-in id.
 */
export type SearchCaller =
  { kind: 'user'; userId: string } | { kind: 'agent'; actorId: string; organizationId: string };

/** Minimal request-cancellation shape used without adding browser library types to the API. */
export interface SearchAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
}

/** The query/filter parameters {@link searchWorkspace} accepts — shared by every module that
 * reads or filters against them, rather than each redeclaring the shape. */
export interface SearchQueryParams {
  /** Absent or blank selects browse mode: the same corpus, ordered by recency. */
  q?: string | undefined;
  limit?: number;
  cursor?: string | undefined;
  families?: readonly string[];
  kinds?: readonly string[];
  sources?: readonly string[];
  orgIds?: readonly string[];
  ownerIds?: readonly string[];
  assigneeIds?: readonly string[];
  labelIds?: readonly string[];
  ids?: readonly string[];
  statuses?: readonly string[];
  healths?: readonly string[];
  activeOrgId?: string | undefined;
  surface?: 'page' | 'palette';
  from?: string | undefined;
  to?: string | undefined;
  includeArchived?: boolean;
}

/** One raw `search_document` row, before scoring or filtering, plus the full-text rank the
 * ranked-search scan attaches to it (`0` for rows browse mode never full-text-matched). */
export type SearchDocumentRow = typeof searchDocument.$inferSelect & { textRank: number };

/** A candidate row paired with its relevance score and the snippet match that produced it. */
export interface ScoredRow {
  row: SearchDocumentRow;
  score: number;
  sortTime: number;
  matchedFields: SearchOut['items'][number]['matchedFields'];
  snippetMatch: SnippetMatch | null;
}

/**
 * Which raw field a snippet should be drawn from, and the exact substring that made it match.
 *
 * @remarks
 * Picking the field is a cheap `.includes()` check and runs for every scored candidate. Turning it
 * into reader-facing text (`snippetText`) is the expensive part — it strips Markdown — so it stays
 * deferred until a row has actually survived pagination; see `pickSnippetMatch` in
 * `query-scoring.ts`.
 */
export interface SnippetMatch {
  readonly value: string;
  /** The matched substring, kept visible when `value` gets excerpted; `''` when nothing specific
   * matched and `value` is just a fallback to show something. */
  readonly term: string;
}
