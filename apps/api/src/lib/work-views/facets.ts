import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Database } from '@docket/db';
import {
  WorkViewFacetResponse,
  type WorkViewFacetRequest,
  type WorkViewFacetResponse as WorkViewFacetResponseValue,
} from '@docket/work/work-view-contract';
import { and, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { ApiError } from '../../error';
import { rawResultRows } from '../raw-result';
import { compileAuthorizationSql } from './authorization-sql';
import { compileRosterCtes } from './context-sql';
import { WORK_VIEW_SQL_CONTRACTS } from './contracts';
import { fingerprintWorkViewQuery } from './cursor';
import {
  compileFilterSql,
  type ExecutableFilterNode,
  type FilterFieldCompiler,
} from './filter-sql';
import { compileGroupMembershipSql, type GroupFieldCompiler } from './group-sql';

const facetCursorPayload = z
  .object({
    target: z.enum(['task', 'project', 'program', 'initiative']),
    field: z.string(),
    search: z.string().nullable(),
    key: z.string(),
    asOf: z.iso.datetime(),
    fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict();

const callerRow = z.object({ user_id: z.string().nullable() }).loose();
const distinctRow = z.object({ count: z.number().int().nonnegative() }).loose();
const facetAggregate = z
  .object({
    options: z.array(
      z
        .object({ key: z.string(), label: z.string(), count: z.number().int().nonnegative() })
        .strict(),
    ),
    distinct_count: z.number().int().nonnegative(),
    empty_count: z.number().int().nonnegative(),
  })
  .loose();

function cursorKey(): string {
  const key = process.env['BETTER_AUTH_SECRET'];
  if (!key) throw new TypeError('BETTER_AUTH_SECRET is required for facet cursors.');
  return key;
}

function sign(value: string): string {
  return createHmac('sha256', cursorKey()).update(value).digest('base64url');
}

function encodeFacetCursor(payload: z.output<typeof facetCursorPayload>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `wvf2:${encoded}.${sign(encoded)}`;
}

function decodeFacetCursor(
  cursor: string,
  expected: { target: WorkViewFacetRequest['target']; field: string; search: string | null },
): z.output<typeof facetCursorPayload> {
  try {
    const match = /^wvf2:([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(cursor);
    if (!match?.[1] || !match[2]) throw new TypeError('malformed');
    const actual = Buffer.from(match[2]);
    const wanted = Buffer.from(sign(match[1]));
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
      throw new TypeError('signature');
    }
    const parsed = facetCursorPayload.parse(
      JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')),
    );
    if (
      parsed.target !== expected.target ||
      parsed.field !== expected.field ||
      parsed.search !== expected.search
    ) {
      throw new TypeError('scope');
    }
    return parsed;
  } catch {
    throw new ApiError(400, 'validation_error', 'This facet cursor does not match the request');
  }
}

async function executeOne<TSchema extends z.ZodType>(
  database: Database,
  statement: SQL,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  const result: unknown = await database.execute(statement);
  const rows = z.array(schema).parse(rawResultRows<unknown>(result));
  const row = rows[0];
  if (!row) throw new TypeError('A work-view facet query returned no row.');
  return row;
}

function removeFacetField(node: ExecutableFilterNode, field: string): ExecutableFilterNode | null {
  if (node.kind === 'predicate') return node.field === field ? null : node;
  if (node.kind === 'not') {
    const child = removeFacetField(node.child, field);
    return child ? { kind: 'not', child } : null;
  }
  const children = node.children
    .map((child) => removeFacetField(child, field))
    .filter((child): child is ExecutableFilterNode => child !== null);
  return children.length === 0 ? null : { kind: node.kind, children };
}

function activeFilter(
  request: WorkViewFacetRequest,
  field: string | null,
  actorId: string,
  asOf: Date,
  timeZone: string,
): SQL {
  const registry: Readonly<Record<string, FilterFieldCompiler>> =
    WORK_VIEW_SQL_CONTRACTS[request.target].filters;
  const inputs = [
    request.definition.filter,
    request.temporaryFilter,
  ] as readonly (ExecutableFilterNode | null)[];
  const filters = inputs
    .filter((value): value is ExecutableFilterNode => value !== null)
    .map((filter) => (field === null ? filter : removeFacetField(filter, field)))
    .filter((value): value is ExecutableFilterNode => value !== null)
    .map((filter) =>
      compileFilterSql(filter, registry, { currentActorId: actorId, now: asOf, timeZone }),
    );
  return and(...filters) ?? sql`true`;
}

function staticEnumCatalog(
  target: WorkViewFacetRequest['target'],
  field: string,
): readonly string[] {
  const catalogs: Readonly<Record<string, readonly string[]>> = {
    'task.priority': ['urgent', 'high', 'medium', 'low', 'none'],
    'project.priority': ['urgent', 'high', 'medium', 'low', 'none'],
    'initiative.priority': ['high', 'medium', 'low', 'none'],
    'project.health': ['off_track', 'at_risk', 'on_track'],
    'program.health': ['off_track', 'at_risk', 'on_track'],
    'initiative.health': ['off_track', 'at_risk', 'on_track'],
    'program.visibility': ['public', 'private'],
    'initiative.updateCadence': ['weekly', 'biweekly', 'monthly', 'quarterly', 'none'],
  };
  return catalogs[`${target}.${field}`] ?? [];
}

function initiativeRelationCatalog(
  field: string,
  organizationId: string,
  actorId: string,
  userId: string | null,
): SQL | null {
  switch (field) {
    case 'parent':
      return sql`select option.id::text key, option.name::text label
        from initiative_catalog option`;
    case 'owner':
      return sql`select option.id::text key, option.display_name::text label
        from initiative_catalog e
        join actor option on option.id=e.owner_id and option.organization_id=e.organization_id
        where option.status='active' and option.archived_at is null`;
    case 'leadTeam':
      return sql`select option.id::text key, option.name::text label
        from initiative_catalog e
        join team option on option.id=e.lead_team_id and option.organization_id=e.organization_id
        where option.archived_at is null`;
    case 'labels':
      return sql`select option.id::text key, option.name::text label
        from initiative_catalog e
        join initiative_label membership on membership.initiative_id=e.id
          and membership.organization_id=e.organization_id
        join label option on option.id=membership.label_id
          and option.organization_id=membership.organization_id
        where option.team_id is null or exists (
          select 1 from team_member team_membership
          join actor viewer on viewer.id=team_membership.actor_id
            and viewer.organization_id=team_membership.organization_id
          where team_membership.organization_id=option.organization_id
            and team_membership.team_id=option.team_id
            and viewer.kind='human' and viewer.status='active' and viewer.archived_at is null
            and ((viewer.id=${actorId} and viewer.organization_id=${organizationId})
              or (${userId}::text is not null and viewer.user_id=${userId}))
        )`;
    case 'organization':
      return sql`select option.id::text key, option.name::text label
        from initiative_catalog e
        join organization option on option.id=e.organization_id`;
    default:
      return null;
  }
}

function relationCatalog(
  target: WorkViewFacetRequest['target'],
  field: string,
  organizationId: string,
  actorId: string,
  userId: string | null,
): SQL | null {
  if (target === 'initiative') {
    const catalog = initiativeRelationCatalog(field, organizationId, actorId, userId);
    if (catalog) return catalog;
  }
  const relation = (
    table: string,
    labelColumn: string,
    extra: SQL = sql`true`,
  ): SQL => sql`select option.id::text key, option.${sql.raw(labelColumn)}::text label
      from ${sql.raw(table)} option
      where option.organization_id=${organizationId} and ${extra}`;
  const workRelation = (
    relationTarget: 'task' | 'project' | 'program' | 'initiative',
    table: string,
    labelColumn: string,
  ): SQL => sql`select e.id::text key, e.${sql.raw(labelColumn)}::text label
      from ${sql.raw(table)} e
      where e.organization_id=${organizationId}
        and ${compileAuthorizationSql(relationTarget, organizationId, actorId, userId)}`;
  const key = `${target}.${field}`;
  if (
    [
      'task.assignee',
      'task.delegate',
      'task.creator',
      'project.lead',
      'project.members',
      'project.creator',
      'program.owner',
      'program.creator',
      'initiative.owner',
    ].includes(key)
  ) {
    return relation(
      'actor',
      'display_name',
      sql`option.status='active' and option.archived_at is null`,
    );
  }
  if (['task.team', 'project.teams', 'initiative.leadTeam'].includes(key)) {
    return relation('team', 'name', sql`option.archived_at is null`);
  }
  if (key === 'task.project') return workRelation('project', 'project', 'name');
  if (['task.program', 'project.program'].includes(key)) {
    return workRelation('program', 'program', 'name');
  }
  if (key === 'task.cycle') {
    return sql`select option.id::text key,
        coalesce(option.name, 'Cycle ' || option.number::text)::text label
      from cycle option
      where option.organization_id=${organizationId}`;
  }
  if (key === 'task.milestone') return relation('milestone', 'name');
  if (key === 'task.parent') return workRelation('task', 'task', 'title');
  if (['project.initiatives', 'program.initiatives', 'initiative.parent'].includes(key)) {
    return workRelation('initiative', 'initiative', 'name');
  }
  if (['task.labels', 'project.labels', 'program.labels', 'initiative.labels'].includes(key)) {
    return relation(
      'label',
      'name',
      sql`(option.team_id is null or exists (
        select 1 from team_member membership
        where membership.organization_id=option.organization_id
          and membership.team_id=option.team_id and membership.actor_id=${actorId}
      ))`,
    );
  }
  if (key === 'initiative.organization') {
    return sql`select option.id::text key, option.name::text label from organization option
      where option.id=${organizationId}`;
  }
  return null;
}

function optionCatalog(input: {
  target: WorkViewFacetRequest['target'];
  field: string;
  organizationId: string;
  actorId: string;
  userId: string | null;
  search: string | null;
  cursorKey: string | null;
  limit: number;
}): SQL {
  const boundedRelation = (
    catalog: SQL,
  ): SQL => sql`select bounded_catalog.key, bounded_catalog.label
    from (
      select candidate.key, min(candidate.label)::text label
      from (${catalog}) candidate
      where (${input.search}::text is null or candidate.label ilike ('%' || ${input.search} || '%'))
        and (${input.cursorKey}::text is null or candidate.key > ${input.cursorKey})
      group by candidate.key
      order by candidate.key limit ${input.limit + 1}
    ) bounded_catalog`;
  if (input.field === 'status') {
    if (input.target === 'initiative') {
      return boundedRelation(sql`select option.key::text key, option.name::text label
          from initiative_catalog e
          join work_status option on option.id=e.status_id
            and option.organization_id=e.organization_id
            and option.entity_type='initiative'`);
    }
    return boundedRelation(sql`select option.key::text key, option.name::text label from work_status option
        where option.organization_id=${input.organizationId} and option.entity_type=${input.target}
          and (option.team_id is null or exists (
            select 1 from team_member membership
            where membership.organization_id=option.organization_id
              and membership.team_id=option.team_id and membership.actor_id=${input.actorId}
          ))`);
  }
  const relation = relationCatalog(
    input.target,
    input.field,
    input.organizationId,
    input.actorId,
    input.userId,
  );
  if (relation) return boundedRelation(relation);
  const values = staticEnumCatalog(input.target, input.field);
  if (values.length > 0) {
    return sql`select catalog.key::text key, catalog.key::text label
      from (values ${sql.join(
        values.map((value) => sql`(${value})`),
        sql`, `,
      )}) catalog(key)`;
  }
  const declarations = WORK_VIEW_SQL_CONTRACTS[input.target].contract.fields as Readonly<
    Record<string, { readonly kind: string }>
  >;
  const declaration = declarations[input.field];
  if (declaration?.kind === 'boolean') {
    return sql`select catalog.key::text key, catalog.key::text label
      from (values ('false'), ('true')) catalog(key)`;
  }
  return sql`select null::text key, null::text label where false`;
}

function optionValue(target: WorkViewFacetRequest['target'], field: string, key: string): unknown {
  const declarations = WORK_VIEW_SQL_CONTRACTS[target].contract.fields as Readonly<
    Record<
      string,
      { readonly kind: string; readonly schema: z.ZodType; readonly operandSchema?: z.ZodType }
    >
  >;
  const declaration = declarations[field];
  if (!declaration) throw new TypeError(`Unknown facet field: ${field}`);
  const operand = declaration.operandSchema ?? declaration.schema;
  const candidates: unknown[] = [];
  switch (declaration.kind) {
    case 'relation-one':
    case 'relation-many':
      candidates.push({ kind: 'actor', actorId: key }, key);
      break;
    case 'date':
    case 'datetime':
      candidates.push({ kind: 'absolute', value: key });
      break;
    case 'number':
      candidates.push(Number(key));
      break;
    case 'boolean':
      candidates.push(key === 'true');
      break;
    default:
      candidates.push(key);
  }
  for (const candidate of candidates) {
    const parsed = operand.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  throw new TypeError(`Facet option did not match ${target}.${field}.`);
}

function facetMembership(target: WorkViewFacetRequest['target'], field: string): SQL {
  const contract = WORK_VIEW_SQL_CONTRACTS[target];
  const declarations = contract.contract.fields as Readonly<
    Record<string, { readonly kind: string }>
  >;
  const declaration = declarations[field];
  const temporal = (value: SQL): SQL | null => {
    if (declaration?.kind === 'date') {
      return sql`to_char((${value})::timestamp, 'YYYY-MM-DD')`;
    }
    if (declaration?.kind === 'datetime') {
      return sql`to_char((${value})::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    }
    return null;
  };
  const groups: Readonly<Record<string, GroupFieldCompiler>> = contract.groups;
  const group = groups[field];
  if (group) {
    if (group.kind === 'scalar') {
      const normalized = temporal(group.key);
      if (normalized) {
        return compileGroupMembershipSql(
          { kind: 'scalar', key: normalized, label: normalized },
          sql`e.id`,
        );
      }
    }
    return compileGroupMembershipSql(group, sql`e.id`);
  }

  const filters: Readonly<Record<string, FilterFieldCompiler>> = contract.filters;
  const filter = filters[field];
  if (!filter || filter.kind === 'relation-many') {
    throw new ApiError(400, 'validation_error', 'This field cannot produce facet options');
  }
  const label =
    target === 'task' && field === 'parent'
      ? sql`(select parent.title from task parent where parent.id=(${filter.value})
          and parent.organization_id=e.organization_id)`
      : target === 'initiative' && field === 'parent'
        ? sql`(select parent.name from authorized parent where parent.id=(${filter.value}))`
        : filter.value;
  const normalized = temporal(filter.value);
  return compileGroupMembershipSql(
    { kind: 'scalar', key: normalized ?? filter.value, label: normalized ?? label },
    sql`e.id`,
  );
}

async function facetBucket(input: {
  database: Database;
  organizationId: string;
  actorId: string;
  userId: string | null;
  request: WorkViewFacetRequest;
  field: string;
  timeZone: string;
  asOf: string;
}) {
  const search = input.request.search ?? null;
  const cursor =
    input.request.cursor !== undefined
      ? decodeFacetCursor(input.request.cursor, {
          target: input.request.target,
          field: input.field,
          search,
        })
      : null;
  const asOf = input.asOf;
  const fingerprint = fingerprintWorkViewQuery(input.request, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    userId: input.userId,
    timeZone: input.timeZone,
    asOf,
  });
  if (cursor && cursor.fingerprint !== fingerprint) {
    throw new ApiError(400, 'validation_error', 'This facet cursor does not match the request');
  }
  const ctes = compileRosterCtes(
    input.request.target,
    input.request.context,
    input.organizationId,
    input.actorId,
    input.userId,
    activeFilter(input.request, input.field, input.actorId, new Date(asOf), input.timeZone),
  );
  const initiativeCatalogCtes =
    input.request.target === 'initiative'
      ? sql`, initiative_catalog as materialized (
          with recursive ${compileRosterCtes(
            'initiative',
            input.request.context,
            input.organizationId,
            input.actorId,
            input.userId,
            sql`true`,
          )}
          select e.organization_id, e.id, e.name, e.owner_id, e.lead_team_id,
            e.status, e.status_id
          from direct e
        )`
      : sql``;
  const source = input.request.target === 'initiative' ? 'direct' : 'matched';
  const membership = facetMembership(input.request.target, input.field);
  const catalog = optionCatalog({
    target: input.request.target,
    field: input.field,
    organizationId: input.organizationId,
    actorId: input.actorId,
    userId: input.userId,
    search,
    cursorKey: cursor?.key ?? null,
    limit: input.request.limit,
  });
  const aggregate = await executeOne(
    input.database,
    sql`with recursive ${ctes}${initiativeCatalogCtes}, memberships as materialized (
        select e.id entity_id, membership.key, membership.label
        from ${sql.raw(source)} e cross join lateral (${membership}) membership
      ), option_counts as materialized (
        select m.key, min(m.label)::text label, count(distinct m.entity_id)::int count
        from memberships m
        where m.key <> '__empty__' group by m.key
      ), catalog_options as materialized (${catalog}), available_options as materialized (
        select options.key, min(options.label)::text label
        from (
          select catalog_options.key, catalog_options.label from catalog_options
          union all
          select option_counts.key, option_counts.label from option_counts
        ) options group by options.key
      ), option_page as (
        select available.key, available.label, coalesce(counts.count, 0)::int count
        from available_options available
        left join option_counts counts on counts.key=available.key
        where (${search}::text is null or available.label ilike ('%' || ${search} || '%'))
          and (${cursor?.key ?? null}::text is null or available.key > ${cursor?.key ?? null})
        order by available.key limit ${input.request.limit + 1}
      )
      select coalesce((select json_agg(option_page order by option_page.key) from option_page), '[]'::json) options,
        (select count(distinct e.id)::int from ${sql.raw(source)} e) distinct_count,
        (select count(distinct m.entity_id)::int from memberships m where m.key='__empty__') empty_count`,
    facetAggregate,
  );
  const hasMore = aggregate.options.length > input.request.limit;
  const page = aggregate.options.slice(0, input.request.limit);
  const last = page.at(-1);
  return {
    field: input.field,
    options: page.map((option) => ({
      value: optionValue(input.request.target, input.field, option.key),
      label: option.label,
      count: option.count,
    })),
    emptyCount: aggregate.empty_count,
    nextCursor:
      hasMore && last
        ? encodeFacetCursor({
            target: input.request.target,
            field: input.field,
            search,
            key: last.key,
            asOf,
            fingerprint,
          })
        : null,
    stats: aggregate,
  };
}

/** Inputs for one authorized active-view facet request. */
export interface QueryWorkViewFacetsInput {
  readonly database: Database;
  readonly organizationId: string;
  readonly actorId: string;
  readonly request: WorkViewFacetRequest;
  /** IANA timezone used to resolve calendar predicates and bind facet cursors. */
  readonly timeZone?: string;
}

/**
 * Return bounded option buckets after authorization, context, and active filters have run.
 *
 * @param input - Database, authenticated scope, and target-validated active view.
 * @returns Typed facet buckets for the requested target.
 */
export async function queryWorkViewFacets(
  input: QueryWorkViewFacetsInput,
): Promise<WorkViewFacetResponseValue> {
  const caller = await executeOne(
    input.database,
    sql`select user_id from actor where id=${input.actorId}
      and organization_id=${input.organizationId} and kind='human'
      and status='active' and archived_at is null`,
    callerRow,
  );
  const fields = [...new Set(input.request.fields)];
  const executionCursor =
    input.request.cursor !== undefined
      ? decodeFacetCursor(input.request.cursor, {
          target: input.request.target,
          field: fields[0] ?? '',
          search: input.request.search ?? null,
        })
      : null;
  const asOf = executionCursor?.asOf ?? new Date().toISOString();
  const fullCtes = compileRosterCtes(
    input.request.target,
    input.request.context,
    input.organizationId,
    input.actorId,
    caller.user_id,
    activeFilter(input.request, null, input.actorId, new Date(asOf), input.timeZone ?? 'UTC'),
  );
  const fullSource = input.request.target === 'initiative' ? 'direct' : 'matched';
  const fullCount = await executeOne(
    input.database,
    sql`with recursive ${fullCtes}
      select count(distinct e.id)::int count from ${sql.raw(fullSource)} e`,
    distinctRow,
  );
  const buckets = [];
  for (const field of fields) {
    const bucket = await facetBucket({
      ...input,
      userId: caller.user_id,
      field,
      timeZone: input.timeZone ?? 'UTC',
      asOf,
    });
    buckets.push({
      field: bucket.field,
      options: bucket.options,
      emptyCount: bucket.emptyCount,
      nextCursor: bucket.nextCursor,
    });
  }
  return WorkViewFacetResponse.parse({
    target: input.request.target,
    buckets,
    distinctCount: fullCount.count,
  });
}
