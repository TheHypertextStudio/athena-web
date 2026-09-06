import { sql, type SQL } from 'drizzle-orm';

/**
 * Coalesce a cycle's author-set name with its date window, in SQL.
 *
 * @remarks
 * A raw-SQL transliteration of `defaultCycleName` (`@docket/work/cycle-contract`) for read paths
 * (group labels, facet options) that compile a `cycle` join into SQL and cannot call the TS
 * helper directly. `<alias>.number` is the auto-roll's idempotency key, not a label, and must
 * never appear here — see `defaultCycleName`'s docblock. Output is pinned to byte-match the TS
 * helper (spaced en dash, `Mon D` / `Mon D, YYYY`) by `cycle-display-name.test.ts`, since a group
 * header and the cycle detail page disagreeing on the same cycle would be exactly the drift this
 * fix exists to prevent.
 *
 * `starts_at`/`ends_at` are plain `timestamp` columns (no time zone) already holding UTC
 * wall-clock values — see `packages/db/src/schema/work.ts`. `to_char` must run on them directly:
 * wrapping them in `AT TIME ZONE 'UTC'` would convert to `timestamptz`, and `to_char` formats a
 * `timestamptz` in the session's time zone, silently reintroducing the zone drift this exists to
 * avoid.
 *
 * @param alias - The raw SQL alias the `cycle` table is queried under (e.g. `c`, `option`).
 * @returns A `text` SQL expression: the cycle's name, or its window when unnamed.
 */
export function cycleDisplayNameSql(alias: string): SQL {
  const t = sql.raw(alias);
  return sql`coalesce(${t}.name,
    case when date_part('year', ${t}.starts_at) = date_part('year', ${t}.ends_at)
      then to_char(${t}.starts_at, 'FMMon FMDD') || ' – ' || to_char(${t}.ends_at, 'FMMon FMDD')
      else to_char(${t}.starts_at, 'FMMon FMDD, YYYY') || ' – ' ||
           to_char(${t}.ends_at, 'FMMon FMDD, YYYY')
    end)`;
}
