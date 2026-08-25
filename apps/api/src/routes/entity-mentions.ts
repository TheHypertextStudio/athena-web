/**
 * `@docket/api` — the references an entity's own prose points at.
 *
 * @remarks
 * Mounted once per subject kind, so `/projects/:id/mentions` and `/tasks/:id/mentions` are the same
 * handler with the subject type bound. Read-only and derived: there is no POST here, because the
 * way to add one of these is to write a mention in the prose, and the way to remove one is to
 * delete it from the prose.
 */
import { EntityMentionsOut, type MentionSubjectType } from '@docket/types';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { loadEntityMentions } from '../content/entity-mentions';
import { AuthError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam } from '../lib/validate';
import { buildTaskViewFilter, loadTask } from './task-helpers';

const idParam = z.object({ id: z.string() });

/**
 * Build the mentions router for one subject kind.
 *
 * @param subjectType - The kind of entity this router is mounted under.
 * @param tag - The OpenAPI tag to file the route under.
 * @returns The router.
 */
export function entityMentionRoutes(subjectType: MentionSubjectType, tag: string) {
  return new Hono<AppEnv>().get(
    '/:id/mentions',
    apiDoc({
      tag,
      summary: 'List the references written in this record',
      response: EntityMentionsOut,
      description:
        "Return everything this record's prose points at, derived from its stored Markdown rather than curated. External references carry their resolved metadata; references to Docket entities the caller cannot see are omitted.",
    }),
    zParam(idParam),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');

      if (subjectType === 'task') {
        const task = await loadTask(orgId, id);
        const canView = await buildTaskViewFilter(orgId, actorId);
        if (!canView(task)) throw new NotFoundError('Task not found');
      }

      const result = await loadEntityMentions({
        caller: { kind: 'user', userId: session.user.id },
        orgId,
        subjectType,
        subjectId: id,
      });
      return ok(c, EntityMentionsOut, result);
    },
  );
}
