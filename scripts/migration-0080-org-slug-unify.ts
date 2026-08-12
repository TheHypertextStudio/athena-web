/**
 * Data-fix pass for migration `0080_open_colonel_america` — the org-slug unification.
 *
 * @remarks
 * That migration drops `workspace_public_slug` and adds `organization_slug_format_check` (the
 * same shape `@docket/types`'s `PublicSlug` already enforces for a brief address: lowercase
 * alphanumerics, single-hyphen separated, ≤64 characters) to `organization.slug` — which is now
 * a workspace's ONE identifier, doubling as its default public brief address.
 *
 * Two real hazards for existing data, both explained in `apps/api/src/routes/org-helpers.ts`'s
 * research trail:
 *
 * 1. **A workspace may have deliberately claimed a DIFFERENT public name** than its own
 *    `organization.slug` (the two were separately-unique tables until now). Whichever value is
 *    already circulating in a shared link should survive — this script prefers the claimed
 *    `workspace_public_slug` over the org's own untouched slug wherever they differ.
 * 2. **`organization.slug` had no reserved-word screening and allowed up to 80 characters**
 *    (vs. the new 64-char, reserved-word-screened rule) on the explicit-edit path, and the
 *    auto-derive path bypassed validation entirely. An existing slug can therefore already be
 *    too long, or literally `admin`/`settings`/etc.
 *
 * This script is a human-run, `--fix`-gated step: by default (no flag) it only REPORTS what it
 * would change, exactly like `migration-0059-check-constraint-preflight.ts`'s read-only
 * preflight. Pass `--fix` to actually apply the resolved slugs. Run this — and confirm it
 * reports nothing left to fix — BEFORE `0080` is ever applied to a database with real data,
 * since the migration drops `workspace_public_slug` outright and this is the last point a
 * deliberately-claimed public name can still be read back.
 *
 * @example
 * ```bash
 * DATABASE_URL_UNPOOLED=postgres://... pnpm exec tsx scripts/migration-0080-org-slug-unify.ts
 * DATABASE_URL_UNPOOLED=postgres://... pnpm exec tsx scripts/migration-0080-org-slug-unify.ts --fix
 * ```
 */
import postgres from 'postgres';

/** A public path segment: lowercase alphanumerics, single-hyphen separated, ≤64 characters. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX_LENGTH = 64;

/**
 * Mirrors `RESERVED_PUBLIC_SLUGS` (`packages/types/src/slug.ts`) as a literal copy rather than an
 * import: this script runs standalone via `tsx`, outside the workspace's normal build graph, and
 * a literal copy can't silently drift out of sync with a runtime resolution failure — a mismatch
 * here instead just means the two lists must be kept in step by hand, which the two `@see`
 * comments below make an intentional, visible obligation rather than a hidden one.
 *
 * @see `packages/types/src/slug.ts` — the source of truth.
 */
const RESERVED_PUBLIC_SLUGS: readonly string[] = [
  '_next',
  'about',
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'blog',
  'brief',
  'briefs',
  'cdn',
  'dashboard',
  'docket',
  'docs',
  'domain',
  'health',
  'help',
  'hub',
  'internal',
  'legal',
  'login',
  'mail',
  'me',
  'new',
  'onboarding',
  'orgs',
  'pricing',
  'privacy',
  'problems',
  'public',
  'settings',
  'sign-in',
  'sign-out',
  'sign-up',
  'signin',
  'signup',
  'static',
  'status',
  'support',
  'terms',
  'today',
  'v1',
  'www',
];

/** One organization's row, as read for this pass. */
export interface OrgRow {
  readonly id: string;
  readonly slug: string;
}

/** One claimed public-slug row, as read for this pass (before the table is dropped). */
export interface PublicSlugRow {
  readonly organizationId: string;
  readonly slug: string;
}

/** One organization's resolved outcome. */
export interface Resolution {
  readonly orgId: string;
  readonly before: string;
  readonly after: string;
  /** Why `after` differs from `before` — omitted when nothing changes. */
  readonly reason?: 'adopted-claimed-name' | 'invalid-shape' | 'collision';
}

function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
}

function isUsable(slug: string, taken: ReadonlySet<string>): boolean {
  return isValidSlug(slug) && !RESERVED_PUBLIC_SLUGS.includes(slug) && !taken.has(slug);
}

/** Disambiguate `base` with a sequential numeric suffix until it is usable against `taken`. */
function disambiguate(base: string, taken: ReadonlySet<string>): string {
  const trimmedBase = base.slice(0, SLUG_MAX_LENGTH);
  for (let attempt = 2; attempt <= 999; attempt += 1) {
    const suffix = `-${String(attempt)}`;
    const candidate = `${trimmedBase.slice(0, SLUG_MAX_LENGTH - suffix.length)}${suffix}`;
    if (isUsable(candidate, taken)) return candidate;
  }
  throw new Error(`Could not disambiguate a usable slug from '${base}' within 999 attempts.`);
}

/**
 * Resolve the final slug for every organization, preferring a distinct claimed public name,
 * disambiguating anything invalid or colliding.
 *
 * @remarks
 * Pure and deterministic given its inputs (iteration order is `orgs`' own order), so this is unit
 * -testable without a database — see `scripts/tests/migration-0080-org-slug-unify.test.ts`.
 *
 * @param orgs - Every organization's current `id`/`slug`.
 * @param publicSlugs - Every claimed `workspace_public_slug` row (before the table is dropped).
 * @returns One {@link Resolution} per organization whose slug is changing. Organizations whose
 *   existing slug is already correct are omitted entirely — nothing to fix means nothing to
 *   report.
 */
export function resolveOrgSlugs(
  orgs: readonly OrgRow[],
  publicSlugs: readonly PublicSlugRow[],
): readonly Resolution[] {
  const claimedByOrg = new Map(publicSlugs.map((row) => [row.organizationId, row.slug]));
  // Seed with every CURRENT organization.slug so no resolution ever collides with an org this
  // pass hasn't reached yet, then overwritten in place as each org's final value is decided.
  const taken = new Set(orgs.map((org) => org.slug));

  const resolutions: Resolution[] = [];
  for (const org of orgs) {
    const claimed = claimedByOrg.get(org.id);
    const preferred = claimed !== undefined && claimed !== org.slug ? claimed : org.slug;

    taken.delete(org.slug);
    const final = isUsable(preferred, taken) ? preferred : disambiguate(preferred, taken);
    taken.add(final);

    if (final !== org.slug) {
      resolutions.push({
        orgId: org.id,
        before: org.slug,
        after: final,
        reason:
          preferred !== org.slug && final === preferred
            ? 'adopted-claimed-name'
            : !isValidSlug(preferred) || RESERVED_PUBLIC_SLUGS.includes(preferred)
              ? 'invalid-shape'
              : 'collision',
      });
    }
  }
  return resolutions;
}

/** Resolve the connection string this script is allowed to run against — see the 0059 preflight. */
export function resolveTarget(env: NodeJS.ProcessEnv): string {
  const url = env['DATABASE_URL_UNPOOLED'];
  if (!url || url.trim() === '') {
    throw new Error(
      'DATABASE_URL_UNPOOLED is not set. This script only means something against a real ' +
        'Postgres connection — point it at a production connection string (or a restored ' +
        'production snapshot) and re-run: ' +
        'DATABASE_URL_UNPOOLED=postgres://... pnpm exec tsx scripts/migration-0080-org-slug-unify.ts',
    );
  }
  if (url.startsWith('pglite:')) {
    throw new Error(
      'DATABASE_URL_UNPOOLED is an embedded pglite: target. This script exists to check REAL ' +
        "data this repo's local/test database was never seeded with — point it at a real " +
        'Postgres connection string instead.',
    );
  }
  return url;
}

/** Read every org and every claimed public-slug row, resolve, and — if `fix` — write the result. */
export async function run(connectionString: string, fix: boolean): Promise<readonly Resolution[]> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    const orgs = await sql<OrgRow[]>`select id, slug from organization`;
    const publicSlugs = await sql<
      PublicSlugRow[]
    >`select organization_id as "organizationId", slug from workspace_public_slug`;
    const resolutions = resolveOrgSlugs(orgs, publicSlugs);

    if (fix) {
      for (const resolution of resolutions) {
        await sql`update organization set slug = ${resolution.after} where id = ${resolution.orgId}`;
      }
    }
    return resolutions;
  } finally {
    await sql.end();
  }
}

/** Render the resolutions as the human-facing report this script prints. */
export function formatReport(resolutions: readonly Resolution[], fix: boolean): string {
  const lines: string[] = [];
  lines.push(`Migration 0080 org-slug unification — ${fix ? 'FIX' : 'DRY RUN'}.`);
  lines.push('');
  if (resolutions.length === 0) {
    lines.push('Nothing to change — every organization already has a valid, unique slug.');
    return lines.join('\n');
  }
  lines.push(
    `${String(resolutions.length)} organization(s) ${fix ? 'were updated' : 'would change'}:`,
  );
  lines.push('');
  for (const r of resolutions) {
    lines.push(`  ${r.orgId}  '${r.before}' -> '${r.after}'  (${r.reason ?? 'unknown'})`);
  }
  if (!fix) {
    lines.push('');
    lines.push('Re-run with --fix to apply these changes before 0080 is applied.');
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const fix = process.argv.includes('--fix');
  const target = resolveTarget(process.env);
  const resolutions = await run(target, fix);
  console.log(formatReport(resolutions, fix));
  process.exitCode = !fix && resolutions.length > 0 ? 1 : 0;
}

// Only auto-run when executed directly (`tsx scripts/...`), not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
