import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { AutomationRuleOut } from '@docket/types';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import type automationRulesRouter from '../../src/routes/automation-rules';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let router!: typeof automationRulesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  router = (await import('../../src/routes/automation-rules')).default;
});

const J = { 'content-type': 'application/json' };
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const RULE = {
  name: 'Dismiss promotions',
  on: { kind: 'suggestion.created' },
  when: { op: 'eq', path: 'payload.category', value: 'promotions' },
  then: [{ type: 'suggestion.dismiss', params: {} }],
};

describe('automation-rules router', () => {
  it('creates, lists, updates, and deletes a rule (on/when/then round-trip)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(router, orgId, ['manage'], humanActorId);

    const created = await body<AutomationRuleOut>(
      await w.request('/', { method: 'POST', headers: J, body: JSON.stringify(RULE) }),
    );
    expect(created.name).toBe('Dismiss promotions');
    expect(created.on).toEqual({ kind: 'suggestion.created' });
    expect(created.then[0]?.type).toBe('suggestion.dismiss');
    expect(created.enabled).toBe(true);

    const list = await body<{ items: AutomationRuleOut[] }>(await w.request('/'));
    expect(list.items).toHaveLength(1);

    const toggled = await body<AutomationRuleOut>(
      await w.request(`/${created.id}`, {
        method: 'PATCH',
        headers: J,
        body: JSON.stringify({ enabled: false }),
      }),
    );
    expect(toggled.enabled).toBe(false);

    const del = await w.request(`/${created.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await body<{ items: AutomationRuleOut[] }>(await w.request('/'))).items).toHaveLength(
      0,
    );
  });

  it('requires `manage` for mutations (403) but allows reads', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(router, orgId, ['view'], humanActorId);
    expect(
      (await viewer.request('/', { method: 'POST', headers: J, body: JSON.stringify(RULE) }))
        .status,
    ).toBe(403);
    expect((await viewer.request('/')).status).toBe(200);
  });

  it('isolates rules by tenant', async () => {
    const a = await seedBaseOrg(db, schema);
    const wa = appWithActor(router, a.orgId, ['manage'], a.humanActorId);
    const created = await body<AutomationRuleOut>(
      await wa.request('/', { method: 'POST', headers: J, body: JSON.stringify(RULE) }),
    );
    const b = await seedBaseOrg(db, schema);
    const wb = appWithActor(router, b.orgId, ['manage'], b.humanActorId);
    expect((await body<{ items: AutomationRuleOut[] }>(await wb.request('/'))).items).toHaveLength(
      0,
    );
    expect((await wb.request(`/${created.id}`, { method: 'DELETE' })).status).toBe(404);
  });
});
