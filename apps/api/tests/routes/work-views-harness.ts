import type * as DbModule from '@docket/db';
import { InitiativeWorkViewQueryRequest } from '@docket/work/work-view-contract';
import { beforeAll } from 'vitest';

import type { queryWorkViewFacets as queryWorkViewFacetsFunction } from '../../src/lib/work-views/facets';
import type { reorderWorkView as reorderWorkViewFunction } from '../../src/lib/work-views/order';
import type timeRouter from '../../src/routes/time';
import type workViewRoutes from '../../src/routes/work-views';
import { getDb } from '../support/routes-harness';

process.env['BETTER_AUTH_SECRET'] ??= 'work-view-route-test-secret-at-least-32-characters';

export const JSON_HEADERS = { 'content-type': 'application/json' };

export let schema!: typeof DbModule;
export let workViews!: typeof workViewRoutes;
export let time!: typeof timeRouter;
export let queryWorkViewFacets!: typeof queryWorkViewFacetsFunction;
export let reorderWorkView!: typeof reorderWorkViewFunction;

beforeAll(async () => {
  schema = await getDb();
  workViews = (await import('../../src/routes/work-views')).default;
  time = (await import('../../src/routes/time')).default;
  queryWorkViewFacets = (await import('../../src/lib/work-views/facets')).queryWorkViewFacets;
  reorderWorkView = (await import('../../src/lib/work-views/order')).reorderWorkView;
});

export function initiativeRequest() {
  return InitiativeWorkViewQueryRequest.parse({
    target: 'initiative',
    definition: {
      version: 2,
      target: 'initiative',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['status', 'priority'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    temporaryFilter: null,
    context: { kind: 'organization' },
    limit: 100,
  });
}

export async function grantOrganizationCapability(
  organizationId: string,
  actorId: string,
  capability: 'contribute' | 'assign',
): Promise<void> {
  await schema.db.insert(schema.grant).values({
    organizationId,
    subjectKind: 'actor',
    subjectId: actorId,
    resourceKind: 'organization',
    resourceId: organizationId,
    capabilities: [capability],
    effect: 'allow',
    cascades: true,
  });
}
