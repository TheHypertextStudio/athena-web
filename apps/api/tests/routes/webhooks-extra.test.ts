import { beforeAll, describe, expect, it } from 'vitest';

import { getDb } from './harness.test';
import type webhooksRouter from '../../src/routes/webhooks';

let webhooks!: typeof webhooksRouter;

beforeAll(async () => {
  await getDb();
  webhooks = (await import('../../src/routes/webhooks')).default;
});

const J = { 'content-type': 'application/json' };

describe('webhooks asBillingEvent defensive parse', () => {
  it('400s a non-object body (null / array / primitive)', async () => {
    const nullBody = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: JSON.stringify(null),
    });
    expect(nullBody.status).toBe(400);
    const arr = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: JSON.stringify([1, 2]),
    });
    expect(arr.status).toBe(400);
  });

  it('400s an object missing referenceId/createdAt even with id+type', async () => {
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ id: 'e1', type: 'subscription.updated' }),
    });
    expect(res.status).toBe(400);
  });

  it('400s a body that is not valid JSON (parse catch → null)', async () => {
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: 'not json{',
    });
    expect(res.status).toBe(400);
  });
});
