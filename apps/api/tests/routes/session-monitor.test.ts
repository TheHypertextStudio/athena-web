import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import { accepted } from '../../src/lib/ok';
import type meAthenaRoute from '../../src/routes/me-athena';
import { personalSessionMonitor } from '../../src/routes/session-monitor';
import { getMigratedDb } from '../support/db';
import { fakeSession } from '../support/routes-harness';

let schema: typeof DbModule;
let meAthena: typeof meAthenaRoute;

beforeAll(async () => {
  schema = await getMigratedDb();
  meAthena = (await import('../../src/routes/me-athena')).default;
});

function appFor(ownerUserId: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(ownerUserId));
    await next();
  });
  app.post('/queue/:id', (c) =>
    accepted(
      c,
      z.object({ id: z.string() }),
      { id: c.req.param('id') },
      personalSessionMonitor(c.req.param('id')),
    ),
  );
  app.route('/v1/me/athena', meAthena);
  app.onError(onError);
  return app;
}

describe('accepted Athena session monitors', () => {
  it.each(['pending', 'completed', 'failed', 'canceled'] as const)(
    'follows the returned Location to the %s state',
    async (status) => {
      const suffix = Math.random().toString(36).slice(2, 9);
      const [owner] = await schema.db
        .insert(schema.user)
        .values({ name: 'Monitor owner', email: `monitor-${status}-${suffix}@example.com` })
        .returning({ id: schema.user.id });
      const [session] = await schema.db
        .insert(schema.agentSession)
        .values({
          executorKind: 'athena',
          ownerUserId: assertDefined(owner).id,
          trigger: 'delegation',
          status,
          ...(status === 'pending' ? {} : { endedAt: new Date() }),
        })
        .returning({ id: schema.agentSession.id });
      const app = appFor(assertDefined(owner).id);

      const acceptedResponse = await app.request(`/queue/${assertDefined(session).id}`, {
        method: 'POST',
      });
      expect(acceptedResponse.status).toBe(202);
      const location = acceptedResponse.headers.get('location');
      expect(location).toBe(personalSessionMonitor(assertDefined(session).id));

      const monitor = await app.request(location ?? '');
      expect(monitor.status).toBe(200);
      await expect(monitor.json()).resolves.toMatchObject({ status });
    },
  );
});
