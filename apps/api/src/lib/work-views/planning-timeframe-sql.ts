import { sql, type SQL } from 'drizzle-orm';

/** Build the stable semantic key for one saved target timeframe. */
export function targetTimeframeKeySql(date: SQL, resolution: SQL, fiscalYearStartMonth: SQL): SQL {
  return sql`case
    when ${date} is null then null
    when ${resolution} is null then to_char(${date}, 'YYYY-MM-DD') || '|day'
    else to_char(${date}, 'YYYY-MM-DD') || '|' || ${resolution}::text || '|' ||
      ${fiscalYearStartMonth}::text
  end`;
}

/** Build the human label for one saved target timeframe without exposing its date anchor. */
export function targetTimeframeLabelSql(
  date: SQL,
  resolution: SQL,
  fiscalYearStartMonth: SQL,
): SQL {
  const periodOffset = sql`mod(mod(
    extract(month from ${date})::int - 1 - ${fiscalYearStartMonth}, 12
  ) + 12, 12)`;
  const calendarYear = sql`extract(year from ${date})::int`;
  const fiscalYear = sql`${calendarYear} + case
    when extract(month from ${date})::int - 1 >= ${fiscalYearStartMonth} then 1
    else 0
  end`;
  const yearLabel = sql`case when ${fiscalYearStartMonth}=0
    then (${calendarYear})::text
    else 'FY ' || (${fiscalYear})::text end`;
  return sql`case
    when ${date} is null then null
    when ${resolution} is null then to_char(${date}, 'Mon FMDD, YYYY')
    when ${resolution}='month' then to_char(${date}, 'FMMonth YYYY')
    when ${resolution}='quarter' then
      'Q' || (floor((${periodOffset}) / 3) + 1)::int::text || ' ' || (${yearLabel})
    when ${resolution}='halfYear' then
      'H' || (floor((${periodOffset}) / 6) + 1)::int::text || ' ' || (${yearLabel})
    when ${resolution}='year' then ${yearLabel}
    else null
  end`;
}
