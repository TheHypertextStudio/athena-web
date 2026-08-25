import type { Database } from '@docket/db';
import { WorkViewQueryResponse, type WorkViewQueryRequest } from '@docket/types';
import type { ViewTarget } from '@docket/work/view-contract';
import { and, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { ApiError } from '../../error';
import { rawResultRows } from '../raw-result';
import { compileRosterCtes, type WorkViewSqlContext } from './context-sql';
import { decodeWorkViewCursor, encodeWorkViewCursor, fingerprintWorkViewQuery } from './cursor';
import { WORK_VIEW_SQL_CONTRACTS } from './contracts';
import {
  compileFilterSql,
  type ExecutableFilterNode,
  type FilterFieldCompiler,
} from './filter-sql';
import { compileGroupJsonSql, compileGroupPathSql } from './group-query-sql';
import { manualRankExpression, transportWorkViewRow } from './projection-sql';
import {
  compileKeysetSql,
  compileSortSql,
  sortValueExpressions,
  validateSortTuple,
  type ExecutableSortTerm,
  type SortFieldCompiler,
} from './sort-sql';

/** Inputs for one permission-scoped work-view page query. */
export interface QueryWorkViewInput {
  /** Database or transaction that owns the query. */
  readonly database: Database;
  /** Current organization boundary from the route. */
  readonly organizationId: string;
  /** Current actor in that organization. */
  readonly actorId: string;
  /** Target-validated work-view request. */
  readonly request: WorkViewQueryRequest;
  /** Materialized primary and subgroup keys for a grouped page. */
  readonly groupPath?: readonly string[];
  /** Clock used to resolve relative temporal operands. */
  readonly now?: Date;
  /** IANA timezone used to resolve calendar operands. */
  readonly timeZone?: string;
}

interface InternalRequest {
  readonly target: ViewTarget;
  readonly definition: {
    readonly filter: ExecutableFilterNode | null;
    readonly arrangement: {
      readonly groupBy: string | null;
      readonly subGroupBy: string | null;
      readonly orderBy: readonly ExecutableSortTerm<string>[];
    };
  };
  readonly temporaryFilter: ExecutableFilterNode | null;
  readonly search?: string;
  readonly context: WorkViewSqlContext;
  readonly groupPath: readonly string[];
  readonly cursor?: string | null;
  readonly limit: number;
}

const cursorScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const callerRowSchema = z.object({ user_id: z.string().nullable() }).loose();
const workViewPageRecordSchema = z
  .object({
    id: z.string(),
    _cursor_sort_tuple: z.array(cursorScalarSchema),
  })
  .loose();
const workViewAggregateRecordSchema = z
  .object({
    rows: z.array(workViewPageRecordSchema),
    groups: z.array(z.record(z.string(), z.unknown())),
    total_count: z.number().int().nonnegative(),
  })
  .loose();

async function executeRows<TSchema extends z.ZodType>(
  database: Database,
  query: SQL,
  rowSchema: TSchema,
): Promise<z.output<TSchema>[]> {
  const result: unknown = await database.execute(query);
  return z.array(rowSchema).parse(rawResultRows<unknown>(result));
}

function filterSql(
  request: InternalRequest,
  fields: Readonly<Record<string, FilterFieldCompiler>>,
  actorId: string,
  now: Date,
  timeZone: string,
): SQL {
  const searchField = request.target === 'task' ? 'title' : 'name';
  const searchFilter: ExecutableFilterNode | null = request.search
    ? {
        kind: 'all',
        children: request.search.split(/\s+/).map((term) => ({
          kind: 'predicate',
          field: searchField,
          operator: 'contains',
          operand: term,
        })),
      }
    : null;
  const filters = [request.definition.filter, request.temporaryFilter, searchFilter]
    .filter((value): value is ExecutableFilterNode => value !== null)
    .map((filter) => compileFilterSql(filter, fields, { currentActorId: actorId, now, timeZone }));
  return and(...filters) ?? sql`true`;
}

function internalRequest(request: WorkViewQueryRequest): InternalRequest {
  return {
    target: request.target,
    definition: request.definition,
    temporaryFilter: request.temporaryFilter,
    ...(request.search !== undefined ? { search: request.search } : {}),
    context: z.object({ kind: z.string() }).loose().parse(request.context),
    groupPath: request.groupPath ?? [],
    limit: request.limit,
    ...(request.cursor !== undefined ? { cursor: request.cursor } : {}),
  };
}

function initiativePageCtes(ctes: SQL, groupScope: SQL, organizationId: string): SQL {
  return sql`${ctes}, page_direct as materialized (
      select e.* from direct e where ${groupScope}
    ), page_ancestor_ids(id) as (
      select d.id from page_direct d
      union
      select h.parent_initiative_id
      from initiative_hierarchy_link h
      join page_ancestor_ids a on a.id=h.child_initiative_id
      join authorized parent on parent.id=h.parent_initiative_id
      where h.context_organization_id=${organizationId}
    ), page_matched as materialized (
      select e.*, not exists(select 1 from page_direct d where d.id=e.id) as _is_context
      from authorized e join page_ancestor_ids a on a.id=e.id
    )`;
}

function orderingContextId(context: WorkViewSqlContext, organizationId: string): string {
  return context.kind === 'organization'
    ? organizationId
    : String(
        context['teamId'] ??
          context['projectId'] ??
          context['programId'] ??
          context['initiativeId'],
      );
}

/**
 * Execute one bounded, permission-scoped, target-specific work-view page.
 *
 * @param input - Database, authenticated scope, and validated request.
 * @returns The transport response with distinct counts, groups, and keyset continuation.
 * @throws ApiError when a cursor does not belong to this execution or sort definition.
 */
export async function queryWorkView(input: QueryWorkViewInput): Promise<WorkViewQueryResponse> {
  const request = internalRequest(input.request);
  const contract = WORK_VIEW_SQL_CONTRACTS[request.target];
  const sortTerms = request.definition.arrangement.orderBy;
  const manualRank = {
    value: manualRankExpression(),
    cursor: z.string().nullable(),
  };
  const baseSorts: Readonly<Record<string, SortFieldCompiler>> = contract.sorts;
  const priority = baseSorts['priority'];
  const sorts: Readonly<Record<string, SortFieldCompiler>> =
    priority && sortTerms.some((term) => term.field === 'priority')
      ? {
          ...baseSorts,
          priority: {
            value: manualRank.value,
            cursor: manualRank.cursor,
            /* v8 ignore next -- @preserve Every priority compiler defines semantic ranks. */
            semanticRanks: [...(priority.semanticRanks ?? []), priority.value],
            /* v8 ignore next -- @preserve Every priority compiler defines cursor schemas. */
            semanticCursorSchemas: [...(priority.semanticCursorSchemas ?? []), priority.cursor],
            valueDirection: 'asc',
          },
        }
      : baseSorts;
  const groupPath = input.groupPath ?? request.groupPath;
  const suppliedCursor =
    request.cursor !== undefined && request.cursor !== null
      ? decodeWorkViewCursor(request.cursor, undefined, groupPath)
      : null;
  if (suppliedCursor) {
    try {
      validateSortTuple(sortTerms, sorts, suppliedCursor.sortTuple, manualRank);
    } catch {
      throw new ApiError(400, 'validation_error', 'This page cursor does not match the view sort');
    }
  }
  const asOf = suppliedCursor?.asOf ?? (input.now ?? new Date()).toISOString();
  const timeZone = input.timeZone ?? 'UTC';
  const callerRows = await executeRows(
    input.database,
    sql`select user_id from actor
      where id=${input.actorId} and organization_id=${input.organizationId}
        and kind='human' and status='active' and archived_at is null`,
    callerRowSchema,
  );
  const execution = {
    organizationId: input.organizationId,
    actorId: input.actorId,
    userId: callerRows[0]?.user_id ?? null,
    timeZone,
    asOf,
  };
  const fields: Readonly<Record<string, FilterFieldCompiler>> = contract.filters;
  const filter = filterSql(request, fields, input.actorId, new Date(asOf), timeZone);
  const ctes = compileRosterCtes(
    request.target,
    request.context,
    input.organizationId,
    input.actorId,
    execution.userId,
    filter,
  );
  const fingerprint = fingerprintWorkViewQuery(input.request, execution);
  const cursor = request.cursor
    ? decodeWorkViewCursor(request.cursor, fingerprint, groupPath)
    : null;
  const sortValues = sortValueExpressions(sortTerms, sorts, manualRank);
  const keyset = cursor
    ? compileKeysetSql(sortTerms, sorts, cursor.sortTuple, sql`e.id`, cursor.entityId, manualRank)
    : sql`true`;
  const order = compileSortSql(sortTerms, sorts, sql`e.id`, manualRank);
  const pageLimit = Math.min(request.limit, 100);
  const groupScope = compileGroupPathSql(
    request.target,
    request.definition.arrangement.groupBy,
    request.definition.arrangement.subGroupBy,
    groupPath,
  );
  const scopedInitiativePage = request.target === 'initiative' && groupPath.length > 0;
  const pageCtes = scopedInitiativePage
    ? initiativePageCtes(ctes, groupScope, input.organizationId)
    : ctes;
  const pageSource = scopedInitiativePage ? 'page_matched' : 'matched';
  const pageScope = scopedInitiativePage ? sql`true` : groupScope;
  const countSource = request.target === 'initiative' ? 'direct' : 'matched';
  const groupJson = compileGroupJsonSql(
    request.target,
    request.definition.arrangement.groupBy,
    request.definition.arrangement.subGroupBy,
    countSource,
  );
  const aggregateRows = await executeRows(
    input.database,
    sql`with recursive ${pageCtes}, contextual_order as materialized (
      select item_id, rank from work_item_order
      where organization_id=${input.organizationId}
        and context_type=${request.context.kind}
        and context_id=${orderingContextId(request.context, input.organizationId)}
        and target=${request.target}
    ), page_candidates as not materialized (
      select e.*, ranked.rank as _manual_rank from contextual_order ranked
      join ${sql.raw(pageSource)} e on e.id=ranked.item_id
      where ${pageScope}
      union all
      select e.*, null::text as _manual_rank from ${sql.raw(pageSource)} e
      where ${pageScope} and not exists (
        select 1 from contextual_order ranked where ranked.item_id=e.id
      )
    ), page_selection as materialized (
      select e.id, e._is_context, e._manual_rank,
        json_build_array(${sql.join(sortValues, sql`, `)}) as _cursor_sort_tuple,
        row_number() over (order by ${sql.join(order, sql`, `)}) as _page_order
      from page_candidates e where ${keyset}
      order by ${sql.join(order, sql`, `)} limit ${pageLimit + 1}
    ), projectable as not materialized (
      select e.*, selected._is_context, selected._manual_rank,
        selected._cursor_sort_tuple, selected._page_order
      from authorized e join page_selection selected on selected.id=e.id
    ), page_data as materialized (
      select ${contract.projection(request.context, execution)},
        e._cursor_sort_tuple, e._page_order from projectable e
    )
    select coalesce((select json_agg(page_data order by page_data._page_order) from page_data), '[]'::json) rows,
      (select count(*)::int from ${sql.raw(countSource)} e) total_count,
      ${groupJson} groups`,
    workViewAggregateRecordSchema,
  );
  const aggregate = aggregateRows[0];
  /* v8 ignore next -- @preserve A SELECT of SQL aggregates always returns exactly one row. */
  if (!aggregate) throw new TypeError('A work-view aggregate query returned no row.');
  const hasMore = aggregate.rows.length > pageLimit;
  const pageRows = aggregate.rows.slice(0, pageLimit);
  const last = pageRows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeWorkViewCursor({
          fingerprint,
          groupPath,
          sortTuple: last._cursor_sort_tuple,
          entityId: last.id,
          asOf,
        })
      : null;
  return WorkViewQueryResponse.parse({
    target: request.target,
    rows: pageRows.map((row) =>
      contract.rowSchema.parse(transportWorkViewRow(request.target, row)),
    ),
    groups: aggregate.groups,
    totalCount: aggregate.total_count,
    nextCursor,
    queryFingerprint: fingerprint,
  });
}
