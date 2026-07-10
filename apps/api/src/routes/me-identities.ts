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
import { account, db, passkey } from '@docket/db';
import { IdentityDeleteOut, IdentityListOut, IdentityProvider } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv, AuthSession } from '../context';
import { AuthError, ConflictError, NotFoundError, ReauthRequiredError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam } from '../lib/validate';

import { linkedIdentities } from './integration-provider';

/** Require an active session; throw 401 if none. */
function requireSession(c: Context<AppEnv>): NonNullable<AuthSession> {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return session;
}

/** Identity unlinking is a high-risk credential change and requires a five-minute-old-or-newer session. */
function requireFreshSession(session: NonNullable<AuthSession>): void {
  const ageMs = Date.now() - new Date(session.session.createdAt).getTime();
  if (ageMs > 5 * 60 * 1000) {
    throw new ReauthRequiredError('Please re-verify your passkey to continue.');
  }
}

/** The exact provider identity addressed by the unlink route. */
const identityParam = z.object({ provider: IdentityProvider, accountId: z.string().min(1) });

const meIdentities = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'List linked identities',
      response: IdentityListOut,
      description: `List the external accounts (Google / GitHub / Linear) the caller has **linked to their Docket identity** via OAuth. An identity is a *linked account* the OAuth grant of which belongs to the user; it is distinct from an org-scoped **integration**, which separately *picks* an identity plus resources to sync into a particular org. For each linked account the caller gets the provider, the provider \`accountId\` (e.g. Google \`sub\` — the stable id an org integration binds to as its \`externalAccountId\`), the granted \`scopes\`, when it was linked, and \`connectionCount\` (the number of org connections that currently depend on it).

The display \`email\`/\`name\`/\`picture\` are **decoded server-side from the stored OIDC \`id_token\`** (Better Auth's \`listAccounts()\` exposes only the \`sub\`); they are nullable because the token can lack a claim and non-OIDC providers (GitHub/Linear) supply none, in which case the UI falls back to the provider name. User-scoped to \`session.user.id\`. Session-only, no capability; **401** when unauthenticated. Related: \`/me/connected-apps\` (apps authorized into Docket, the inverse direction).`,
    }),
    async (c) => {
      const session = requireSession(c);
      const items = await linkedIdentities(session.user.id);
      return ok(c, IdentityListOut, { items });
    },
  )
  .delete(
    '/:provider/:accountId',
    apiDoc({
      tag: 'Me',
      summary: 'Unlink one external identity',
      response: IdentityDeleteOut,
      description: `Unlink exactly one provider identity from the caller. The operation is blocked with **409 \`identity_in_use\`** while any org-scoped Docket connection is bound to this identity; disconnect or rebind those connections first. It also preserves account reachability: removing the caller's last linked sign-in account is blocked unless they have a passkey. Because this changes sign-in credentials, the caller must first complete passkey step-up and present a session created within the last five minutes (**401 \`reauth_required\`** otherwise).`,
    }),
    zParam(identityParam),
    async (c) => {
      const session = requireSession(c);
      requireFreshSession(session);
      const { provider, accountId } = c.req.valid('param');
      const userId = session.user.id;

      const identities = await linkedIdentities(userId);
      const identity = identities.find(
        (candidate) => candidate.provider === provider && candidate.accountId === accountId,
      );
      if (!identity) throw new NotFoundError('Linked identity not found');
      if (identity.connectionCount > 0) {
        throw new ConflictError(
          'Disconnect or rebind every Docket connection using this account before removing it.',
          'identity_in_use',
        );
      }

      const passkeys = await db
        .select({ id: passkey.id })
        .from(passkey)
        .where(eq(passkey.userId, userId))
        .limit(1);
      if (identities.length <= 1 && passkeys.length === 0) {
        throw new ConflictError(
          'Add a passkey or another sign-in account before removing your last linked identity.',
        );
      }

      const removed = await db
        .delete(account)
        .where(
          and(
            eq(account.userId, userId),
            eq(account.providerId, provider),
            eq(account.accountId, accountId),
          ),
        )
        .returning({ id: account.id });
      if (!removed[0]) throw new NotFoundError('Linked identity not found');
      return ok(c, IdentityDeleteOut, { status: true });
    },
  );

export default meIdentities;
