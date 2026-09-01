import { describe, expect, it } from 'vitest';

import { createHealthRoutes } from '../../src/routes/health';

/** The shape the liveness route answers with. */
interface HealthBody {
  readonly status: string;
  readonly dependencies: { readonly database: string };
}

describe('liveness probe', () => {
  it('reports healthy while the database answers', async () => {
    const app = createHealthRoutes(() => Promise.resolve('ok'));
    const res = await app.request('/', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    expect(body.dependencies.database).toBe('ok');
  });

  it('fails the probe when the database does not answer', async () => {
    // The whole point of the check: this route used to be a literal and would have reported
    // healthy here, promoting a revision that cannot serve a single request.
    const app = createHealthRoutes(() => Promise.resolve('unreachable'));
    const res = await app.request('/', { method: 'GET' });

    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthBody;
    expect(body.status).not.toBe('ok');
    expect(body.dependencies.database).toBe('unreachable');
  });

  it('names the failing dependency rather than reporting only that something is wrong', async () => {
    const app = createHealthRoutes(() => Promise.resolve('unreachable'));
    const body = (await (await app.request('/', { method: 'GET' })).json()) as HealthBody;

    // "The API is down" and "the API is up but Postgres is not" page different people.
    expect(Object.keys(body.dependencies)).toContain('database');
  });
});
