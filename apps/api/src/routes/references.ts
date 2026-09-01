/**
 * `@docket/api` — the inbound-reference (backlink) read.
 *
 * @remarks
 * One route for every target kind, rather than one mount per entity as the outbound
 * `entityMentionRoutes` does, because the question is identical whatever is being pointed at and
 * the target kind is already a path segment. Read-only and derived: a backlink is created by
 * writing a reference in some record's prose, and removed by deleting it from there.
 */
import { EntityReferencesOut } from '../contracts/mention';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { loadInboundReferences } from '../content/entity-references';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam } from '../lib/validate';

const referencesParam = z.object({ targetKind: z.string(), targetId: z.string() });

/** Backlinks for one entity or external resource in the current workspace. */
const referencesRouter = new Hono<AppEnv>().get(
  '/:targetKind/:targetId',
  apiDoc({
    tag: 'Search',
    summary: 'List the records that use this one',
    response: EntityReferencesOut,
    description:
      'Return every record that uses this entity or external resource, grouped by record kind. Resource uses include structured prose references and direct attachments. Records the caller cannot see are omitted rather than counted.',
  }),
  zParam(referencesParam),
  async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { orgId } = c.get('actorCtx');
    const { targetKind, targetId } = c.req.valid('param');

    return ok(
      c,
      EntityReferencesOut,
      await loadInboundReferences({
        caller: { kind: 'user', userId: session.user.id },
        orgId,
        targetKind,
        targetId,
      }),
    );
  },
);

export default referencesRouter;
