/**
 * `@docket/api` — the Notion mirror router (mounted at `/v1/orgs/:orgId/integrations/:id/notion`).
 *
 * @remarks
 * The read/write surface behind the table designer and the Notion settings page. Nested under an
 * integration because a mirror only exists relative to one connected Notion workspace: the same
 * org can hold two Notion connections and each designs its own databases.
 *
 * Everything here is design-time and reads the database only. Provisioning and syncing live in
 * `notion-mirror-reconcile.ts` and run on the shared leased spine, so no route in this file can
 * block on Notion being reachable.
 *
 * @see `docs/engineering/specs/notion-sync.md`
 */
import { actor, db, externalActor, integration } from '@docket/db';
import {
  NotionMirrorDatabaseOut,
  SyncRunOut,
  NotionMirrorDesignOut,
  NotionMirrorDesignPatch,
  NotionMirrorEntity,
  NotionWorkspacePerson,
  pageOf,
} from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { buildNotionMirror } from '../container';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

import { resolveConnectorToken } from './integration-provider';
import { toSyncRunOut } from './integration-sync';
import { runNotionMirrorSync } from './notion-mirror-reconcile';
import {
  applyDesignPatch,
  buildDesignOut,
  ensureDesigns,
  loadDesign,
  toMirrorDatabaseOut,
} from './notion-mirror-design';

/** Path params for the mirror routes, which are nested under an integration. */
const mirrorParam = z.object({ id: z.string() });
/** Path params for one entity's design. */
const entityParam = z.object({ id: z.string(), entity: NotionMirrorEntity });

/** Load the integration, asserting it exists in this org and is the Notion connector. */
async function assertNotionIntegration(
  orgId: string,
  id: string,
): Promise<typeof integration.$inferSelect> {
  const rows = await db
    .select()
    .from(integration)
    .where(and(eq(integration.id, id), eq(integration.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  // Existence-hiding: a cross-tenant id and a non-Notion id answer the same way, so neither
  // confirms that some other workspace's integration exists.
  if (row?.provider !== 'notion') throw new NotFoundError('Integration not found');
  return row;
}

/**
 * Resolve the Notion access token for a read-only provider call.
 *
 * @remarks
 * Returns undefined in local/test mode, where the container hands back the in-memory mirror and
 * no token is meaningful.
 */
async function mirrorToken(
  c: { get: (k: 'actorCtx') => { orgId: string } },
  id: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ createdBy: integration.createdBy, externalAccountId: integration.externalAccountId })
    .from(integration)
    .where(eq(integration.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  const result = await resolveConnectorToken(row.createdBy, 'notion', row.externalAccountId);
  if (!result.ok || result.token === 'mock') return undefined;
  return result.token;
}

/** The Notion mirror router. */
export const notionMirrorApp = new Hono<AppEnv>()
  .get(
    '/databases',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'List the Docket-designed Notion databases',
      capability: 'manage',
      response: pageOf(NotionMirrorDatabaseOut),
      description: `Every Docket-designed Notion database for this integration, in designer order, as a page of {@link NotionMirrorDatabaseOut}. Seeds the nine entity designs from the catalog defaults on first call, titled with the org's own vocabulary — so a nonprofit workspace sees "Campaigns" rather than "Initiatives" without configuring anything.

A row here NEVER implies anything exists in Notion. \`externalDatabaseId\` is null and \`provisionedAt\` is null until the provisioning pass has actually created the database, which keeps the "never report success when nothing happened" invariant true for a design that has only been shaped.

Requires \`manage\`: shaping what a workspace publishes into a third-party tool is an administrative act, the same bar as the other integration-configuration routes.`,
    }),
    zParam(mirrorParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await assertNotionIntegration(orgId, id);
      const rows = await ensureDesigns(orgId, id, c.get('actorCtx').actorId);
      return ok(c, pageOf(NotionMirrorDatabaseOut), { items: rows.map(toMirrorDatabaseOut) });
    },
  )
  .get(
    '/design/:entity',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Read one entity"s table design and preview',
      capability: 'manage',
      response: NotionMirrorDesignOut,
      description: `The table designer's payload for one entity: the current column set, every Docket field the entity could expose, and a short preview of how the Notion database will actually look.

The preview rows are the workspace's **real** records wherever there are any — the point of the surface is to show your own work in the shape it will take, not a schema diagram. When the workspace has none of that entity yet, \`sample\` is true and the rows are illustrative; the UI must say so, because a designer that quietly shows invented data teaches the reader to distrust every number on it.

\`excludedRows\` reports work withheld from the projection: tasks already linked to a database on this same integration are skipped, since projecting them would put the same work in this Notion workspace twice. Reporting the count is what stops the row total from reading as data loss.`,
    }),
    zParam(entityParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, entity } = c.req.valid('param');
      await assertNotionIntegration(orgId, id);
      await ensureDesigns(orgId, id, c.get('actorCtx').actorId);
      return ok(c, NotionMirrorDesignOut, await buildDesignOut(orgId, id, entity));
    },
  )
  .patch(
    '/design/:entity',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Rename or reshape one entity"s Notion database',
      capability: 'manage',
      response: NotionMirrorDesignOut,
      description: `Change a designed database: its title, whether it is projected at all, and its columns. \`columns\` is a **wholesale replace** and its order is the column order, so a field omitted from the array is dropped from the design.

Two rules are enforced rather than trusted. The required title column cannot be removed (Notion requires exactly one title property, so a design without it could never be provisioned — better refused here, while the user is looking at the designer, than at provision time with no context). And a column must name a field the entity actually exposes, so a stale client cannot persist a binding the sync engine has no way to fill. Either violation is a 409.

A rename never re-binds. Provisioned columns keep their Notion \`propertyId\`, which is the identity; the title is only a label. That is what makes renaming safe from either side — including a rename made inside Notion, which Docket leaves alone rather than fighting over.`,
    }),
    zParam(entityParam),
    zJson(NotionMirrorDesignPatch),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, entity } = c.req.valid('param');
      const body = c.req.valid('json');
      await assertNotionIntegration(orgId, id);
      await ensureDesigns(orgId, id, c.get('actorCtx').actorId);
      const row = await loadDesign(orgId, id, entity);
      await applyDesignPatch(row, body);
      return ok(c, NotionMirrorDesignOut, await buildDesignOut(orgId, id, entity));
    },
  )
  .get(
    '/parent-pages',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'List Notion pages a database can be created under',
      capability: 'manage',
      response: pageOf(z.object({ id: z.string(), title: z.string() })),
      description: `The Notion pages this integration may parent its designed databases under — the pages the person shared with Docket during consent.

An empty list is a legitimate and common state, not an error: a public Notion integration only sees what it was explicitly granted. The setup flow must say so and offer a re-consent path rather than presenting it as a failure.`,
    }),
    zParam(mirrorParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await assertNotionIntegration(orgId, id);
      const token = await mirrorToken(c, id);
      const pages = await buildNotionMirror(token).listParentPages();
      return ok(c, pageOf(z.object({ id: z.string(), title: z.string() })), {
        items: pages.map((page) => ({ id: page.id, title: page.title })),
      });
    },
  )
  .post(
    '/provision',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Create the designed databases in Notion',
      capability: 'manage',
      response: SyncRunOut,
      description: `Record the chosen parent page and run a full mirror pass: create every designed-but-missing database, read back any Notion edits, then project Docket's rows.

Runs on the shared leased sync spine, so it returns a real {@link SyncRunOut} with the same durable history as every other sync — a failure is recorded rather than surfaced as an optimistic 200. A pass that exhausts its Notion write budget reports what it actually wrote and resumes on the next sweep instead of claiming completion.

Requires \`manage\`. Returns 409 when another run already holds the integration's lease.`,
    }),
    zParam(mirrorParam),
    zJson(z.object({ containerPageId: z.string().min(1) })),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { containerPageId } = c.req.valid('json');
      const row = await assertNotionIntegration(orgId, id);
      await ensureDesigns(orgId, id, actorId);

      // Spread the existing config: `config` is a wholesale replace, so writing only the mirror
      // key would drop `listIds` and silently unlink every database the other mode syncs.
      const config = row.config;
      const updated = await db
        .update(integration)
        .set({ config: { ...config, notionMirror: { containerPageId } } })
        .where(eq(integration.id, id))
        .returning();
      const fresh = updated[0];
      /* v8 ignore next -- @preserve defensive: the row was loaded in this same request. */
      if (!fresh) throw new NotFoundError('Integration not found');

      const run = await runNotionMirrorSync(fresh, { actorId, trigger: 'manual' });
      if (!run) throw new ConflictError('A sync is already running for this connection.');
      return ok(c, SyncRunOut, toSyncRunOut(run));
    },
  )
  .get(
    '/people',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'List Notion workspace members and their Docket matches',
      capability: 'manage',
      response: pageOf(NotionWorkspacePerson),
      description: `Every Notion workspace member the sync engine has seen, with the Docket actor each is matched to. Reads the stored \`external_actor\` rows rather than calling Notion, so the people surface renders instantly and works while the connection is down; the rows are refreshed by the sync pass.

\`actorId: null\` is an explicit, queryable unmatched state — never hidden and never quietly defaulted to somebody. An unmatched person's assignments cannot reach Docket, which is what the surface has to make obvious.

Notion's own user list mixes integration bots in with people (a real workspace usually has several); those are filtered out at the provider edge, because offering an automation as an assignable teammate would be nonsense.`,
    }),
    zParam(mirrorParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await assertNotionIntegration(orgId, id);
      const rows = await db
        .select()
        .from(externalActor)
        .where(and(eq(externalActor.integrationId, id), eq(externalActor.organizationId, orgId)));
      return ok(c, pageOf(NotionWorkspacePerson), {
        items: rows.map((row) => ({
          externalId: row.externalId,
          name: row.displayName,
          email: row.email,
          avatarUrl: row.avatarUrl,
          actorId: row.actorId,
          matchedBy: row.matchedBy,
        })),
      });
    },
  )
  .get(
    '/unmatched-people',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Count Docket people with no Notion account',
      capability: 'manage',
      response: z.object({
        docketOnly: z
          .number()
          .int()
          .describe('Docket humans with no matched Notion account, including account-less people.'),
      }),
      description: `How many Docket people have no counterpart in the Notion workspace. They are not a problem to fix: they still get a row in the projected People database and can be assigned work there. Notion simply cannot @-mention them, because its native people property can only reference members of the Notion workspace.

Surfacing the count is what makes that limitation legible instead of looking like the sync dropped somebody.`,
    }),
    zParam(mirrorParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await assertNotionIntegration(orgId, id);
      const humans = await db
        .select({ id: actor.id })
        .from(actor)
        .where(
          and(eq(actor.organizationId, orgId), eq(actor.kind, 'human'), isNull(actor.archivedAt)),
        );
      const matched = await db
        .select({ actorId: externalActor.actorId })
        .from(externalActor)
        .where(and(eq(externalActor.integrationId, id), eq(externalActor.organizationId, orgId)));
      const matchedIds = new Set(matched.map((m) => m.actorId).filter((v): v is string => !!v));
      return ok(c, z.object({ docketOnly: z.number().int() }), {
        docketOnly: humans.filter((h) => !matchedIds.has(h.id)).length,
      });
    },
  );
