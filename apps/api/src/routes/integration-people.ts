import { Hono } from 'hono';
import { z } from 'zod';
import {
  ExternalActorOut,
  ExternalActorPatch,
  ExternalActorResolve,
  ExternalActorCandidate,
} from '@docket/connections/integration-contract';
import type { AppEnv } from '../context';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { externalPersonCandidates, resolveSourcePerson } from '../lib/identity/source-people';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { loadIntegration } from './integration-load';
import { listExternalActorRows } from './integration-list-store';
import { pageResultById } from '../lib/list-cursor';
import { toExternalActorOut } from './integration-identity';

const idParam = z.object({ id: z.string() });
const externalActorParam = z.object({ id: z.string(), externalActorId: z.string() });

/** Provider-neutral workspace identity decisions. */
export const integrationPeople = new Hono<AppEnv>()
  .get(
    '/:id/external-actors',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'List external actor identity mappings',
      capability: 'manage',
      response: pageOf(ExternalActorOut),
      description: `List every \`external_actor\` identity mapping for this integration — one row per provider-side user (e.g. a Linear member) the sync engine has ever seen, as a page of {@link ExternalActorOut}. Includes matched AND unmatched rows: an unmatched row (\`actorId: null\`) is an explicit, queryable state, never hidden or fabricated. \`matchedBy\` distinguishes an legacy \`email\` match (retained for compatibility) from a \`manual\` link (set via \`PATCH /:id/external-actors/:externalActorId\`, immune to re-matching). \`ignoredAt\` splits the unmatched rows again: non-null is a deliberate exclusion, also immune to re-matching, and null means nobody has decided yet. A missing/cross-tenant integration id 404s (\`Integration not found\`).

Requires \`manage\` — reviewing/curating identity mappings is an administrative task, the same bar as the other integration-configuration routes. Related: \`PATCH /:id/external-actors/:externalActorId\` (manually link/unlink one row).`,
    }),
    zParam(idParam),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadIntegration(orgId, id);
      const { cursor, limit } = c.req.valid('query');
      const rows = await listExternalActorRows(orgId, id, { cursor, limit });
      return ok(c, pageOf(ExternalActorOut), pageResultById(rows.map(toExternalActorOut), limit));
    },
  )
  .get(
    '/:id/external-actors/:externalActorId/candidates',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Suggest people for a source identity',
      capability: 'manage',
      response: pageOf(ExternalActorCandidate),
    }),
    zParam(externalActorParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, externalActorId } = c.req.valid('param');
      await loadIntegration(orgId, id);
      return ok(c, pageOf(ExternalActorCandidate), {
        items: await externalPersonCandidates(orgId, id, externalActorId),
      });
    },
  )
  .post(
    '/:id/external-actors/:externalActorId/resolution',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Resolve a source identity',
      capability: 'manage',
      response: ExternalActorOut,
    }),
    zParam(externalActorParam),
    zJson(ExternalActorResolve),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, externalActorId } = c.req.valid('param');
      await loadIntegration(orgId, id);
      return ok(
        c,
        ExternalActorOut,
        toExternalActorOut(
          await resolveSourcePerson(orgId, id, externalActorId, c.req.valid('json')),
        ),
      );
    },
  )
  .patch(
    '/:id/external-actors/:externalActorId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Manually link or unlink an external actor mapping',
      capability: 'manage',
      response: ExternalActorOut,
      description:
        'Link or deliberately unlink a provider identity. Both decisions survive subsequent syncs. The target must be a human in this workspace.',
    }),
    zParam(externalActorParam),
    zJson(ExternalActorPatch),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, externalActorId } = c.req.valid('param');
      const body = c.req.valid('json');
      await loadIntegration(orgId, id);
      const row = await resolveSourcePerson(
        orgId,
        id,
        externalActorId,
        body.actorId ? { action: 'match_existing', actorId: body.actorId } : { action: 'unlink' },
      );
      return ok(c, ExternalActorOut, toExternalActorOut(row));
    },
  );
