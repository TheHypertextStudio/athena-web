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
import { canUseGoogleOAuth } from '@docket/auth';
import { workflowIdFor } from '@docket/athena/execution-protocol';
import {
  account,
  actor,
  agentSession,
  agentSessionExternalLink,
  agentSessionRun,
  db,
  passkey,
  sessionActivity,
} from '@docket/db';
import {
  IdentityDeleteOut,
  IdentityListOut,
  IdentityProvider,
} from '@docket/identity-access/identity-contract';
import { and, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv, AuthSession } from '../context';
import { AuthError, ConflictError, NotFoundError, ReauthRequiredError } from '../error';
import { env } from '../env';
import { verifyExternalAgentControl } from '../lib/external-agent-control-token';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';

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
const externalAgentCompleteInput = z.object({ token: z.string().min(1) });
const externalAgentCompleteOutput = z.object({ status: z.literal(true), sessionId: z.string() });

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
      return ok(c, IdentityListOut, {
        items,
        googleOAuth: {
          available: canUseGoogleOAuth(env, session.user.email),
          stage: env.GOOGLE_OAUTH_PUBLIC ? 'public' : 'testing',
        },
      });
    },
  )
  .post(
    '/external-agent-links',
    apiDoc({
      tag: 'Me',
      summary: 'Complete an external Athena identity continuation',
      response: externalAgentCompleteOutput,
      description: `Consume one signed external-agent authentication continuation after the caller links the exact provider account that opened the Athena session. The continuation binds the provider, external actor, and waiting session. Docket also requires the caller to be an active actor in the session's workspace before it resumes the session and queues one run generation. Replays by the same actor are idempotent.`,
    }),
    zJson(externalAgentCompleteInput),
    async (c) => {
      const current = requireSession(c);
      const control = verifyExternalAgentControl(c.req.valid('json').token);
      if (control?.kind !== 'authentication' || control.provider !== 'linear') {
        throw new ConflictError(
          'This account-link request is invalid or expired.',
          'external_identity_mismatch',
        );
      }
      const [linked] = await db
        .select({
          organizationId: agentSessionExternalLink.organizationId,
          provider: agentSessionExternalLink.provider,
          initiatorId: agentSession.initiatorId,
        })
        .from(agentSessionExternalLink)
        .innerJoin(agentSession, eq(agentSession.id, agentSessionExternalLink.sessionId))
        .where(eq(agentSessionExternalLink.sessionId, control.sessionId))
        .limit(1);
      const [identity] = await db
        .select({ id: account.id })
        .from(account)
        .where(
          and(
            eq(account.userId, current.user.id),
            eq(account.providerId, 'linear'),
            eq(account.accountId, control.externalActorId),
          ),
        )
        .limit(1);
      const [member] = linked
        ? await db
            .select({ id: actor.id })
            .from(actor)
            .where(
              and(
                eq(actor.organizationId, linked.organizationId),
                eq(actor.userId, current.user.id),
                eq(actor.kind, 'human'),
                eq(actor.status, 'active'),
              ),
            )
            .limit(1)
        : [];
      if (
        linked?.provider !== control.provider ||
        linked.organizationId !== control.organizationId ||
        !identity ||
        !member ||
        (linked.initiatorId !== null && linked.initiatorId !== member.id)
      ) {
        throw new ConflictError(
          'Link the Linear account that opened this Athena session before continuing.',
          'external_identity_mismatch',
        );
      }
      if (linked.initiatorId === null) {
        await db.transaction(async (tx) => {
          const [resumed] = await tx
            .update(agentSession)
            .set({ initiatorId: member.id, status: 'pending' })
            .where(
              and(
                eq(agentSession.id, control.sessionId),
                eq(agentSession.status, 'awaiting_input'),
              ),
            )
            .returning({ id: agentSession.id });
          if (!resumed) return;
          await tx.insert(sessionActivity).values({
            sessionId: control.sessionId,
            organizationId: linked.organizationId,
            type: 'thought',
            body: { text: 'Account connected. Athena is resuming.' },
          });
          await tx
            .insert(agentSessionRun)
            .values({
              sessionId: control.sessionId,
              organizationId: linked.organizationId,
              generation: 0,
              workflowInstanceId: workflowIdFor(control.sessionId, 0),
              status: 'queued',
              dispatchOrigin: 'unclassified',
            })
            .onConflictDoNothing();
        });
      }
      return ok(c, externalAgentCompleteOutput, { status: true, sessionId: control.sessionId });
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
