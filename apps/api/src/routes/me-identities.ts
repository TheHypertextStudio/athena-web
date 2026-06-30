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
  apiDoc({
    tag: 'Me',
    summary: 'List linked identities',
    response: IdentityListOut,
    description: `List the external accounts (Google / GitHub / Linear) the caller has **linked to their Docket identity** via OAuth. An identity is a *linked account* the OAuth grant of which belongs to the user; it is distinct from an org-scoped **integration**, which separately *picks* an identity plus resources to sync into a particular org. For each linked account the caller gets the provider, the provider \`accountId\` (e.g. Google \`sub\` — the stable id an org integration binds to as its \`externalAccountId\`), the granted \`scopes\`, and when it was linked.

The display \`email\`/\`name\`/\`picture\` are **decoded server-side from the stored OIDC \`id_token\`** (Better Auth's \`listAccounts()\` exposes only the \`sub\`); they are nullable because the token can lack a claim and non-OIDC providers (GitHub/Linear) supply none, in which case the UI falls back to the provider name. User-scoped to \`session.user.id\`. Session-only, no capability; **401** when unauthenticated. Related: \`/me/connected-apps\` (apps authorized into Docket, the inverse direction).`,
  }),
  async (c) => {
    const userId = requireUserId(c);
    const items = await linkedIdentities(userId);
    return ok(c, IdentityListOut, { items });
  },
);

export default meIdentities;
