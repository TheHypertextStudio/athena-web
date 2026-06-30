/**
 * `@docket/api` — linked-identities router (mounted at `/v1/me/identities`).
 *
 * @remarks
 * User-scoped surface listing the external identities (Google / GitHub / Linear accounts) the
 * caller linked to their Docket identity. Distinct from org-scoped integrations: an identity is a
 * linked account; an integration *picks* an identity + resources to sync into an org. A Google
 * account's email is decoded server-side from the stored OIDC id token (it is not a column and
 * `listAccounts()` exposes only the `sub`). Requires an active session; unauthenticated callers
 * get HTTP 401.
 */
import { IdentityListOut } from '@docket/types';
import { type Context, Hono } from 'hono';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';

import { linkedIdentities } from './integration-provider';

/** Require an active session; throw 401 if none. */
function requireUserId(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return session.user.id;
}

const meIdentities = new Hono<AppEnv>().get(
  '/',
  apiDoc({ tag: 'Me', summary: 'List linked identities', response: IdentityListOut }),
  async (c) => {
    const userId = requireUserId(c);
    const items = await linkedIdentities(userId);
    return ok(c, IdentityListOut, { items });
  },
);

export default meIdentities;
