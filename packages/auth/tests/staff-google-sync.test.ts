/**
 * Tests for projecting Google Workspace group membership onto `staff_user` rows.
 *
 * @remarks
 * Runs against real PGlite rather than a fake adapter: every safety rule here is about what a
 * row ends up looking like after a write, and a stubbed database would let a wrong `where`
 * clause pass. The directory is a fixture — the point of the port is that these branches are
 * exercisable without a Workspace.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { assertDefined } from '@docket/test-utils';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import {
  highestRoleForGroups,
  isWorkspaceEmail,
  syncAllStaff,
  syncStaffFromGoogle,
  syncStaffOnSignIn,
} from '../src/staff-google-sync';
import { staticGoogleDirectory, type GoogleDirectoryPort } from '../src/google-directory';

const GROUP_ROLES =
  'docket-support@hypertext.studio:support,docket-finance@hypertext.studio:finance,docket-admins@hypertext.studio:superadmin';

const config = { groupRoles: GROUP_ROLES, workspaceDomain: 'hypertext.studio' } as const;

/** A directory that always fails — the "lookup is unavailable" branch. */
const brokenDirectory: GoogleDirectoryPort = {
  groupsFor: () => Promise.reject(new Error('Cloud Identity unreachable')),
};

let db: typeof DbModule.db;
let schema: typeof DbModule;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, {
    migrationsFolder: resolve(import.meta.dirname, '../../db/drizzle'),
  });
});

/** Create a user, optionally with a linked Google account, and return its id. */
async function makeUser(opts: { email?: string; google?: boolean } = {}): Promise<string> {
  const suffix = randomUUID();
  const email = opts.email ?? `op-${suffix}@hypertext.studio`;
  const [row] = await db
    .insert(schema.user)
    .values({ name: 'Operator', email })
    .returning({ id: schema.user.id });
  const userId = assertDefined(row).id;
  if (opts.google !== false) {
    await db
      .insert(schema.account)
      .values({ userId, providerId: 'google', accountId: `google-sub-${suffix}` });
  }
  return userId;
}

/** The `staff_user` row for a user, or undefined. */
async function staffRow(userId: string) {
  const rows = await db
    .select({
      id: schema.staffUser.id,
      role: schema.staffUser.role,
      managedBy: schema.staffUser.managedBy,
      groupsSyncedAt: schema.staffUser.groupsSyncedAt,
    })
    .from(schema.staffUser)
    .where(eq(schema.staffUser.userId, userId))
    .limit(1);
  return rows[0];
}

/** A directory placing `email` in exactly `groups`. */
function directoryFor(email: string, groups: readonly string[]): GoogleDirectoryPort {
  return staticGoogleDirectory({ [email.toLowerCase()]: groups });
}

/** The email of a user id, for building a fixture directory around it. */
async function emailOf(userId: string): Promise<string> {
  const rows = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  return assertDefined(rows[0]).email;
}

describe('highestRoleForGroups', () => {
  const targets = [
    { identifier: 'a@x.dev', role: 'support' as const },
    { identifier: 'b@x.dev', role: 'superadmin' as const },
    { identifier: 'c@x.dev', role: 'finance' as const },
  ];

  it('takes the most privileged tier when several groups match', () => {
    expect(highestRoleForGroups(targets, ['a@x.dev', 'c@x.dev', 'b@x.dev'])).toBe('superadmin');
  });

  it('ignores groups that map to nothing, and reports null when none match', () => {
    expect(highestRoleForGroups(targets, ['unmapped@x.dev', 'c@x.dev'])).toBe('finance');
    expect(highestRoleForGroups(targets, ['unmapped@x.dev'])).toBeNull();
  });
});

describe('isWorkspaceEmail', () => {
  it('accepts everything when no domain is configured', () => {
    expect(isWorkspaceEmail('anyone@gmail.com', undefined)).toBe(true);
  });

  it('matches the configured domain case-insensitively', () => {
    expect(isWorkspaceEmail('Op@Hypertext.Studio', 'hypertext.studio')).toBe(true);
    expect(isWorkspaceEmail('op@gmail.com', 'hypertext.studio')).toBe(false);
  });
});

describe('syncStaffFromGoogle', () => {
  it('grants a group-managed row on first sync', async () => {
    const userId = await makeUser();
    const email = await emailOf(userId);
    const outcome = await syncStaffFromGoogle(
      db,
      directoryFor(email, ['docket-support@hypertext.studio']),
      { userId, config },
    );

    expect(outcome).toEqual({ status: 'granted', role: 'support' });
    const row = assertDefined(await staffRow(userId));
    expect(row.role).toBe('support');
    expect(row.managedBy).toBe('google_group');
    expect(row.groupsSyncedAt).toBeInstanceOf(Date);
  });

  it('promotes and demotes in place as membership changes', async () => {
    const userId = await makeUser();
    const email = await emailOf(userId);
    await syncStaffFromGoogle(db, directoryFor(email, ['docket-support@hypertext.studio']), {
      userId,
      config,
    });

    const promoted = await syncStaffFromGoogle(
      db,
      directoryFor(email, ['docket-admins@hypertext.studio']),
      { userId, config },
    );
    expect(promoted).toEqual({ status: 'updated', role: 'superadmin', previousRole: 'support' });

    // A second superadmin exists here, so demoting this one is not the last-superadmin case.
    const other = await makeUser();
    await syncStaffFromGoogle(
      db,
      directoryFor(await emailOf(other), ['docket-admins@hypertext.studio']),
      { userId: other, config },
    );

    const demoted = await syncStaffFromGoogle(
      db,
      directoryFor(email, ['docket-finance@hypertext.studio']),
      { userId, config },
    );
    expect(demoted).toEqual({ status: 'updated', role: 'finance', previousRole: 'superadmin' });
  });

  it('revokes when every mapped group membership is gone', async () => {
    const userId = await makeUser();
    const email = await emailOf(userId);
    await syncStaffFromGoogle(db, directoryFor(email, ['docket-support@hypertext.studio']), {
      userId,
      config,
    });

    const outcome = await syncStaffFromGoogle(db, directoryFor(email, []), { userId, config });

    expect(outcome).toEqual({ status: 'revoked', previousRole: 'support' });
    expect(await staffRow(userId)).toBeUndefined();
  });

  it('never revokes when the directory lookup fails', async () => {
    const userId = await makeUser();
    const email = await emailOf(userId);
    await syncStaffFromGoogle(db, directoryFor(email, ['docket-support@hypertext.studio']), {
      userId,
      config,
    });

    await expect(syncStaffFromGoogle(db, brokenDirectory, { userId, config })).rejects.toThrow(
      /unreachable/,
    );
    expect(assertDefined(await staffRow(userId)).role).toBe('support');
  });

  it('never touches a manually granted row', async () => {
    const userId = await makeUser();
    await db.insert(schema.staffUser).values({ userId, role: 'superadmin', managedBy: 'manual' });

    const outcome = await syncStaffFromGoogle(db, directoryFor(await emailOf(userId), []), {
      userId,
      config,
    });

    expect(outcome).toEqual({ status: 'manual', role: 'superadmin' });
    expect(assertDefined(await staffRow(userId)).role).toBe('superadmin');
  });

  it('grants nothing to an account with no linked Google identity', async () => {
    const userId = await makeUser({ google: false });
    const outcome = await syncStaffFromGoogle(
      db,
      directoryFor(await emailOf(userId), ['docket-admins@hypertext.studio']),
      { userId, config },
    );

    expect(outcome).toEqual({ status: 'not-operator' });
    expect(await staffRow(userId)).toBeUndefined();
  });

  it('grants nothing to an account outside the Workspace domain', async () => {
    const userId = await makeUser({ email: `outsider-${randomUUID()}@gmail.com` });
    const outcome = await syncStaffFromGoogle(
      db,
      directoryFor(await emailOf(userId), ['docket-admins@hypertext.studio']),
      { userId, config },
    );

    expect(outcome).toEqual({ status: 'not-operator' });
    expect(await staffRow(userId)).toBeUndefined();
  });

  it('grants nothing when the group mapping is malformed, rather than throwing', async () => {
    const userId = await makeUser();
    const outcome = await syncStaffFromGoogle(
      db,
      directoryFor(await emailOf(userId), ['docket-admins@hypertext.studio']),
      { userId, config: { groupRoles: 'docket-admins@hypertext.studio:root' } },
    );

    expect(outcome).toEqual({ status: 'not-operator' });
    expect(await staffRow(userId)).toBeUndefined();
  });

  it('leaves an existing operator alone when the group mapping is malformed', async () => {
    const userId = await makeUser();
    const email = await emailOf(userId);
    await syncStaffFromGoogle(db, directoryFor(email, ['docket-finance@hypertext.studio']), {
      userId,
      config,
    });

    const outcome = await syncStaffFromGoogle(db, directoryFor(email, []), {
      userId,
      config: { groupRoles: 'docket-admins@hypertext.studio:root' },
    });

    // Critically NOT 'revoked': a config typo must not read as "this person left every group".
    expect(outcome).toEqual({ status: 'unchanged', role: 'finance' });
    expect(assertDefined(await staffRow(userId)).role).toBe('finance');
  });

  it('grants nothing when no groups are mapped at all', async () => {
    const userId = await makeUser();
    const outcome = await syncStaffFromGoogle(
      db,
      directoryFor(await emailOf(userId), ['docket-admins@hypertext.studio']),
      { userId, config: { groupRoles: undefined } },
    );

    expect(outcome).toEqual({ status: 'not-operator' });
  });

  it('grants nothing when the account has been deleted mid-sweep', async () => {
    const userId = await makeUser();
    await db.delete(schema.user).where(eq(schema.user.id, userId));

    const outcome = await syncStaffFromGoogle(db, directoryFor('gone@hypertext.studio', []), {
      userId,
      config,
    });

    expect(outcome).toEqual({ status: 'not-operator' });
  });

  it('records an unchanged sync without rewriting the tier', async () => {
    const userId = await makeUser();
    const email = await emailOf(userId);
    const directory = directoryFor(email, ['docket-finance@hypertext.studio']);
    await syncStaffFromGoogle(db, directory, { userId, config });

    const outcome = await syncStaffFromGoogle(db, directory, { userId, config });

    expect(outcome).toEqual({ status: 'unchanged', role: 'finance' });
    expect(assertDefined(await staffRow(userId)).role).toBe('finance');
  });

  it('writes an audit trail attributed to the system', async () => {
    const userId = await makeUser();
    await syncStaffFromGoogle(
      db,
      directoryFor(await emailOf(userId), ['docket-support@hypertext.studio']),
      { userId, config },
    );

    const row = assertDefined(await staffRow(userId));
    const events = await db
      .select({
        type: schema.operatorAuditEvent.type,
        staffUserId: schema.operatorAuditEvent.staffUserId,
        metadata: schema.operatorAuditEvent.metadata,
      })
      .from(schema.operatorAuditEvent)
      .where(eq(schema.operatorAuditEvent.subjectId, row.id));

    expect(events).toHaveLength(1);
    expect(assertDefined(events[0]).type).toBe('staff.granted');
    expect(assertDefined(events[0]).staffUserId).toBeNull();
    expect(assertDefined(events[0]).metadata).toMatchObject({ source: 'google_group' });
  });
});

describe('syncStaffOnSignIn', () => {
  it('swallows a directory failure so a broken lookup cannot break the OAuth callback', async () => {
    const userId = await makeUser();

    await expect(syncStaffOnSignIn(db, brokenDirectory, { userId, config })).resolves.toBeNull();
  });

  it('returns the outcome when the lookup succeeds', async () => {
    const userId = await makeUser();
    const outcome = await syncStaffOnSignIn(
      db,
      directoryFor(await emailOf(userId), ['docket-support@hypertext.studio']),
      { userId, config },
    );

    expect(outcome).toEqual({ status: 'granted', role: 'support' });
  });
});

describe('syncAllStaff', () => {
  it('sweeps group-managed rows and leaves manual ones alone', async () => {
    const keeper = await makeUser();
    const loser = await makeUser();
    const manual = await makeUser();
    const keeperEmail = await emailOf(keeper);

    const grantAll = staticGoogleDirectory({
      [keeperEmail]: ['docket-support@hypertext.studio'],
      [await emailOf(loser)]: ['docket-support@hypertext.studio'],
    });
    await syncStaffFromGoogle(db, grantAll, { userId: keeper, config });
    await syncStaffFromGoogle(db, grantAll, { userId: loser, config });
    await db
      .insert(schema.staffUser)
      .values({ userId: manual, role: 'support', managedBy: 'manual' });

    // The loser is no longer in any group; the keeper still is.
    const afterRemoval = staticGoogleDirectory({
      [keeperEmail]: ['docket-support@hypertext.studio'],
    });
    const sweep = await syncAllStaff(db, afterRemoval, config);

    // Counts are asserted as floors, not equalities: the sweep is global and this suite shares
    // one PGlite database, so operators created by earlier cases are legitimately in scope too.
    expect(sweep.examined).toBeGreaterThanOrEqual(2);
    expect(sweep.changed).toBeGreaterThanOrEqual(1);
    expect(sweep.failed).toBe(0);
    expect(await staffRow(loser)).toBeUndefined();
    expect(assertDefined(await staffRow(keeper)).role).toBe('support');
    expect(assertDefined(await staffRow(manual)).role).toBe('support');
  });

  it('counts a failed lookup without revoking that operator', async () => {
    const userId = await makeUser();
    await syncStaffFromGoogle(
      db,
      directoryFor(await emailOf(userId), ['docket-support@hypertext.studio']),
      { userId, config },
    );

    const sweep = await syncAllStaff(db, brokenDirectory, config);

    expect(sweep.failed).toBeGreaterThanOrEqual(1);
    expect(assertDefined(await staffRow(userId)).role).toBe('support');
  });
});

describe('isAdminOrigin', () => {
  const base = { ADMIN_URL: 'https://admin.docket.test' } as const;

  it('matches the configured console origin', async () => {
    const { isAdminOrigin } = await import('../src/auth-builder');
    expect(isAdminOrigin(base as never, 'https://admin.docket.test')).toBe(true);
    // Path and trailing slash are irrelevant — only the origin is compared.
    expect(isAdminOrigin(base as never, 'https://admin.docket.test/sign-in')).toBe(true);
  });

  it('rejects any other origin, a missing origin, and an unparseable one', async () => {
    const { isAdminOrigin } = await import('../src/auth-builder');
    expect(isAdminOrigin(base as never, 'https://docket.test')).toBe(false);
    expect(isAdminOrigin(base as never, null)).toBe(false);
    expect(isAdminOrigin(base as never, 'not a url')).toBe(false);
  });

  it('fails closed when no console origin is configured', async () => {
    const { isAdminOrigin } = await import('../src/auth-builder');
    expect(isAdminOrigin({} as never, 'https://admin.docket.test')).toBe(false);
  });
});

describe('adminGoogleSsoEnabled', () => {
  it('requires both the switch and a reachable directory', async () => {
    const { adminGoogleSsoEnabled } = await import('../src/auth-builder');
    const directory = staticGoogleDirectory({});
    expect(
      adminGoogleSsoEnabled(
        { ADMIN_GOOGLE_SSO_ENABLED: true } as never,
        { googleDirectory: directory } as never,
      ),
    ).toBe(true);
    expect(adminGoogleSsoEnabled({ ADMIN_GOOGLE_SSO_ENABLED: true } as never, {} as never)).toBe(
      false,
    );
    expect(
      adminGoogleSsoEnabled(
        { ADMIN_GOOGLE_SSO_ENABLED: false } as never,
        { googleDirectory: directory } as never,
      ),
    ).toBe(false);
  });
});

describe('syncStaffOnGoogleCallback', () => {
  const enabled = {
    ADMIN_GOOGLE_SSO_ENABLED: true,
    ADMIN_GOOGLE_GROUP_ROLES: GROUP_ROLES,
    GOOGLE_WORKSPACE_DOMAIN: 'hypertext.studio',
  } as const;

  it('grants operator access to the account that just signed in', async () => {
    const { syncStaffOnGoogleCallback } = await import('../src/auth-builder');
    const userId = await makeUser();
    const directory = directoryFor(await emailOf(userId), ['docket-finance@hypertext.studio']);

    await syncStaffOnGoogleCallback(enabled as never, { googleDirectory: directory } as never, {
      user: { id: userId },
    });

    expect(assertDefined(await staffRow(userId)).role).toBe('finance');
  });

  it('does nothing when the callback minted no session — an account link is not a sign-in', async () => {
    const { syncStaffOnGoogleCallback } = await import('../src/auth-builder');
    const userId = await makeUser();
    const directory = directoryFor(await emailOf(userId), ['docket-admins@hypertext.studio']);

    await syncStaffOnGoogleCallback(
      enabled as never,
      { googleDirectory: directory } as never,
      null,
    );

    expect(await staffRow(userId)).toBeUndefined();
  });

  it('does nothing when operator SSO is off, or when no directory is mounted', async () => {
    const { syncStaffOnGoogleCallback } = await import('../src/auth-builder');
    const userId = await makeUser();
    const directory = directoryFor(await emailOf(userId), ['docket-admins@hypertext.studio']);

    await syncStaffOnGoogleCallback(
      { ...enabled, ADMIN_GOOGLE_SSO_ENABLED: false } as never,
      { googleDirectory: directory } as never,
      { user: { id: userId } },
    );
    await syncStaffOnGoogleCallback(enabled as never, {} as never, { user: { id: userId } });

    expect(await staffRow(userId)).toBeUndefined();
  });
});

describe('the operator-SSO exemption on the staged Google rollout', () => {
  const staged = {
    APP_MODE: 'production',
    GOOGLE_OAUTH_PUBLIC: false,
    ADMIN_GOOGLE_SSO_ENABLED: true,
    ADMIN_URL: 'https://admin.docket.test',
  } as const;

  /** Invoke the built `before` hook for a Google `/sign-in/social` from `origin`. */
  async function startGoogleSignIn(
    origin: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    const { buildAuthOptions } = await import('../src/auth-builder');
    const { env } = await import('@docket/env/api');
    const options = buildAuthOptions(
      { ...env, ...staged, ...overrides },
      {
        mailer: { send: () => Promise.resolve(undefined) },
        googleDirectory: staticGoogleDirectory({}),
      },
    );
    const before = (options.hooks as { before: (c: unknown) => Promise<unknown> }).before;
    await before({
      path: '/sign-in/social',
      body: { provider: 'google' },
      headers: new Headers({ origin }),
    });
  }

  it('lets the operator console start Google sign-in while the product rollout is staged', async () => {
    await expect(startGoogleSignIn('https://admin.docket.test')).resolves.toBeUndefined();
  });

  it('still refuses the product app, which is what the staged rollout is about', async () => {
    await expect(startGoogleSignIn('https://docket.test')).rejects.toThrow(
      /private production testing/,
    );
  });

  it('refuses the console too when operator SSO is switched off', async () => {
    await expect(
      startGoogleSignIn('https://admin.docket.test', { ADMIN_GOOGLE_SSO_ENABLED: false }),
    ).rejects.toThrow(/private production testing/);
  });
});

describe('the Google callback hook', () => {
  /** Invoke the built `after` hook directly with a minimal context. */
  async function runAfterHook(
    ctx: { path: string; context: { newSession: { user: { id: string } } | null } },
    overrides: Record<string, unknown> = {},
    directory?: GoogleDirectoryPort,
  ): Promise<void> {
    const { buildAuthOptions } = await import('../src/auth-builder');
    const { env } = await import('@docket/env/api');
    const options = buildAuthOptions(
      { ...env, ...overrides },
      {
        mailer: { send: () => Promise.resolve(undefined) },
        ...(directory ? { googleDirectory: directory } : {}),
      },
    );
    const after = (options.hooks as { after: (c: unknown) => Promise<unknown> }).after;
    await after(ctx);
  }

  it('grants operator access on the callback that mints a session', async () => {
    const userId = await makeUser();
    const directory = directoryFor(await emailOf(userId), ['docket-support@hypertext.studio']);

    await runAfterHook(
      { path: '/callback/google', context: { newSession: { user: { id: userId } } } },
      {
        ADMIN_GOOGLE_SSO_ENABLED: true,
        ADMIN_GOOGLE_GROUP_ROLES: GROUP_ROLES,
        GOOGLE_WORKSPACE_DOMAIN: 'hypertext.studio',
      },
      directory,
    );

    expect(assertDefined(await staffRow(userId)).role).toBe('support');
  });

  it('ignores a callback that minted no session, so linking Google never re-grades a tier', async () => {
    const userId = await makeUser();
    const directory = directoryFor(await emailOf(userId), ['docket-admins@hypertext.studio']);

    await runAfterHook(
      { path: '/callback/google', context: { newSession: null } },
      {
        ADMIN_GOOGLE_SSO_ENABLED: true,
        ADMIN_GOOGLE_GROUP_ROLES: GROUP_ROLES,
        GOOGLE_WORKSPACE_DOMAIN: 'hypertext.studio',
      },
      directory,
    );

    expect(await staffRow(userId)).toBeUndefined();
  });

  it('leaves a failed callback answering normally rather than 500-ing from the sync', async () => {
    const { auth } = await import('../src/index');

    // No state cookie, so the callback fails and redirects to Better Auth's error page. The point
    // is that it still gets there: the staff-sync branch runs on this path, and a throw inside it
    // would surface here as a broken OAuth callback rather than as a missing operator grant.
    const response = await auth.handler(
      new Request('http://localhost:4000/api/auth/callback/google?state=x&code=y', {
        headers: { origin: 'http://localhost:4000' },
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/api/auth/error');
  });
});

describe('last-superadmin protection', () => {
  /**
   * Empty the operator table so a case can control the superadmin population precisely.
   *
   * @remarks
   * Every row, not just the group-managed ones: `superadminCount` counts manual rows too (that
   * is the point — a manual break-glass superadmin is exactly the row that makes revoking a
   * group-managed one safe), so an earlier case's manual grant would otherwise mask the branch.
   */
  async function clearAllStaff(): Promise<void> {
    await db.delete(schema.staffUser);
  }

  it('refuses to revoke the only remaining superadmin', async () => {
    await clearAllStaff();
    const userId = await makeUser();
    const email = await emailOf(userId);
    await syncStaffFromGoogle(db, directoryFor(email, ['docket-admins@hypertext.studio']), {
      userId,
      config,
    });

    const outcome = await syncStaffFromGoogle(db, directoryFor(email, []), { userId, config });

    expect(outcome).toEqual({ status: 'kept-last-superadmin', role: 'superadmin' });
    expect(assertDefined(await staffRow(userId)).role).toBe('superadmin');
  });

  it('refuses to demote the only remaining superadmin', async () => {
    await clearAllStaff();
    const userId = await makeUser();
    const email = await emailOf(userId);
    await syncStaffFromGoogle(db, directoryFor(email, ['docket-admins@hypertext.studio']), {
      userId,
      config,
    });

    const outcome = await syncStaffFromGoogle(
      db,
      directoryFor(email, ['docket-support@hypertext.studio']),
      { userId, config },
    );

    expect(outcome).toEqual({ status: 'kept-last-superadmin', role: 'superadmin' });
    expect(assertDefined(await staffRow(userId)).role).toBe('superadmin');
  });
});
