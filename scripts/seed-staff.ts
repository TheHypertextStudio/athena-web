/**
 * `pnpm db:seed:staff` — grant a developer operator (staff) access to the admin console.
 *
 * @remarks
 * Solves the staff chicken-and-egg: the operator console (`/v1/admin/*`) requires a
 * `staff_user` row, but the only API that mints staff itself requires being a superadmin —
 * so the FIRST operator must be seeded out of band. This is that step, made repeatable on
 * every device (it talks to whatever `DATABASE_URL` points at).
 *
 * It never hardcodes an email. The target account is resolved, in order:
 *   1. CLI arguments — `pnpm db:seed:staff alice@x.dev bob@x.dev:finance`
 *   2. `STAFF_BOOTSTRAP_EMAILS` — comma-separated `email[:role]`, for non-interactive runs
 *   3. Interactive prompt — lists the existing accounts and asks which one (+ which tier)
 *
 * Each token is `email[:role]` (role ∈ support|finance|superadmin, default superadmin). The
 * grant is idempotent (see {@link grantStaffByEmail}). With `--non-interactive` it never
 * prompts: it acts only on args/env and otherwise prints a hint and exits cleanly.
 *
 * NOTE: under embedded PGlite (single-process) this CLI cannot open the database while
 * `pnpm dev` holds it — set `STAFF_BOOTSTRAP_EMAILS` instead (the API grants it automatically
 * in dev), or stop the dev server first.
 */
import { createInterface } from 'node:readline';
import process from 'node:process';

// Root scripts import workspace code by relative path (see scripts/env-check.ts) — the root
// package has no `@docket/db` dependency, so the bare specifier would not resolve here.
import {
  DEFAULT_STAFF_ROLE,
  STAFF_ROLES,
  db,
  grantStaffByEmail,
  isStaffRole,
  parseStaffTarget,
  user,
  type StaffTarget,
} from '../packages/db/src/index';

/** Print one human-readable line describing a grant outcome for `email`. */
function reportResult(email: string, result: Awaited<ReturnType<typeof grantStaffByEmail>>): void {
  switch (result.status) {
    case 'granted':
      console.log(`✓ Granted ${result.role} to ${email} — reload the admin console.`);
      break;
    case 'updated':
      console.log(`✓ ${email}: ${result.previousRole} → ${result.role}.`);
      break;
    case 'unchanged':
      console.log(`• ${email} is already ${result.role} — no change.`);
      break;
    case 'no-user':
      console.log(
        `⚠ No account for ${result.email}. Sign in to the app once (creates your user), then re-run.`,
      );
      break;
  }
}

/** Ask a single question on the terminal, resolving to the trimmed answer. */
function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/** Interactively pick an account + tier from the existing users. Returns [] if none exist. */
async function promptForTarget(): Promise<StaffTarget[]> {
  const accounts = await db.select({ id: user.id, email: user.email, name: user.name }).from(user);
  if (accounts.length === 0) {
    console.log(
      'No accounts found yet. Sign in to the app once, then re-run `pnpm db:seed:staff`.',
    );
    return [];
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\nAccounts:');
    accounts.forEach((a, i) => {
      console.log(`  ${i + 1}. ${a.email}${a.name ? ` — ${a.name}` : ''}`);
    });
    const pick = await ask(rl, '\nWhich account should become an operator? (number or email): ');
    const index = Number.parseInt(pick, 10);
    const byNumber =
      Number.isInteger(index) && index >= 1 && index <= accounts.length
        ? accounts[index - 1]
        : undefined;
    const email = byNumber ? byNumber.email : pick;
    if (!email) throw new Error('No account selected.');

    const answer = await ask(rl, `Tier — ${STAFF_ROLES.join(' | ')} [${DEFAULT_STAFF_ROLE}]: `);
    const role = answer === '' ? DEFAULT_STAFF_ROLE : answer;
    if (!isStaffRole(role)) {
      throw new Error(`Invalid tier "${role}" — expected one of ${STAFF_ROLES.join(', ')}.`);
    }
    return [{ email, role }];
  } finally {
    rl.close();
  }
}

/** Resolve targets from argv, then `STAFF_BOOTSTRAP_EMAILS`, then an interactive prompt. */
async function resolveTargets(args: string[], nonInteractive: boolean): Promise<StaffTarget[]> {
  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length > 0) return positional.map(parseStaffTarget);

  const fromEnv = (process.env['STAFF_BOOTSTRAP_EMAILS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv.map(parseStaffTarget);

  if (nonInteractive || !process.stdin.isTTY) {
    console.log(
      'No staff target configured. Run `pnpm db:seed:staff` interactively, pass an email, or set STAFF_BOOTSTRAP_EMAILS.',
    );
    return [];
  }
  return promptForTarget();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Usage: pnpm db:seed:staff [email[:role] ...] [--non-interactive]\n' +
        `  role: ${STAFF_ROLES.join(' | ')} (default ${DEFAULT_STAFF_ROLE})\n` +
        '  no args + a TTY -> interactive picker; --non-interactive uses args/STAFF_BOOTSTRAP_EMAILS only.',
    );
    return;
  }

  const targets = await resolveTargets(args, args.includes('--non-interactive'));
  for (const target of targets) {
    reportResult(target.email, await grantStaffByEmail(db, target));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    if ((process.env['DATABASE_URL'] ?? '').startsWith('pglite:')) {
      console.error(
        'Could not open the embedded PGlite database — it is single-process and likely held by a running `pnpm dev`.\n' +
          'Set STAFF_BOOTSTRAP_EMAILS in .env.local (the API grants it automatically in dev), or stop the dev server and re-run.',
      );
    }
    console.error(error);
    process.exit(1);
  });
