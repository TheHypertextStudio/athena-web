import type { Sql } from 'postgres';
import { expect } from 'vitest';

async function assertAuthorityChecks(sql: Sql): Promise<void> {
  await expect(sql`
    insert into oauth_resource_grant (
      id, client_id, user_id, consent_id, authorization_kind, resource_uri,
      created_at, expires_at
    ) values (
      'cross_owner', 'c_normal', 'u_normal', 'consent_held', 'consent',
      'https://api.clearthedocket.com/v1', now(), now() + interval '1 hour'
    )
  `).rejects.toThrow();
  await expect(sql`
    insert into oauth_resource_grant (
      id, client_id, user_id, consent_id, authorization_kind, resource_uri,
      created_at, expires_at
    ) values (
      'missing_consent_kind', 'c_orphan', 'u_orphan', null, 'consent',
      'https://api.clearthedocket.com/v1', now(), now() + interval '1 hour'
    )
  `).rejects.toThrow();
  await expect(sql`
    insert into oauth_resource_grant (
      id, client_id, user_id, consent_id, authorization_kind, resource_uri,
      created_at, expires_at
    ) values (
      'trusted_with_consent', 'c_normal', 'u_normal', 'consent_normal', 'trusted_mcp',
      'https://api.clearthedocket.com/mcp', now(), now() + interval '1 hour'
    )
  `).rejects.toThrow();
  await expect(sql`
    insert into oauth_resource_grant (
      id, client_id, user_id, authorization_kind, resource_uri,
      created_at, expires_at
    ) values (
      'current_null_resource', 'c_orphan', 'u_orphan', 'trusted_mcp', null,
      now(), now() + interval '1 hour'
    )
  `).rejects.toThrow();
  await expect(sql`
    insert into oauth_resource_grant (
      id, client_id, user_id, authorization_kind, resource_uri,
      created_at, expires_at, legacy_before
    ) values (
      'empty_resource', 'c_orphan', 'u_orphan', 'trusted_mcp', '',
      now(), now() + interval '1 hour', now()
    )
  `).rejects.toThrow();
  await expect(sql`
    insert into oauth_jwt_revocation (token_digest, revoked_at, expires_at)
    values ('raw.jwt.token', now(), now() + interval '1 hour')
  `).rejects.toThrow();
  await expect(sql`
    insert into oauth_jwt_revocation (token_digest, revoked_at, expires_at)
    values (${`${'a'.repeat(42)}_`}, now(), now() - interval '1 second')
  `).rejects.toThrow();
}

async function assertLifecycleChecks(sql: Sql, normalGrantId: string): Promise<void> {
  await expect(sql`
    update oauth_refresh_token
    set docket_grant_id = ${normalGrantId}
    where id = 'refresh_orphan'
  `).rejects.toThrow();
  await expect(sql`
    insert into oauth_resource_grant (
      id, client_id, user_id, authorization_kind, resource_uri, created_at, expires_at
    ) values (
      'bad_kind', 'c_orphan', 'u_orphan', 'unknown',
      'https://api.clearthedocket.com/v1', now(), now() + interval '1 hour'
    )
  `).rejects.toThrow();
  await expect(sql`
    insert into oauth_resource_grant (
      id, client_id, user_id, authorization_kind, resource_uri, created_at, expires_at
    ) values (
      'bad_expiry', 'c_orphan', 'u_orphan', 'trusted_mcp',
      'https://api.clearthedocket.com/mcp', now(), now() - interval '1 second'
    )
  `).rejects.toThrow();
  await expect(sql`
    insert into oauth_resource_grant (
      id, client_id, user_id, authorization_kind, resource_uri,
      created_at, expires_at, revoked_at
    ) values (
      'bad_revocation', 'c_orphan', 'u_orphan', 'trusted_mcp',
      'https://api.clearthedocket.com/mcp', now(), now() + interval '1 hour',
      now() - interval '1 second'
    )
  `).rejects.toThrow();
  await sql`
    insert into oauth_resource_grant (
      id, client_id, user_id, authorization_kind, resource_uri,
      created_at, expires_at, legacy_before
    ) values (
      'legacy_unique_a', 'c_orphan', 'u_orphan', 'trusted_mcp', null,
      now(), now() + interval '1 hour', now() - interval '1 hour'
    )
  `;
  await expect(sql`
    insert into oauth_resource_grant (
      id, client_id, user_id, authorization_kind, resource_uri,
      created_at, expires_at, legacy_before
    ) values (
      'legacy_unique_b', 'c_orphan', 'u_orphan', 'trusted_mcp', null,
      now(), now() + interval '1 hour', now() - interval '1 hour'
    )
  `).rejects.toThrow();
}

async function insertCascadeFamily(sql: Sql, suffix: string, userId: string): Promise<void> {
  await sql`
    insert into oauth_client (id, client_id, redirect_uris)
    values (
      ${`cascade_client_row_${suffix}`},
      ${`cascade_client_${suffix}`},
      array['https://client.example.test/callback']
    )
  `;
  await sql`
    insert into oauth_consent (id, client_id, user_id, scopes)
    values (
      ${`cascade_consent_${suffix}`},
      ${`cascade_client_${suffix}`},
      ${userId},
      array['work:read']
    )
  `;
  await sql`
    insert into oauth_resource_grant (
      id, client_id, user_id, consent_id, authorization_kind, resource_uri,
      created_at, expires_at
    ) values (
      ${`cascade_grant_${suffix}`},
      ${`cascade_client_${suffix}`},
      ${userId},
      ${`cascade_consent_${suffix}`},
      'consent', 'https://api.clearthedocket.com/v1', now(), now() + interval '1 hour'
    )
  `;
  await sql`
    insert into oauth_refresh_token (
      id, token, client_id, user_id, expires_at, scopes, docket_grant_id
    ) values (
      ${`cascade_refresh_${suffix}`},
      ${`cascade_refresh_token_${suffix}`},
      ${`cascade_client_${suffix}`},
      ${userId},
      now() + interval '1 hour', array['work:read'], ${`cascade_grant_${suffix}`}
    )
  `;
}

async function familyCounts(sql: Sql, suffix: string): Promise<Record<string, number>> {
  const [counts] = await sql<{ consents: number; grants: number; refreshes: number }[]>`
    select
      (select count(*)::int from oauth_consent where id = ${`cascade_consent_${suffix}`}) as consents,
      (select count(*)::int from oauth_resource_grant where id = ${`cascade_grant_${suffix}`}) as grants,
      (select count(*)::int from oauth_refresh_token where id = ${`cascade_refresh_${suffix}`}) as refreshes
  `;
  if (!counts) throw new Error('Cascade count query returned no row.');
  return counts;
}

async function assertCascadeOwnership(sql: Sql): Promise<void> {
  await insertCascadeFamily(sql, 'consent', 'u_orphan');
  await sql`delete from oauth_consent where id = 'cascade_consent_consent'`;
  expect(await familyCounts(sql, 'consent')).toEqual({ consents: 0, grants: 0, refreshes: 0 });

  await insertCascadeFamily(sql, 'grant', 'u_orphan');
  await sql`delete from oauth_resource_grant where id = 'cascade_grant_grant'`;
  expect(await familyCounts(sql, 'grant')).toEqual({ consents: 1, grants: 0, refreshes: 0 });

  await insertCascadeFamily(sql, 'client', 'u_orphan');
  await sql`delete from oauth_client where client_id = 'cascade_client_client'`;
  expect(await familyCounts(sql, 'client')).toEqual({ consents: 0, grants: 0, refreshes: 0 });

  await sql`
    insert into "user" (id, name, email)
    values ('cascade_user', 'Cascade User', 'cascade-user@example.test')
  `;
  await insertCascadeFamily(sql, 'user', 'cascade_user');
  await sql`delete from "user" where id = 'cascade_user'`;
  expect(await familyCounts(sql, 'user')).toEqual({ consents: 0, grants: 0, refreshes: 0 });
}

/** Assert storage invariants that runtime checks must not be able to bypass. */
export async function assertOAuthResourceGrantStorage(
  sql: Sql,
  normalGrantId: string,
): Promise<void> {
  const [fixedDeadline] = await sql<{ matches: boolean }[]>`
    select expires_at = legacy_before + interval '30 days 15 minutes' as matches
    from oauth_resource_grant
    where client_id = 'c_held' and user_id = 'u_held'
  `;
  expect(fixedDeadline).toEqual({ matches: true });
  await assertAuthorityChecks(sql);
  await assertLifecycleChecks(sql, normalGrantId);
  await assertCascadeOwnership(sql);
}
