/** `@docket/api` — authenticated passkey management mounted at `/v1/me/passkeys`. */
import { LAST_PASSKEY_MESSAGE, canRemovePasskey } from '@docket/auth';
import { db, passkey } from '@docket/db';
import {
  PasskeyDeleteOut,
  PasskeyListOut,
  PasskeyRenameIn,
  PasskeySummary,
} from '@docket/identity-access/passkey-management-contract';
import { and, desc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv, AuthSession } from '../context';
import { AuthError, CapabilityError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';

/** Require the signed-in person whose credentials are being managed. */
function requireSession(c: Context<AppEnv>): NonNullable<AuthSession> {
  const current = c.get('session');
  if (!current?.user.id) throw new AuthError('Authentication required.');
  return current;
}

const passkeyParam = z.object({ id: z.string().min(1) });

/** The columns a management screen may see; the public key and counter never leave the row. */
const summaryColumns = {
  id: passkey.id,
  name: passkey.name,
  deviceType: passkey.deviceType,
  backedUp: passkey.backedUp,
  transports: passkey.transports,
  aaguid: passkey.aaguid,
  createdAt: passkey.createdAt,
  lastUsedAt: passkey.lastUsedAt,
};
type PasskeyRow = Pick<typeof passkey.$inferSelect, keyof typeof summaryColumns>;

/** One passkey scoped to its owner, so no route can reach another person's credential. */
function ownedBy(id: string, userId: string): ReturnType<typeof and> {
  return and(eq(passkey.id, id), eq(passkey.userId, userId));
}

/** Convert a credential into the deliberately assertion-free management DTO. */
function toSummary(row: PasskeyRow): z.input<typeof PasskeySummary> {
  return {
    id: row.id,
    name: row.name ?? null,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    transports: row.transports?.split(',').filter(Boolean) ?? [],
    aaguid: row.aaguid ?? null,
    createdAt: row.createdAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

const mePasskeys = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'List passkeys',
      response: PasskeyListOut,
      description:
        "List safe summaries of the signed-in user's passkeys. Credential ids, public keys, and counters are never returned.",
    }),
    async (c) => {
      const { user } = requireSession(c);
      const rows = await db
        .select(summaryColumns)
        .from(passkey)
        .where(eq(passkey.userId, user.id))
        .orderBy(desc(passkey.createdAt));
      return ok(c, PasskeyListOut, { items: rows.map(toSummary) });
    },
  )
  .patch(
    '/:id',
    apiDoc({
      tag: 'Me',
      summary: 'Rename a passkey',
      response: PasskeySummary,
      description: 'Rename exactly one passkey owned by the signed-in user.',
    }),
    zParam(passkeyParam),
    zJson(PasskeyRenameIn),
    async (c) => {
      const { user } = requireSession(c);
      const { id } = c.req.valid('param');
      const { name } = c.req.valid('json');
      const [updated] = await db
        .update(passkey)
        .set({ name })
        .where(ownedBy(id, user.id))
        .returning(summaryColumns);
      if (!updated) throw new NotFoundError('Passkey not found.');
      return ok(c, PasskeySummary, toSummary(updated));
    },
  )
  .delete(
    '/:id',
    apiDoc({
      tag: 'Me',
      summary: 'Delete a passkey',
      response: PasskeyDeleteOut,
      description:
        'Delete one owned passkey while preserving account reachability. The credential id is returned only after deletion so a native credential provider can invalidate its stale entry.',
    }),
    zParam(passkeyParam),
    async (c) => {
      const { user } = requireSession(c);
      const { id } = c.req.valid('param');
      const [owned] = await db
        .select({ credentialID: passkey.credentialID })
        .from(passkey)
        .where(ownedBy(id, user.id))
        .limit(1);
      if (!owned) throw new NotFoundError('Passkey not found.');
      if (!(await canRemovePasskey(user.id))) throw new CapabilityError(LAST_PASSKEY_MESSAGE);
      await db.delete(passkey).where(ownedBy(id, user.id));
      return ok(c, PasskeyDeleteOut, { status: true, credentialId: owned.credentialID });
    },
  );

export default mePasskeys;
