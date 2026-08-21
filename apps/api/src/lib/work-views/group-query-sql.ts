import type { ViewTarget } from '@docket/work/view-contract';
import { and, sql, type SQL } from 'drizzle-orm';

import { WORK_VIEW_SQL_CONTRACTS } from './contracts';
import { compileGroupMembershipSql, type GroupFieldCompiler } from './group-sql';

/**
 * Compile grouped count JSON from one already-authorized roster.
 *
 * @param target - Requested work-view target.
 * @param groupBy - Primary grouping field, or null for an ungrouped view.
 * @param subGroupBy - Optional secondary grouping field.
 * @param source - Direct matches for Initiatives and matched rows for other targets.
 * @returns A scalar SQL expression that returns the complete group summary array.
 */
export function compileGroupJsonSql(
  target: ViewTarget,
  groupBy: string | null,
  subGroupBy: string | null,
  source: 'direct' | 'matched',
): SQL {
  if (!groupBy) return sql`'[]'::json`;
  const registry: Readonly<Record<string, GroupFieldCompiler>> =
    WORK_VIEW_SQL_CONTRACTS[target].groups;
  const primaryField = registry[groupBy];
  if (!primaryField) throw new TypeError(`Unsupported group field: ${groupBy}`);
  const primary = compileGroupMembershipSql(primaryField, sql`e.id`);
  if (!subGroupBy) {
    return sql`coalesce((select json_agg(json_build_object(
        'path', grouped.path, 'key', grouped.key, 'label', grouped.label, 'count', grouped.count
      ) order by grouped.label, grouped.key) from (
      select array[g.key] path, g.key, g.label, count(distinct e.id)::int count
      from ${sql.raw(source)} e cross join lateral (${primary}) g
      group by g.key,g.label
    ) grouped), '[]'::json)`;
  }
  const secondaryField = registry[subGroupBy];
  if (!secondaryField) throw new TypeError(`Unsupported subgroup field: ${subGroupBy}`);
  const secondary = compileGroupMembershipSql(secondaryField, sql`e.id`);
  return sql`coalesce((select json_agg(json_build_object(
      'path', grouped.path, 'key', grouped.key, 'label', grouped.label, 'count', grouped.count
    ) order by grouped.path) from (
    select array[g.key] path, g.key, g.label, count(distinct e.id)::int count
    from ${sql.raw(source)} e cross join lateral (${primary}) g
    group by g.key,g.label
    union all
    select array[g.key,sg.key] path, sg.key, sg.label, count(distinct e.id)::int count
    from ${sql.raw(source)} e cross join lateral (${primary}) g cross join lateral (${secondary}) sg
    group by g.key,sg.key,sg.label
  ) grouped), '[]'::json)`;
}

/**
 * Compile the selected group path as direct-row membership predicates.
 *
 * @param target - Requested work-view target.
 * @param groupBy - Primary grouping field.
 * @param subGroupBy - Optional secondary grouping field.
 * @param groupPath - Selected group keys from the request context.
 * @returns A direct-row group membership condition for entity alias `e`.
 */
export function compileGroupPathSql(
  target: ViewTarget,
  groupBy: string | null,
  subGroupBy: string | null,
  groupPath: readonly string[],
): SQL {
  if (groupPath.length === 0) return sql`true`;
  if (!groupBy || groupPath.length > (subGroupBy ? 2 : 1)) {
    throw new TypeError('The group path does not match the query arrangement.');
  }
  const registry: Readonly<Record<string, GroupFieldCompiler>> =
    WORK_VIEW_SQL_CONTRACTS[target].groups;
  const primary = registry[groupBy];
  if (!primary) throw new TypeError(`Unsupported group field: ${groupBy}`);
  const conditions = [
    sql`exists (select 1 from (${compileGroupMembershipSql(primary, sql`e.id`)}) group_membership where group_membership.key=${groupPath[0]})`,
  ];
  if (groupPath.length === 2) {
    if (!subGroupBy) throw new TypeError('The subgroup path does not match the query arrangement.');
    const secondary = registry[subGroupBy];
    if (!secondary) throw new TypeError(`Unsupported subgroup field: ${subGroupBy}`);
    conditions.push(
      sql`exists (select 1 from (${compileGroupMembershipSql(secondary, sql`e.id`)}) subgroup_membership where subgroup_membership.key=${groupPath[1]})`,
    );
  }
  return and(...conditions) ?? sql`true`;
}
