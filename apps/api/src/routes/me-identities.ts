/**
 * `@docket/api` — linked-identities router (mounted at `/v1/me/identities`).
 *
 * @remarks
 * User-scoped surface listing the external identities (today, Google accounts) the caller linked
 * to their Docket identity. Distinct from org-scoped integrations: an identity is a linked
 * account; an integration *picks* an identity + resources to sync into an org. The email is
 * decoded server-side from the stored OIDC id token (it is not a column and `listAccounts()`
 * exposes only the `sub`). Requires an active session; unauthenticated callers get HTTP 401.
 */
import { IdentityListOut } from '@docket/types';
import { type Context, Hono } from 'hono';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';

import { googleIdentities } from './integration-provider';

/** Require an active session; throw 401 if none. */
function requireUserId(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return session.user.id;
}

const meIdentities = new Hono<AppEnv>().get('/', async (c) => {
  const userId = requireUserId(c);
  const items = await googleIdentities(userId);
  return ok(c, IdentityListOut, { items });
});

export default meIdentities;
