/**
 * Read-only preflight for migration `0059_work_data_constraints` — GEN-11's other half.
 *
 * @remarks
 * `packages/db/tests/migrations/production-snapshot-restore.test.ts` proves the migration chain
 * does not *destroy* existing rows, against a synthetic dataset, and says plainly what it cannot
 * cover: "the author's actual row shapes." `scripts/migration-safety.ts` proves no shipped
 * statement is destructive DDL. Neither of those catches the failure mode this script exists for:
 * `0059` adds thirteen `CHECK` constraints to six tables that already hold real rows — a
 * not-blank name, a non-negative estimate, a `starts_at`/`ends_at` ordering, a `[1970, 2201)` date
 * range — and on real Postgres, `ALTER TABLE ... ADD CONSTRAINT` validates every existing row
 * before it succeeds. One violating row anywhere in one of these six tables aborts the *entire*
 * migration transaction, not just the row.
 *
 * A local, empty-by-comparison dev database with a couple of seeded rows can pass every gate in
 * this repo and still not tell you whether the author's years of real Sunsama-imported and
 * hand-entered work contains a task due in 3999 or an initiative with a whitespace-only name —
 * both of which this script was written after finding in *dev* data, which is a strong hint real
 * data has more.
 *
 * This script is READ ONLY. It runs thirteen `SELECT`s, the exact logical negation of each new
 * `CHECK`, and reports every violating row. It changes nothing and connects to nothing by
 * default — it refuses to run unless pointed explicitly at a real Postgres connection string via
 * `DATABASE_URL_UNPOOLED` (the same variable `drizzle.config.ts` prefers for migrations), and
 * refuses an embedded `pglite:` target outright, because the entire point is checking data this
 * repo's own local/test database was never seeded with.
 *
 * This is deliberately a manual, human-run step, not a CI gate: running it against production
 * requires a production connection string, which does not belong in CI and does not belong
 * committed anywhere. Run it once, by hand, before `0059` is ever applied to prod.
 *
 * @example
 * ```bash
 * DATABASE_URL_UNPOOLED=postgres://... pnpm exec tsx scripts/migration-0059-check-constraint-preflight.ts
 * ```
 */
import postgres from 'postgres';
import process from 'node:process';

/** One CHECK constraint's preflight: a human label plus the SELECT that finds its violators. */
export interface ConstraintCheck {
  readonly constraint: string;
  readonly table: string;
  /** Selects the id (and any columns worth printing) of every row that would FAIL the CHECK. */
  readonly findViolators: string;
}

/**
 * The thirteen preflight checks, one per `CHECK` constraint `0059` adds to a table that can
 * already hold rows. Each `findViolators` query is the logical negation of the constraint's own
 * expression in `packages/db/drizzle/0059_work_data_constraints.sql` — read together, they must
 * stay in lockstep with that file, so a future migration touching the same columns should update
 * both.
 *
 * @remarks
 * Deliberately excludes `0059`'s constraints on `agent_session`, `agent_session_run`, and the four
 * brand-new tables (`athena_conversation_segment`, `publication`, `workspace_domain`,
 * `workspace_public_slug`): the columns those constraints govern are added by this SAME migration
 * with a `NOT NULL DEFAULT`, so every pre-existing row receives a value that trivially satisfies
 * the check — there is no way for a row that predates `0059` to violate them.
 */
export const CHECKS: readonly ConstraintCheck[] = [
  {
    constraint: 'cycle_window_ordered',
    table: 'cycle',
    findViolators: `select id, name, starts_at, ends_at from cycle where not (ends_at > starts_at)`,
  },
  {
    constraint: 'cycle_number_nonneg',
    table: 'cycle',
    findViolators: `select id, name, number from cycle where number < 0`,
  },
  {
    constraint: 'cycle_starts_at_range',
    table: 'cycle',
    findViolators: `select id, name, starts_at from cycle where starts_at is not null and not (starts_at >= '1970-01-01' and starts_at < '2201-01-01')`,
  },
  {
    constraint: 'cycle_ends_at_range',
    table: 'cycle',
    findViolators: `select id, name, ends_at from cycle where ends_at is not null and not (ends_at >= '1970-01-01' and ends_at < '2201-01-01')`,
  },
  {
    constraint: 'initiative_name_not_blank',
    table: 'initiative',
    findViolators: `select id, name from initiative where not (name ~ '[^[:space:]]')`,
  },
  {
    constraint: 'initiative_target_date_range',
    table: 'initiative',
    findViolators: `select id, name, target_date from initiative where target_date is not null and not (target_date >= '1970-01-01' and target_date < '2201-01-01')`,
  },
  {
    constraint: 'milestone_name_not_blank',
    table: 'milestone',
    findViolators: `select id, name from milestone where not (name ~ '[^[:space:]]')`,
  },
  {
    constraint: 'milestone_target_date_range',
    table: 'milestone',
    findViolators: `select id, name, target_date from milestone where target_date is not null and not (target_date >= '1970-01-01' and target_date < '2201-01-01')`,
  },
  {
    constraint: 'milestone_sort_nonneg',
    table: 'milestone',
    findViolators: `select id, name, sort from milestone where sort < 0`,
  },
  {
    constraint: 'program_name_not_blank',
    table: 'program',
    findViolators: `select id, name from program where not (name ~ '[^[:space:]]')`,
  },
  {
    constraint: 'project_name_not_blank',
    table: 'project',
    findViolators: `select id, name from project where not (name ~ '[^[:space:]]')`,
  },
  {
    constraint: 'project_start_date_range',
    table: 'project',
    findViolators: `select id, name, start_date from project where start_date is not null and not (start_date >= '1970-01-01' and start_date < '2201-01-01')`,
  },
  {
    constraint: 'project_target_date_range',
    table: 'project',
    findViolators: `select id, name, target_date from project where target_date is not null and not (target_date >= '1970-01-01' and target_date < '2201-01-01')`,
  },
  {
    constraint: 'task_title_not_blank',
    table: 'task',
    findViolators: `select id, title from task where not (title ~ '[^[:space:]]')`,
  },
  {
    constraint: 'task_state_not_blank',
    table: 'task',
    findViolators: `select id, title, state from task where not (state ~ '[^[:space:]]')`,
  },
  {
    constraint: 'task_not_own_parent',
    table: 'task',
    findViolators: `select id, title from task where parent_task_id is not null and parent_task_id = id`,
  },
  {
    constraint: 'task_estimate_nonneg',
    table: 'task',
    findViolators: `select id, title, estimate from task where estimate is not null and estimate < 0`,
  },
  {
    constraint: 'task_estimate_minutes_nonneg',
    table: 'task',
    findViolators: `select id, title, estimate_minutes from task where estimate_minutes is not null and estimate_minutes < 0`,
  },
  {
    constraint: 'task_start_date_range',
    table: 'task',
    findViolators: `select id, title, start_date from task where start_date is not null and not (start_date >= '1970-01-01' and start_date < '2201-01-01')`,
  },
  {
    constraint: 'task_due_date_range',
    table: 'task',
    findViolators: `select id, title, due_date from task where due_date is not null and not (due_date >= '1970-01-01' and due_date < '2201-01-01')`,
  },
];

/** One check's outcome: the violating rows found (empty means the constraint is already safe). */
export interface CheckResult {
  readonly check: ConstraintCheck;
  readonly violators: readonly Record<string, unknown>[];
}

/**
 * Resolve the connection string this preflight is allowed to run against.
 *
 * @remarks
 * Fails closed, deliberately, in both directions: no `DATABASE_URL_UNPOOLED` at all, and an
 * embedded `pglite:` target (this repo's local/test default — see `packages/db/src/client.ts`),
 * are both refused with an explanation rather than silently checking the wrong database.
 */
export function resolveTarget(env: NodeJS.ProcessEnv): string {
  const url = env['DATABASE_URL_UNPOOLED'];
  if (!url || url.trim() === '') {
    throw new Error(
      'DATABASE_URL_UNPOOLED is not set. This preflight only means something against a real ' +
        'Postgres connection — point it at a production connection string (or a restored ' +
        'production snapshot) and re-run: ' +
        'DATABASE_URL_UNPOOLED=postgres://... pnpm exec tsx scripts/migration-0059-check-constraint-preflight.ts',
    );
  }
  if (url.startsWith('pglite:')) {
    throw new Error(
      'DATABASE_URL_UNPOOLED is an embedded pglite: target. This preflight exists to check REAL ' +
        "data this repo's local/test database was never seeded with — point it at a real " +
        'Postgres connection string instead.',
    );
  }
  return url;
}

/** Run every check against `connectionString`, closing the connection when done either way. */
export async function runPreflight(connectionString: string): Promise<readonly CheckResult[]> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    const results: CheckResult[] = [];
    for (const check of CHECKS) {
      const violators = await sql.unsafe(check.findViolators);
      results.push({ check, violators: [...violators] });
    }
    return results;
  } finally {
    await sql.end();
  }
}

/** Render the results as the human-facing report this script prints. */
export function formatReport(results: readonly CheckResult[]): string {
  const failing = results.filter((r) => r.violators.length > 0);
  const lines: string[] = [];
  lines.push(
    `Migration 0059 CHECK-constraint preflight — ${String(results.length)} constraint(s) checked.`,
  );
  lines.push('');
  if (failing.length === 0) {
    lines.push(
      'PASS — every existing row already satisfies every new constraint. 0059 is safe to apply.',
    );
    return lines.join('\n');
  }
  lines.push(
    `FAIL — ${String(failing.length)} constraint(s) would reject existing rows. Fix these rows ` +
      '(or the constraint) before 0059 runs against this database, or the entire migration ' +
      'transaction aborts.',
  );
  lines.push('');
  for (const { check, violators } of failing) {
    lines.push(`  ${check.constraint}  (${check.table}, ${String(violators.length)} row(s))`);
    for (const row of violators.slice(0, 10)) {
      lines.push(`    ${JSON.stringify(row)}`);
    }
    if (violators.length > 10) lines.push(`    ... and ${String(violators.length - 10)} more`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const target = resolveTarget(process.env);
  const results = await runPreflight(target);
  const report = formatReport(results);
  console.log(report);
  const anyFailing = results.some((r) => r.violators.length > 0);
  process.exitCode = anyFailing ? 1 : 0;
}

// Only auto-run when executed directly (`tsx scripts/...`), not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
