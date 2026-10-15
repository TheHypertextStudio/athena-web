import { db } from '@docket/db';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';
import { requireCanonicalRecurrenceAccess } from '../lib/recurrence/schedule-compatibility-access';

/** Apply native private-schedule permissions to every legacy detail or mutation transport. */
export const canonicalRecurrenceAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.param('id');
  if (id) {
    const caller = c.get('actorCtx');
    await requireCanonicalRecurrenceAccess(
      db,
      { organizationId: caller.orgId, actorId: caller.actorId, seriesId: id },
      c.req.method === 'GET' || c.req.method === 'HEAD' ? 'view' : 'manage',
    );
  }
  await next();
};
