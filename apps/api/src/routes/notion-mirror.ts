import { resolveSourcePerson } from '../lib/identity/source-people';
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
  NotionMirrorDesignOut,
  NotionMirrorDesignPatch,
  NotionMirrorEntity,
  NotionParentPageOut,
  NotionPersonResolve,
  NotionWorkspacePerson,
} from '@docket/connections/notion/mirror-contract';
import type { MirrorParentPage } from '@docket/connections/notion/mirror-port';
import { ConnectorConfig, SyncRunOut } from '@docket/connections/integration-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { buildNotionMirror } from '../container';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { pageResultByKey, seekAfterId } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { productCapabilityGuard } from '../product-capability';

import { resolveConnectorToken } from './integration-provider';
import { toSyncRunOut } from './integration-sync';
import { runNotionMirrorSync } from './notion-mirror-reconcile';
import {
  applyDesignPatch,
  buildDesignOut,
  contentStatesForDesigns,
  ensureDesigns,
  loadDesign,
  toMirrorDatabaseOut,
} from './notion-mirror-design';

/** Path params for the mirror routes, which are nested under an integration. */
const mirrorParam = z.object({ id: z.string() });
/** Path params for one entity's design. */
const entityParam = z.object({ id: z.string(), entity: NotionMirrorEntity });

/**
 * How many pages one `/parent-pages` call returns when the caller does not say.
 *
 * @remarks
 * A picker's worth, not a workspace's worth. The list is searched at the provider and scrolls to
 * a cursor, so the ceiling is about how much a person reads before typing — not about coverage.
 */

/**
 * Query params for the parent-page search.
 *
 * @remarks
 * Extends the shared {@link CursorQuery} rather than restating `cursor`/`limit`, the same way
 * `cycles.ts` and `projects.ts` do — so this route tracks the repo's cursor contract instead of
 * carrying its own copy of it in the OpenAPI document.
 */
const parentPageQuery = CursorQuery.extend({
  q: z
    .string()
    .optional()
    .describe('Title substring passed straight to Notion. Omit for the most recent pages.'),
});

/**
 * Map a provider page onto the wire shape.
 *
 * @remarks
 * The port's optional fields become explicit `null`s: an absent key and a null mean the same
 * thing to a reader but not to a client that has to branch, and the response schema is the
 * contract that says which fields may be missing.
 */
function toParentPageOut(page: MirrorParentPage): NotionParentPageOut {
  return {
    id: page.id,
    title: page.title,
    url: page.url ?? null,
    icon: page.icon ?? null,
    lastEditedTime: page.lastEditedTime ?? null,
    parentKind: page.parentKind ?? null,
  };
}

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
 * Takes the row every caller has already loaded through {@link assertNotionIntegration} rather
 * than re-selecting it. That was a wash when this only ran once per settings load; `/parent-pages`
 * is now a search that runs on every debounced keystroke, so the redundant select is per-keystroke
 * too.
 *
 * Returns undefined in local/test mode, where the container hands back the in-memory mirror and
 * no token is meaningful.
 */
async function mirrorToken(
  row: Pick<typeof integration.$inferSelect, 'createdBy' | 'externalAccountId'>,
): Promise<string | undefined> {
  const result = await resolveConnectorToken(row.createdBy, 'notion', row.externalAccountId);
  if (!result.ok || result.token === 'mock') return undefined;
  return result.token;
}

/** The Notion mirror router. */
export const notionMirrorApp = new Hono<AppEnv>()
  .use('*', productCapabilityGuard('integrations'))
  .get(
    '/databases',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'List the Docket-designed Notion databases',
      capability: 'manage',
      response: pageOf(NotionMirrorDatabaseOut),
      description: `Every Docket-designed Notion database for this integration, in designer order, as a page of {@link NotionMirrorDatabaseOut}. Seeds the nine entity designs from the catalog defaults on first call, titled with the org's own vocabulary — so a nonprofit workspace sees "Campaigns" rather than "Initiatives" without configuring anything.

An item with null \`externalDatabaseId\` and \`provisionedAt\` describes a design that has not been created in Notion. Those fields receive values only after Notion confirms creation.

Requires \`manage\`: shaping what a workspace publishes into a third-party tool is an administrative act, the same bar as the other integration-configuration routes.`,
    }),
    zParam(mirrorParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await assertNotionIntegration(orgId, id);
      const rows = await ensureDesigns(orgId, id, c.get('actorCtx').actorId);
      const contentStates = await contentStatesForDesigns(id);
      return ok(c, pageOf(NotionMirrorDatabaseOut), {
        items: rows.map((row) => toMirrorDatabaseOut(row, contentStates.get(row.entityType))),
      });
    },
  )
  .get(
    '/design/:entity',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: "Read one entity's table design and preview",
      capability: 'manage',
      response: NotionMirrorDesignOut,
      description: `The table designer's payload for one entity: the current column set, every Docket field the entity could expose, and a short preview of how the Notion database will actually look.

The preview uses the workspace's current records when any exist. When the workspace has none of that entity, \`sample\` is true and the returned items are illustrative.

\`excludedRows\` counts work omitted because it is already linked to another database on the same integration. \`totalRows\` includes only work eligible for this database.`,
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
      summary: "Rename or reshape one entity's Notion database",
      capability: 'manage',
      response: NotionMirrorDesignOut,
      description: `Update a designed Notion database's title, enabled state, or columns. Supplying \`columns\` replaces the complete ordered column list; omitted columns are removed from the design.

The required title column cannot be removed, and every column must reference a field exposed by this entity. Either violation returns 409. Renaming a provisioned column keeps its Notion \`propertyId\`, so it remains bound to the same property. Docket does not overwrite a label that was renamed in Notion.`,
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
      summary: 'Search Notion pages a database can be created under',
      capability: 'manage',
      response: pageOf(NotionParentPageOut),
      description: `The Notion pages this integration may parent its designed databases under — the pages the person shared with Docket during consent.

Searched and paged **at the provider**: \`q\` is passed to Notion as a title query and results come back most-recently-edited first. Omit \`q\` for the most recent pages. This is a search endpoint rather than a dump because a real workspace has more pages than a person will ever scroll, and downloading all of them to filter in the browser is neither fast nor a usable list.

An empty list is a legitimate and common state, not an error: a public Notion integration only sees what it was explicitly granted. With no \`q\`, an empty result means nothing was shared and the setup flow must offer a re-consent path; with a \`q\`, it just means nothing matched.`,
    }),
    zParam(mirrorParam),
    zQuery(parentPageQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { q, cursor, limit } = c.req.valid('query');
      const row = await assertNotionIntegration(orgId, id);
      const token = await mirrorToken(row);
      const page = await buildNotionMirror(token, { integrationId: id }).listParentPages({
        ...(q !== undefined ? { query: q } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
        limit,
      });
      return ok(c, pageOf(NotionParentPageOut), {
        items: page.items.map(toParentPageOut),
        ...(page.nextCursor !== null ? { nextCursor: page.nextCursor } : {}),
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
      description: `Choose the parent page and run a complete mirror: create each missing designed database, import changes made in Notion, and publish Docket records back to Notion.

Returns {@link SyncRunOut}. A failed pass remains in sync history. If the pass reaches its Notion write limit, the result reports completed work and a later scheduled or manual sync resumes the remainder.

Requires \`manage\`. Returns 409 when another run already holds the integration's lease.`,
    }),
    zParam(mirrorParam),
    zJson(z.object({ containerPageId: z.string().min(1) })),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { containerPageId } = c.req.valid('json');
      const row = await assertNotionIntegration(orgId, id);

      // Ask Notion what this page is actually called, rather than trusting a title the browser
      // happened to be showing. Settings names the container page from this, so a stale or
      // spoofed client title would become the permanent label on a link people click.
      //
      // Concurrent with the design seed: one is a local write, the other a Notion round trip, and
      // only the config write below needs either.
      const [, described] = await Promise.all([
        ensureDesigns(orgId, id, actorId),
        mirrorToken(row).then((token) =>
          buildNotionMirror(token, { integrationId: id }).describePage(containerPageId),
        ),
      ]);

      // Spread the existing config: `config` is a wholesale replace, so writing only the mirror
      // key would drop `listIds` and silently unlink every database the other mode syncs.
      const config = row.config;
      const updated = await db
        .update(integration)
        .set({
          config: {
            ...config,
            notionMirror: {
              containerPageId,
              containerPageTitle: described.title,
              ...(described.url !== undefined ? { containerPageUrl: described.url } : {}),
            },
          },
        })
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
  .post(
    '/sync',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Run the Notion mirror now',
      capability: 'manage',
      response: SyncRunOut,
      description: `Run the configured Notion mirror. Docket creates missing designed databases, imports changes from Notion, and publishes Docket records to Notion. This operation uses the existing parent page; \`POST /provision\` selects or changes that page.

The response is a {@link SyncRunOut} saved in sync history. Inspect its \`status\`: a completed HTTP request may still report \`status: "failed"\`. Docket returns 409 when another mirror run is active or no parent page has been selected.`,
    }),
    zParam(mirrorParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await assertNotionIntegration(orgId, id);

      // Checked HERE rather than left to the pass. `runNotionMirrorSync` throws without a
      // container page, and the spine turns any throw into a recorded failure: the connection
      // is demoted to `error` and its owner gets an inbox notification. Doing that to a healthy
      // connection because somebody pressed Sync before finishing setup would be a lie about
      // the connection's health, on top of an unwarranted notification.
      const config = ConnectorConfig.safeParse(row.config).data ?? {};
      if (config.notionMirror?.containerPageId === undefined) {
        throw new ConflictError('Choose a Notion page for Docket to build its databases under.');
      }

      const run = await runNotionMirrorSync(row, { actorId, trigger: 'manual' });
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
      description: `List people discovered during previous Notion syncs and the Docket Actor matched to each person. This operation reads Docket's saved roster and does not call Notion. A later sync refreshes it. Integration bots are excluded.

\`actorId: null\` means the person is not matched, so their Notion assignments cannot map to Docket work. When \`ignoredAt\` is null, the person still needs a decision. A non-null \`ignoredAt\` means an administrator chose to exclude that person from matching.`,
    }),
    zParam(mirrorParam),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { cursor, limit } = c.req.valid('query');
      await assertNotionIntegration(orgId, id);
      const rows = await db
        .select()
        .from(externalActor)
        .where(
          and(
            eq(externalActor.integrationId, id),
            eq(externalActor.organizationId, orgId),
            seekAfterId(externalActor.externalId, cursor, 'asc'),
          ),
        )
        .orderBy(asc(externalActor.externalId))
        .limit(limit + 1);
      const items = rows.map((row) => ({
        externalId: row.externalId,
        name: row.displayName,
        email: row.email,
        avatarUrl: row.avatarUrl,
        actorId: row.actorId,
        matchedBy: row.matchedBy,
        ignoredAt: row.ignoredAt?.toISOString() ?? null,
      }));
      return ok(
        c,
        pageOf(NotionWorkspacePerson),
        pageResultByKey(items, limit, (item) => item.externalId),
      );
    },
  )
  .post(
    '/people/:externalId/resolve',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Integrations',
      summary: 'Decide what one unmatched Notion person maps to',
      capability: 'manage',
      response: NotionWorkspacePerson,
      description: `Choose how one Notion workspace member maps to Docket and return the updated {@link NotionWorkspacePerson}.

- \`create_actor\` creates a person without a Docket account and uses that person for future Notion assignments.
- \`match_existing\` links the Notion member to the supplied \`actorId\`. Future syncs preserve this manual match.
- \`skip\` records that the member should not be matched automatically. The member remains visible with \`ignoredAt\` set.
- \`unignore\` removes the current match or exclusion and returns the member to the undecided state.

Every action except \`skip\` clears \`ignoredAt\`. Docket returns 404 when the Notion member does not exist or when \`match_existing\` names an Actor outside this organization.`,
    }),
    zParam(z.object({ id: z.string(), externalId: z.string() })),
    zJson(NotionPersonResolve),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, externalId } = c.req.valid('param');
      const body = c.req.valid('json');
      await assertNotionIntegration(orgId, id);

      const rows = await db
        .select()
        .from(externalActor)
        .where(
          and(
            eq(externalActor.integrationId, id),
            eq(externalActor.organizationId, orgId),
            eq(externalActor.externalId, externalId),
          ),
        )
        .limit(1);
      const mapping = rows[0];
      if (!mapping) throw new NotFoundError('Person not found');

      if (body.action === 'match_existing' && !body.actorId)
        throw new ConflictError('Choose a workspace person to link.');

      const decision =
        body.action === 'match_existing'
          ? { action: 'match_existing' as const, actorId: body.actorId ?? '' }
          : { action: body.action };
      const next = await resolveSourcePerson(orgId, id, mapping.id, decision);

      return ok(c, NotionWorkspacePerson, {
        externalId: next.externalId,
        name: next.displayName,
        email: next.email,
        avatarUrl: next.avatarUrl,
        actorId: next.actorId,
        matchedBy: next.matchedBy,
        ignoredAt: next.ignoredAt?.toISOString() ?? null,
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
      description: `Count Docket people who have no matching member in the Notion workspace. They still appear in the mirrored People database and can own work there, but Notion cannot mention them through its native people property.

Use this count to distinguish that provider limitation from a missing sync record.`,
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
