/**
 * `@docket/api` — declare the provenance of every REST request.
 *
 * @remarks
 * A cookie session is a person in the Docket app, and the app names the part of itself the write
 * came from in the {@link SURFACE_HEADER} header. An OAuth bearer is a third-party client, named
 * by the display name it registered with. Anonymous requests declare nothing; they cannot write
 * work.
 */
import { isAppSurface, SURFACE_HEADER } from '@docket/work/provenance-contract';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../../context';
import { clientDisplayName } from './clients';
import { appProvenance, clientProvenance, runWithProvenance } from './context';

/** Run the rest of the request inside the provenance its caller implies. */
export const provenanceMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const principal = c.get('principal');
  if (!principal) {
    await next();
    return;
  }
  if (principal.kind === 'oauth') {
    const name = clientDisplayName(principal.clientId, principal.clientName);
    await runWithProvenance(clientProvenance('api', { name, id: principal.clientId }), next);
    return;
  }
  const surface = c.req.header(SURFACE_HEADER);
  await runWithProvenance(appProvenance(isAppSurface(surface) ? surface : undefined), next);
};
