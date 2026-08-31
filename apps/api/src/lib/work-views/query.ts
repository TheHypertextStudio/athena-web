import type { Database } from '@docket/db';
import { WorkViewQueryResponse, type WorkViewQueryRequest } from '@docket/work/work-view-contract';
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

interface PageSqlInput {
  readonly initiative: boolean;
  readonly groupScope: SQL;
  readonly keyset: SQL;
  readonly order: readonly SQL[];
  readonly organizationId: string;
  readonly pageLimit: number;
  readonly sortValues: readonly SQL[];
}

interface PageSql {
  readonly aggregate: SQL;
  readonly ctes: SQL;
}

const cursorScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const callerRowSchema = z.object({ user_id: z.string().nullable() }).loose();
const workViewPageRecordSchema = z
  .object({
    id: z.string(),
    _cursor_sort_tuple: z.array(cursorScalarSchema).nullable(),
  })
  .loose();
const workViewAggregateRecordSchema = z
  .object({
    rows: z.array(workViewPageRecordSchema),
    groups: z.array(z.record(z.string(), z.unknown())),
    total_count: z.number().int().nonnegative(),
    has_more: z.boolean().optional(),
    last_direct: workViewPageRecordSchema.nullable().optional(),
  })
  .loose();
type WorkViewAggregateRecord = z.output<typeof workViewAggregateRecordSchema>;

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

function pageSql(input: PageSqlInput): PageSql {
  if (!input.initiative) {
    return {
      ctes: sql`page_candidates as not materialized (
          select e.*, ranked.rank as _manual_rank from contextual_order ranked
          join matched e on e.id=ranked.item_id
          where ${input.groupScope}
          union all
          select e.*, null::text as _manual_rank from matched e
          where ${input.groupScope} and not exists (
            select 1 from contextual_order ranked where ranked.item_id=e.id
          )
        ), page_selection as materialized (
          select e.id, e._is_context, e._manual_rank,
            json_build_array(${sql.join(input.sortValues, sql`, `)}) as _cursor_sort_tuple,
            row_number() over (order by ${sql.join(input.order, sql`, `)}) as _page_order
          from page_candidates e where ${input.keyset}
          order by ${sql.join(input.order, sql`, `)} limit ${input.pageLimit + 1}
        )`,
      aggregate: sql``,
    };
  }
  return {
    ctes: sql`direct_page_candidates as not materialized (
        select e.*, ranked.rank as _manual_rank from contextual_order ranked
        join direct e on e.id=ranked.item_id
        where ${input.groupScope}
        union all
        select e.*, null::text as _manual_rank from direct e
        where ${input.groupScope} and not exists (
          select 1 from contextual_order ranked where ranked.item_id=e.id
        )
      ), direct_page_selection as materialized (
        select e.id, e._manual_rank,
          json_build_array(${sql.join(input.sortValues, sql`, `)}) as _cursor_sort_tuple,
          row_number() over (order by ${sql.join(input.order, sql`, `)}) as _page_order
        from direct_page_candidates e where ${input.keyset}
        order by ${sql.join(input.order, sql`, `)} limit ${input.pageLimit + 1}
      ), selected_direct as materialized (
        select * from direct_page_selection where _page_order <= ${input.pageLimit}
      ), page_ancestor_ids(id) as (
        select d.id from selected_direct d
        union
        select h.parent_initiative_id
        from initiative_hierarchy_link h
        join page_ancestor_ids a on a.id=h.child_initiative_id
        where h.context_organization_id=${input.organizationId}
      ), page_selection as materialized (
        select d.id, false as _is_context, d._manual_rank,
          d._cursor_sort_tuple, d._page_order
        from selected_direct d
        union all
        select e.id, true as _is_context, null::text as _manual_rank,
          null::json as _cursor_sort_tuple, 0::bigint as _page_order
        from authorized e join page_ancestor_ids a on a.id=e.id
        where not exists (select 1 from selected_direct d where d.id=e.id)
      )`,
    aggregate: sql`, (select exists(
        select 1 from direct_page_selection where _page_order > ${input.pageLimit}
      )) has_more,
      (select json_build_object('id', d.id, '_cursor_sort_tuple', d._cursor_sort_tuple)
        from selected_direct d order by d._page_order desc limit 1) last_direct`,
  };
}

function resolvePage(
  initiative: boolean,
  aggregate: WorkViewAggregateRecord,
  pageLimit: number,
): {
  readonly hasMore: boolean;
  readonly last: WorkViewAggregateRecord['rows'][number] | undefined;
  readonly rows: WorkViewAggregateRecord['rows'];
} {
  if (initiative) {
    return {
      hasMore: aggregate.has_more === true,
      last: aggregate.last_direct ?? undefined,
      rows: aggregate.rows,
    };
  }
  const rows = aggregate.rows.slice(0, pageLimit);
  return { hasMore: aggregate.rows.length > pageLimit, last: rows.at(-1), rows };
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
  const isInitiativePage = request.target === 'initiative';
  const countSource = request.target === 'initiative' ? 'direct' : 'matched';
  const groupJson = compileGroupJsonSql(
    request.target,
    request.definition.arrangement.groupBy,
    request.definition.arrangement.subGroupBy,
    countSource,
  );
  const page = pageSql({
    initiative: isInitiativePage,
    groupScope,
    keyset,
    order,
    organizationId: input.organizationId,
    pageLimit,
    sortValues,
  });
  const rowOrder = isInitiativePage
    ? sql`page_data._page_order, page_data.id`
    : sql`page_data._page_order`;
  const aggregateRows = await executeRows(
    input.database,
    sql`with recursive ${ctes}, contextual_order as materialized (
      select item_id, rank from work_item_order
      where organization_id=${input.organizationId}
        and context_type=${request.context.kind}
        and context_id=${orderingContextId(request.context, input.organizationId)}
        and target=${request.target}
    ), ${page.ctes}, projectable as not materialized (
      select e.*, selected._is_context, selected._manual_rank,
        selected._cursor_sort_tuple, selected._page_order,
        display.subject_type as _display_subject_type,
        display.subject_id as _display_subject_id,
        display.icon_key as _display_icon_key,
        display.color_key as _display_color_key,
        display.custom_color as _display_custom_color,
        display.cover_image as _display_cover_image
      from authorized e
      join page_selection selected on selected.id=e.id
      left join entity_display display on display.organization_id=e.organization_id
        and display.subject_type=${request.target}
        and display.subject_id=e.id
    ), page_data as materialized (
      select ${contract.projection(request.context, execution)},
        e._cursor_sort_tuple, e._page_order from projectable e
    )
    select coalesce((select json_agg(page_data order by ${rowOrder}) from page_data), '[]'::json) rows,
      (select count(*)::int from ${sql.raw(countSource)} e) total_count,
      ${groupJson} groups${page.aggregate}`,
    workViewAggregateRecordSchema,
  );
  const aggregate = aggregateRows[0];
  /* v8 ignore next -- @preserve A SELECT of SQL aggregates always returns exactly one row. */
  if (!aggregate) throw new TypeError('A work-view aggregate query returned no row.');
  const pageResult = resolvePage(isInitiativePage, aggregate, pageLimit);
  const nextCursor =
    pageResult.hasMore && pageResult.last?._cursor_sort_tuple
      ? encodeWorkViewCursor({
          fingerprint,
          groupPath,
          sortTuple: pageResult.last._cursor_sort_tuple,
          entityId: pageResult.last.id,
          asOf,
        })
      : null;
  return WorkViewQueryResponse.parse({
    target: request.target,
    rows: pageResult.rows.map((row) =>
      contract.rowSchema.parse(transportWorkViewRow(request.target, row)),
    ),
    groups: aggregate.groups,
    totalCount: aggregate.total_count,
    nextCursor,
    queryFingerprint: fingerprint,
  });
}
