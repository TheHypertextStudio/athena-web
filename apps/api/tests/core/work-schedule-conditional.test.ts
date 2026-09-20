import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import { conditionalWriteFor } from '../../src/lib/work-schedule-conditional';

describe('conditional-write operation policy', () => {
  it('rejects If-Match before an unsupported unsafe operation executes', async () => {
    const app = new Hono<AppEnv>();
    let calls = 0;
    app.use('*', conditionalWriteFor(false));
    app.patch('/unsupported', (c) => {
      calls += 1;
      return c.json({ ok: true });
    });
    app.onError(onError);

    const response = await app.request('/unsupported', {
      method: 'PATCH',
      headers: { 'If-Match': '"known"' },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'validation_error' });
    expect(calls).toBe(0);
  });

  it.each(['W/"weak"', '*', 'bare', '"unterminated', '"one",'])(
    'rejects a non-strong work-schedule validator: %s',
    async (ifMatch) => {
      const app = new Hono<AppEnv>();
      let calls = 0;
      app.use('*', conditionalWriteFor('work-schedule'));
      app.put('/schedule', (c) => {
        calls += 1;
        return c.json({ ok: true });
      });
      app.onError(onError);

      const response = await app.request('/schedule', {
        method: 'PUT',
        headers: { 'If-Match': ifMatch },
      });

      expect(response.status).toBe(412);
      expect(await response.json()).toMatchObject({ code: 'precondition_failed' });
      expect(calls).toBe(0);
    },
  );

  it('passes a list of strong validators to the transaction-bound route adapter', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', conditionalWriteFor('work-schedule'));
    app.put('/schedule', (c) => c.json({ ifMatch: c.req.header('If-Match') }));

    const response = await app.request('/schedule', {
      method: 'PUT',
      headers: { 'If-Match': '"older", "current"' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ifMatch: '"older", "current"' });
  });
});
