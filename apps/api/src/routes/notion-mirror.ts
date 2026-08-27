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
import { ConnectorConfig, SyncRunOut, CursorQuery, pageOf } from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { buildNotionMirror } from '../container';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

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
const PARENT_PAGE_LIMIT = 25;

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
        limit: limit ?? PARENT_PAGE_LIMIT,
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
      description: `Run one full mirror pass against the container page already chosen: create any designed-but-missing database, read back Notion's edits, then project Docket's rows. The same pass the background sweep runs, on demand.

Distinct from \`POST /provision\`, which *chooses* the container page and rewrites the connection's config. This one only runs, so it is the safe repeat action — and the only way to re-run the mirror after setup, which is what makes a stalled sync recoverable without reconnecting.

Runs on the shared leased sync spine, so it returns a real {@link SyncRunOut} with the same durable history as every other sync. **A failed run is a 200** carrying \`status: 'failed'\` — the outcome is reported, never optimistically swallowed — so a client must read \`status\` rather than treat the response code as success.

Requires \`manage\`. Returns 409 when another run already holds the integration's lease, and 409 when no container page has been chosen yet: that is a setup step, not a sync failure, and running anyway would record a failure against a healthy connection and notify its owner about it.`,
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
      description: `Every Notion workspace member the sync engine has seen, with the Docket actor each is matched to. Reads the stored \`external_actor\` rows rather than calling Notion, so the people surface renders instantly and works while the connection is down; the rows are refreshed by the sync pass.

\`actorId: null\` is an explicit, queryable unmatched state — never hidden and never quietly defaulted to somebody. An unmatched person's assignments cannot reach Docket, which is what the surface has to make obvious.

\`ignoredAt\` separates the two populations that share \`actorId: null\`: a person nobody has decided about yet (\`ignoredAt: null\`) still needs an answer, while one somebody deliberately excluded does not and should stop being asked about. Read them apart rather than lumping them together, or the "needs a decision" count never reaches zero.

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
          ignoredAt: row.ignoredAt?.toISOString() ?? null,
        })),
      });
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
      description: `Resolve one Notion workspace member, returning the updated {@link NotionWorkspacePerson}.

\`create_actor\` adds them to Docket as a person with **no account** — the same \`actor{kind:'human', user_id:null}\` row \`POST /orgs/:orgId/members\` creates — and links the mapping to it. That is the common case: most people in a Notion workspace are not Docket users, and refusing to represent them would make their assignments unroutable.

\`match_existing\` links them to an actor you name and marks the mapping \`manual\`, which makes it immune to the email re-matching every sync performs. A human's explicit decision always outranks an automatic one.

\`skip\` stamps \`ignoredAt\`. That timestamp is the whole point: leaving the row as plain \`actorId: null\` would record the decision as indistinguishable from never having made one, so the person would resurface on the next read and — because the email pass re-evaluates undecided rows — could be auto-matched anyway. An ignored row is immune to re-matching in exactly the way a \`manual\` one is. It stays visible rather than disappearing, because a deliberate exclusion is a queryable state, not an absence.

\`unignore\` clears all three fields, returning the person to undecided. It undoes a match as readily as an exclusion, which keeps one reversal path instead of one per prior decision.

Every non-\`skip\` action clears \`ignoredAt\`: deciding anything about somebody supersedes an earlier "don't sync them", and a stale exclusion left behind would keep the row immune to re-matching forever.

Requires \`manage\`. A missing mapping 404s (\`Person not found\`); \`match_existing\` without a valid same-org \`actorId\` 404s (\`Actor not found\`).`,
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

      let actorId: string | null = null;
      if (body.action === 'match_existing') {
        if (body.actorId === undefined) throw new ConflictError('Choose someone to match them to.');
        const found = await db
          .select({ id: actor.id })
          .from(actor)
          .where(and(eq(actor.id, body.actorId), eq(actor.organizationId, orgId)))
          .limit(1);
        if (!found[0]) throw new NotFoundError('Actor not found');
        actorId = body.actorId;
      } else if (body.action === 'create_actor') {
        const inserted = await db
          .insert(actor)
          .values({
            organizationId: orgId,
            kind: 'human',
            // Docket's account-less person: assignable everywhere, owns no login. Exactly what a
            // Notion member who has never used Docket should be.
            userId: null,
            displayName: mapping.displayName,
            avatar: mapping.avatarUrl,
          })
          .returning();
        const created = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert always returns a row */
        if (!created) throw new NotFoundError('Actor not found');
        actorId = created.id;
      }

      const updated = await db
        .update(externalActor)
        // `manual` on any explicit match, so the next sync's email pass never overrides it; and
        // `ignoredAt` set only by `skip`, cleared by everything else — a decision about somebody
        // supersedes an earlier decision to exclude them.
        .set({
          actorId,
          matchedBy: actorId === null ? null : 'manual',
          ignoredAt: body.action === 'skip' ? new Date() : null,
        })
        .where(eq(externalActor.id, mapping.id))
        .returning();
      const next = updated[0];
      /* v8 ignore next -- @preserve defensive: the row was loaded in this same request. */
      if (!next) throw new NotFoundError('Person not found');

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
