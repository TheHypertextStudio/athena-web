/**
 * `@docket/api` — current-account router (mounted at `/v1/me/account`).
 *
 * @remarks
 * Small session-backed surface for settings screens that need the signed-in Docket identity.
 * External linked identities live separately at `/v1/me/identities`.
 */
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';

const MeAccountOut = z
  .object({
    id: z.string(),
    email: z.email(),
    name: z.string().nullable(),
    image: z.string().nullable(),
  })
  .meta({ id: 'MeAccountOut', description: 'The signed-in Docket account.' });

const meAccount = new Hono<AppEnv>().get('/', (c) => {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return ok(c, MeAccountOut, {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
  });
});

export default meAccount;
