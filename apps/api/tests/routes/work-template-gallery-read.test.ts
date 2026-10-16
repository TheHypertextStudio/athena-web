import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../../src/context';
import definitions from '../../src/routes/work-template-definitions';
import { appWithActor } from '../support/routes-harness';

const orgId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const root = `/v1/orgs/${orgId}/templates/definitions/gallery`;
const nested = new Hono<AppEnv>().route('/v1/orgs/:orgId/templates/definitions', definitions);
const app = appWithActor(nested, orgId, ['contribute']);
describe('gallery discovery routes', () => {
  it('serves filtered catalog metadata and actual nested definitions', async () => {
    const response = await app.request(
      `${root}?fork=nonprofit&targetType=project&category=events&limit=100`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { slug: string }[] };
    expect(body.items.some((item) => item.slug === 'event')).toBe(true);
    const detail = await app.request(`${root}/event-series`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      identity: { kind: 'catalog', release: 1 },
      definition: { payload: { targetType: 'program' } },
    });
  });
  it('uses owned validation and not-found responses', async () => {
    expect((await app.request(`${root}?limit=101`)).status).toBe(422);
    expect((await app.request(`${root}/not-an-entry`)).status).toBe(404);
  });
  it('returns the complete starting set independently of browse pagination', async () => {
    const response = await app.request(`${root}/forks/startup`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { fork: string; items: { slug: string }[] };
    expect(body.fork).toBe('startup');
    expect(body.items).toHaveLength(60);
    expect(new Set(body.items.map((item) => item.slug)).size).toBe(60);
    expect((await app.request(`${root}/forks/unknown`)).status).toBe(422);
  });
  it('accepts inherited organization params for the nonprofit fork at the real nested URL', async () => {
    const response = await app.request(`${root}/forks/nonprofit`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      fork: 'nonprofit',
      items: expect.arrayContaining([
        expect.objectContaining({ slug: 'community-event' }),
        expect.objectContaining({ slug: 'grant-application' }),
      ]),
    });
  });
  it('rejects caller authority and destination identity injection before preview executes', async () => {
    const response = await app.request(`${root}/copy-preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        roots: ['event'],
        release: 1,
        mode: 'published',
        actorId: 'invented',
        reservedFirstPublicationId: 'invented',
      }),
    });
    expect(response.status).toBe(422);
  });
});
