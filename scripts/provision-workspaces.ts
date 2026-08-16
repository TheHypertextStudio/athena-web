/**
 * `pnpm workspaces:provision` — bring the author's eight real workspaces into existence,
 * idempotently, each spelled exactly as named (including the full, untruncated
 * "Willie Enterprises (dba Vibe Code Cleanup Company)" name) with no placeholder left over.
 *
 * @remarks
 * The author named eight enterprises that each need their own workspace. This tool reconciles
 * that list against whatever the account already has and makes the smallest change that gets
 * there. It is safe to run repeatedly, on a fresh database or a populated one: a second run
 * reports eight `already-correct` rows and writes nothing.
 *
 * **Why it drives the HTTP API rather than the database.** Creating a workspace is not an
 * `INSERT` — it seeds four system roles, an owner Actor, a default team, that team's actor, the
 * team membership, and the org-root grants that make the owner's capabilities resolve. All of it
 * lives in one transaction inside `POST /v1/orgs`. A script that wrote rows directly would be a
 * second, drifting copy of that seed, and the workspaces it produced would differ from every
 * other workspace in the product in ways nobody would notice until a permission check failed.
 *
 * **The reconciliation rules**, applied per target name, in order:
 *
 * 1. **Exact name already present** → nothing to do. This is what makes re-running a no-op.
 * 2. **Personal Life** is matched by the account's `isPersonal` workspace rather than by name,
 *    because a personal space is created automatically at sign-up under a generated name
 *    ("lane's space") and there can only ever be one — `POST /v1/orgs {isPersonal: true}` returns
 *    the existing one instead of making a second. So it is *renamed*, which is also what clears
 *    the launch acceptance's "no placeholder default workspace left over" clause: the placeholder
 *    does not linger beside the real thing, it becomes the real thing.
 * 3. **A workspace already carrying the target's canonical slug** → renamed to the exact string.
 *    This adopts a workspace created earlier under the right slug but a working name (an audit
 *    probe, a typo, a rename in progress) rather than creating a near-duplicate beside it, which
 *    is the specific failure this tool exists to avoid — the API would happily mint
 *    `las-vegans-for-better-transit-2`.
 * 4. **Otherwise** → created.
 *
 * Nothing is ever deleted, and a workspace that matches no target is reported as `unmanaged` and
 * left exactly as it is. Deleting someone's workspace is not a decision a provisioning script
 * gets to make; surfacing it so a human can is.
 *
 * Usage (from the repo root):
 *
 * ```sh
 * # what it would do, no writes
 * pnpm workspaces:provision --dry-run
 *
 * # apply, against a specific stack + session
 * pnpm workspaces:provision --api-url=http://api.docket.localhost:1355 \
 *   --session=apps/web/.data/design-review/session.json
 * ```
 *
 * Authentication is the caller's own Better Auth session, supplied either as a Playwright storage
 * state file (`--session`, the same file the screenshot tooling uses) or as a raw cookie header
 * in `DOCKET_SESSION_COOKIE`. The workspaces are created *by* that account, so it becomes their
 * Owner — which is the correct outcome and not something a service credential could achieve.
 *
 * Exits non-zero when any target could not be reconciled.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** A workspace this tool is responsible for, exactly as the author spelled it. */
interface TargetWorkspace {
  /** The display name, character-for-character. */
  readonly name: string;
  /**
   * Whether this is the account's personal space.
   *
   * @remarks
   * A personal workspace is an org-of-one: Teams, Members and the rest of the organization
   * surfaces stay hidden for it, because org-backing is an implementation detail rather than
   * something the reader should have to understand.
   */
  readonly personal: boolean;
  /** What the workspace is for — stored as the org's purpose, shown in its settings. */
  readonly purpose: string;
  /** The terminology skin that fits this workspace's world. */
  readonly vocabulary: 'startup' | 'nonprofit' | 'agency';
}

/**
 * The eight workspaces, in the order the author listed them.
 *
 * @remarks
 * The names are the contract — they are compared and written character-for-character, including
 * the "(dba …)" in the last one. Do not "tidy" any of these strings.
 */
export const TARGET_WORKSPACES: readonly TargetWorkspace[] = [
  {
    name: 'Personal Life',
    personal: true,
    purpose: 'Everything that is mine to carry — errands, health, home, people, money.',
    vocabulary: 'startup',
  },
  {
    name: 'The Willie Diaries',
    personal: false,
    purpose: 'Writing and publishing — essays, episodes, and the archive behind them.',
    vocabulary: 'agency',
  },
  {
    name: 'Las Vegans for Better Transit',
    personal: false,
    purpose: 'Transit advocacy in the Las Vegas valley — campaigns, coalitions, and testimony.',
    vocabulary: 'nonprofit',
  },
  {
    name: 'Reasonable Tech Company',
    personal: false,
    purpose: 'Product and engineering for the software the company sells.',
    vocabulary: 'startup',
  },
  {
    name: 'Hypertext Studio',
    personal: false,
    purpose: 'Studio work — client engagements, prototypes, and the tools behind them.',
    vocabulary: 'agency',
  },
  {
    name: 'Rebuilding America Project',
    personal: false,
    purpose: 'Long-horizon civic infrastructure work — research, policy, and partnerships.',
    vocabulary: 'nonprofit',
  },
  {
    name: 'Project Oasis',
    personal: false,
    purpose: 'A bounded build with its own runway, kept separate from the studio it came from.',
    vocabulary: 'startup',
  },
  {
    name: 'Willie Enterprises (dba Vibe Code Cleanup Company)',
    personal: false,
    purpose: 'The operating company — contracts, cleanup engagements, and the books.',
    vocabulary: 'agency',
  },
];

/** The workspace shape `GET /v1/orgs` returns. */
interface OrgSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly isPersonal: boolean;
}

/** What this tool did (or would do) about one target workspace. */
export type ProvisionAction = 'already-correct' | 'renamed' | 'created' | 'failed';

/** One line of the run's report. */
export interface ProvisionOutcome {
  readonly name: string;
  readonly action: ProvisionAction;
  readonly orgId: string | null;
  /** The prior name, when this run renamed a workspace into place. */
  readonly previousName?: string;
  /** Application-owned explanation, present only when `action` is `failed`. */
  readonly detail?: string;
}

/**
 * Derive the slug the API would auto-generate for a workspace name.
 *
 * @remarks
 * Mirrors `apps/api/src/routes/org-helpers.ts` `slugify` exactly. It is duplicated rather than
 * imported because this script must run against a *remote* API (staging, production) where the
 * only thing shared with that process is the HTTP contract. The `provision-workspaces` test
 * pins the two implementations together so the copy cannot drift silently.
 *
 * @param name - A workspace display name.
 * @returns the URL-safe slug candidate the API derives from it.
 */
export function workspaceSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'org'
  );
}

/**
 * Choose the existing workspace, if any, that a target should adopt rather than duplicate.
 *
 * @remarks
 * Pure so the decision is testable without a server. The order matters and encodes the rules in
 * this module's docs: an exact name match wins outright; the personal target then claims the
 * account's personal space whatever it is currently called; otherwise a slug match adopts a
 * workspace that was already meant to be this one.
 *
 * @param target - The workspace being reconciled.
 * @param existing - Every workspace the account currently belongs to.
 * @returns the workspace to adopt, or null when one must be created.
 */
export function matchExisting(
  target: TargetWorkspace,
  existing: readonly OrgSummary[],
): OrgSummary | null {
  const byName = existing.find((o) => o.name === target.name);
  if (byName) return byName;
  if (target.personal) return existing.find((o) => o.isPersonal) ?? null;
  const slug = workspaceSlug(target.name);
  return existing.find((o) => o.slug === slug && !o.isPersonal) ?? null;
}

interface CliOptions {
  readonly apiUrl: string;
  readonly cookie: string;
  readonly dryRun: boolean;
}

/** Read the session cookie header out of a Playwright storage-state file. */
function cookieFromSessionFile(path: string): string {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    cookies?: { name: string; value: string }[];
  };
  const cookies = raw.cookies ?? [];
  if (cookies.length === 0) throw new Error(`No cookies in session file: ${path}`);
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** Parse argv + environment into the run's options. */
function parseOptions(argv: readonly string[]): CliOptions {
  const flags = new Map<string, string>();
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match?.[1] !== undefined && match[2] !== undefined) flags.set(match[1], match[2]);
  }

  const apiUrl =
    flags.get('api-url') ?? process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
  if (!apiUrl) {
    throw new Error(
      'No API URL. Pass --api-url=<origin> or set API_URL (try: eval "$(./scripts/dev-stack.sh env)").',
    );
  }

  const sessionFile = flags.get('session');
  const cookie = sessionFile
    ? cookieFromSessionFile(sessionFile)
    : (process.env['DOCKET_SESSION_COOKIE'] ?? '');
  if (!cookie) {
    throw new Error(
      'No session. Pass --session=<playwright storage state json> or set DOCKET_SESSION_COOKIE.',
    );
  }

  return { apiUrl: apiUrl.replace(/\/+$/, ''), cookie, dryRun };
}

/** A thin authenticated JSON caller against the Docket API. */
class DocketClient {
  constructor(
    private readonly apiUrl: string,
    private readonly cookie: string,
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: this.cookie,
      },
    });
    if (!res.ok) {
      // The API's Problem body is a machine contract, not display copy; a provisioning run is a
      // developer surface, so the status + path is what identifies the failure here.
      throw new Error(`${init?.method ?? 'GET'} ${path} → HTTP ${res.status}`);
    }
    const parsed: unknown = await res.json();
    return parsed as T;
  }

  /** Every workspace the authenticated account belongs to. */
  async listOrgs(): Promise<readonly OrgSummary[]> {
    return (await this.call<{ items: OrgSummary[] }>('/v1/orgs')).items;
  }

  /** Create a workspace through the same seeded path the product uses. */
  async createOrg(target: TargetWorkspace): Promise<OrgSummary> {
    const created = await this.call<{ organization: OrgSummary }>('/v1/orgs', {
      method: 'POST',
      body: JSON.stringify({
        name: target.name,
        purpose: target.purpose,
        vocabulary: target.vocabulary,
        isPersonal: target.personal,
      }),
    });
    return created.organization;
  }

  /** Rename a workspace in place, leaving its slug and everything inside it alone. */
  async renameOrg(orgId: string, name: string, purpose: string): Promise<OrgSummary> {
    return await this.call<OrgSummary>(`/v1/orgs/${orgId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, purpose }),
    });
  }
}

/**
 * Reconcile every target workspace against the account's current workspaces.
 *
 * @param client - An authenticated API client.
 * @param dryRun - When true, decide but do not write.
 * @returns one outcome per target, in the author's order.
 */
async function provision(
  client: DocketClient,
  dryRun: boolean,
): Promise<{ outcomes: ProvisionOutcome[]; unmanaged: OrgSummary[] }> {
  // Read once, then track locally: each create/rename changes what the next target may adopt,
  // and re-reading between every target would let a slow list race the writes we just made.
  const existing = [...(await client.listOrgs())];
  const outcomes: ProvisionOutcome[] = [];
  const claimed = new Set<string>();

  for (const target of TARGET_WORKSPACES) {
    const candidates = existing.filter((o) => !claimed.has(o.id));
    const match = matchExisting(target, candidates);
    try {
      if (match?.name === target.name) {
        claimed.add(match.id);
        outcomes.push({ name: target.name, action: 'already-correct', orgId: match.id });
        continue;
      }
      if (match) {
        claimed.add(match.id);
        if (!dryRun) await client.renameOrg(match.id, target.name, target.purpose);
        const index = existing.findIndex((o) => o.id === match.id);
        existing[index] = { ...match, name: target.name };
        outcomes.push({
          name: target.name,
          action: 'renamed',
          orgId: match.id,
          previousName: match.name,
        });
        continue;
      }
      if (dryRun) {
        outcomes.push({ name: target.name, action: 'created', orgId: null });
        continue;
      }
      const created = await client.createOrg(target);
      claimed.add(created.id);
      existing.push(created);
      outcomes.push({ name: target.name, action: 'created', orgId: created.id });
    } catch (error) {
      outcomes.push({
        name: target.name,
        action: 'failed',
        orgId: match?.id ?? null,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const unmanaged = existing.filter((o) => !claimed.has(o.id));
  return { outcomes, unmanaged };
}

/** Render the run's report and return the process exit code. */
function report(
  outcomes: readonly ProvisionOutcome[],
  unmanaged: readonly OrgSummary[],
  dryRun: boolean,
): number {
  const width = Math.max(...outcomes.map((o) => o.name.length));
  process.stdout.write(`\nWorkspaces — ${dryRun ? 'planned' : 'applied'}\n\n`);
  for (const outcome of outcomes) {
    const suffix =
      outcome.action === 'renamed'
        ? `  (was "${outcome.previousName ?? ''}")`
        : outcome.action === 'failed'
          ? `  ${outcome.detail ?? ''}`
          : '';
    process.stdout.write(
      `  ${outcome.name.padEnd(width)}  ${outcome.action.padEnd(17)}${outcome.orgId ?? ''}${suffix}\n`,
    );
  }

  if (unmanaged.length > 0) {
    process.stdout.write(
      `\n  ${unmanaged.length} workspace(s) match no target and were left untouched:\n`,
    );
    for (const org of unmanaged) process.stdout.write(`    "${org.name}"  ${org.id}\n`);
    process.stdout.write('  Remove them yourself if they should not be there.\n');
  }

  const failed = outcomes.filter((o) => o.action === 'failed');
  process.stdout.write(
    `\n${failed.length === 0 ? 'All eight workspaces are in place.' : `${failed.length} workspace(s) could not be reconciled.`}\n\n`,
  );
  return failed.length === 0 ? 0 : 1;
}

/** Entry point. */
async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const client = new DocketClient(options.apiUrl, options.cookie);
  const { outcomes, unmanaged } = await provision(client, options.dryRun);
  process.exitCode = report(outcomes, unmanaged, options.dryRun);
}

// Only run when invoked directly; the pure helpers above are imported by the test.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
