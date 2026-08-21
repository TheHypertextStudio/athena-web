import { sql, type SQL } from 'drizzle-orm';

/** One groupable field compiled as scalar or fan-out memberships. */
export type GroupFieldCompiler =
  | { readonly kind: 'scalar'; readonly key: SQL; readonly label: SQL }
  | { readonly kind: 'fanout'; readonly memberships: (entityId: SQL) => SQL };

/** An exhaustive SQL group registry for a derived target field-key union. */
export type GroupCompilerMap<TKey extends string> = Readonly<Record<TKey, GroupFieldCompiler>>;

/**
 * Compile group memberships for one matched entity without duplicating the matched roster.
 *
 * @param field - Scalar or fan-out group compiler.
 * @param entityId - Correlated matched entity id.
 * @returns A query yielding `key` and `label` membership columns.
 */
export function compileGroupMembershipSql(field: GroupFieldCompiler, entityId: SQL): SQL {
  if (field.kind === 'fanout') {
    const memberships = field.memberships(entityId);
    return sql`with memberships as materialized (${memberships})
      select membership.key, membership.label from memberships membership
      union all select '__empty__'::text, 'No value'::text
      where not exists (select 1 from memberships)`;
  }
  return sql`select coalesce((${field.key})::text, '__empty__') as key,
    case when (${field.key}) is null then 'No value' else coalesce((${field.label})::text, (${field.key})::text) end as label`;
}
