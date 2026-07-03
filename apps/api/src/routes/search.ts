/**
 * `@docket/api` — org-scoped semantic search route.
 */
import { SearchOut } from '@docket/types';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zQuery } from '../lib/validate';
import { SearchHttpQuery } from '../search/http';
import { searchWorkspace } from '../search/query';

/** Search within the workspace resolved by `orgContextMiddleware`. */
const searchRouter = new Hono<AppEnv>().get(
  '/',
  apiDoc({
    tag: 'Search',
    summary: 'Search within one organization',
    response: SearchOut,
    description:
      'Return semantic, permission-filtered search results within the current organization. Query params match Hub search, but org scope cannot be widened by `orgIds`.',
  }),
  zQuery(SearchHttpQuery),
  async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { orgId } = c.get('actorCtx');
    const params = c.req.valid('query');
    return ok(
      c,
      SearchOut,
      await searchWorkspace({ scope: 'org', userId: session.user.id, orgId, params }),
    );
  },
);

export default searchRouter;
