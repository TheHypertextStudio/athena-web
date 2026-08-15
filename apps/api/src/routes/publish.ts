/**
 * `@docket/api` — publications router (mounted at `/v1/orgs/:orgId/publications`).
 *
 * @remarks
 * Publishing writes one row saying *that* a record is public and *where*. It never copies what
 * the record says — see `./publish-brief`, which projects every published byte from the live
 * work tables on each request (CORE-27).
 *
 * **Capability.** Publishing requires `contribute`, the same level that authors the record
 * itself, not `manage`. A brief is a view of work its author already owns, the action is
 * reversible in one click, and every publication in the workspace is listed on the publishing
 * settings surface where an admin can withdraw it. Requiring `manage` would put an
 * administrator in the loop for every status page a team wants to share, which is how a feature
 * ends up unused. Domains are the opposite case and *are* `manage`-only (CORE-29) — a domain
 * decides which host the whole workspace answers on.
 *
 * **Withdrawal keeps the row.** `DELETE` clears `publishedAt` and leaves the path reserved, so
 * re-publishing later restores the identical URL. A link someone put in a board deck should not
 * rot because a brief was toggled off for a week. The public serving guard is
 * `published_at IS NOT NULL`, never row existence, so a withdrawn brief 404s immediately.
 */
import { db, organization, publication } from '@docket/db';
import {
  PublicationCreate,
  PublicationOut,
  PublicationStateOut,
  PublicationSubjectKind,
  PublicationUpdate,
  pageOf,
  suggestPublicSlug,
} from '@docket/types';
import { and, desc, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { briefPath, briefUrls, requireSubjectTitle } from './publish-brief';

/** Path parameter for a single publication row. */
const publicationIdParam = z.object({ id: z.string() });

/** Path parameters addressing a publication by the record it publishes. */
const subjectParam = z.object({ subjectKind: PublicationSubjectKind, subjectId: z.string() });

/** A publication row as stored. */
type PublicationRow = typeof publication.$inferSelect;

/**
 * Serialize a publication row, resolving the live set of URLs it is reachable at.
 *
 * @param row - The stored row.
 * @param workspaceSlug - The publishing workspace's own identity slug (never null — every
 *   workspace has one).
 * @returns The wire representation.
 */
async function toOut(
  row: PublicationRow,
  workspaceSlug: string,
): Promise<z.input<typeof PublicationOut>> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    subjectKind: row.subjectKind,
    subjectId: row.subjectId,
    slug: row.slug,
    published: row.publishedAt !== null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    unpublishedAt: row.unpublishedAt?.toISOString() ?? null,
    path: briefPath(workspaceSlug, row.slug),
    urls: row.publishedAt === null ? [] : await briefUrls(row.organizationId, row.slug),
  };
}

/**
 * Read the publishing workspace's own identity slug — its default brief address — once per
 * request, for path construction.
 *
 * @remarks
 * `NotFoundError` on a missing row would be a defensive-only branch: every publication's
 * `organizationId` is a real FK to a real org, so this can only fail if that invariant is broken
 * elsewhere, in which case surfacing a clean error here is strictly better than a silent `''`.
 */
async function workspaceSlug(organizationId: string): Promise<string> {
  const rows = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  const row = rows[0];
  /* v8 ignore next -- @preserve defensive: organizationId is always a real org's id */
  if (!row) throw new NotFoundError('Workspace not found');
  return row.slug;
}

/** Load one publication scoped to the org, or 404. */
async function loadPublication(organizationId: string, id: string): Promise<PublicationRow> {
  const rows = await db
    .select()
    .from(publication)
    .where(and(eq(publication.id, id), eq(publication.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Publication not found');
  return row;
}

/**
 * Assert no other record in this workspace already answers on `slug`.
 *
 * @remarks
 * The unique index is the real guarantee; this check exists to turn the database's constraint
 * violation into the `public_name_taken` Problem the UI can act on, and to say which field is
 * at fault before the write is attempted.
 *
 * @throws {ConflictError} When the slug belongs to a different publication.
 */
async function assertSlugFree(
  organizationId: string,
  slug: string,
  exceptId?: string,
): Promise<void> {
  const clash = await db
    .select({ id: publication.id })
    .from(publication)
    .where(
      and(
        eq(publication.organizationId, organizationId),
        eq(publication.slug, slug),
        exceptId === undefined ? undefined : ne(publication.id, exceptId),
      ),
    )
    .limit(1);
  if (clash[0]) {
    throw new ConflictError('That address is already used by another brief.', 'public_name_taken');
  }
}

/** Publications router: publish, re-slug, and withdraw a record's public brief. */
const publications = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Publishing',
      summary: 'List published briefs',
      response: pageOf(PublicationOut),
      description: `List every publication in the workspace — each row is one initiative, program, or project that has been published as a public brief, newest first, including those currently withdrawn (\`published: false\`). Withdrawn rows are retained so re-publishing restores the same URL, which is why they appear here rather than vanishing. Each row's \`urls\` array is resolved live: it lists the shared brief host (when one is configured for this deployment) plus every verified custom domain, and is empty for a withdrawn brief. Reads require only org membership.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const [rows, slug] = await Promise.all([
        db
          .select()
          .from(publication)
          .where(eq(publication.organizationId, orgId))
          .orderBy(desc(publication.createdAt)),
        workspaceSlug(orgId),
      ]);
      const items = await Promise.all(rows.map((row) => toOut(row, slug)));
      return ok(c, pageOf(PublicationOut), { items });
    },
  )
  .get(
    '/:subjectKind/:subjectId',
    apiDoc({
      tag: 'Publishing',
      summary: "Read one record's publication state",
      response: PublicationStateOut,
      description: `Return the publication state for one initiative, program, or project so a detail page can render its publish affordance correctly — published, withdrawn, or never published. A record that has never been published returns **200** with \`publication: null\` rather than a 404: "not published" is an answer, not a failure, and making the normal case an error status would force every caller to distinguish it from a genuine outage by status code alone. Scoped strictly to the caller's organization.`,
    }),
    zParam(subjectParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { subjectKind, subjectId } = c.req.valid('param');
      const rows = await db
        .select()
        .from(publication)
        .where(
          and(
            eq(publication.organizationId, orgId),
            eq(publication.subjectKind, subjectKind),
            eq(publication.subjectId, subjectId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return ok(c, PublicationStateOut, { publication: null });
      return ok(c, PublicationStateOut, {
        publication: await toOut(row, await workspaceSlug(orgId)),
      });
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Publishing',
      summary: 'Publish a record as a brief',
      capability: 'contribute',
      response: PublicationOut,
      status: 201,
      description: `Publish an initiative, program, or project to the web as a brief. The record must live in the path organization — a cross-tenant \`subjectId\` returns 404 (existence-hiding).

\`slug\` is the last segment of the public URL. Omit it and one is derived from the record's own title; supply it to choose. It must be 1–64 lowercase alphanumeric characters separated by single hyphens, must not be a reserved system name, and must be unused by another brief in this workspace — a clash returns **409 \`public_name_taken\`** and writes nothing.

Publishing a record that was previously withdrawn restores it at its **original** URL rather than minting a new one, so shared links survive a withdrawal. Requires \`contribute\`: a brief is a view of work the caller can already author, and withdrawal is one click. \`urls\` reflects live reachability: the shared brief host (once one is configured for this deployment) plus every verified custom domain — empty only in a deployment with neither.`,
    }),
    zJson(PublicationCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const title = await requireSubjectTitle(orgId, body.subjectKind, body.subjectId);

      const slug = body.slug ?? suggestPublicSlug(title);
      if (slug.length === 0) {
        // The record's title yielded nothing slug-able (a title that is entirely punctuation or
        // emoji). Asking the person to choose is the only honest outcome — inventing an address
        // would give them a link that has nothing to do with what they published.
        throw new ValidationError([
          { message: 'Choose an address for this brief.', path: ['slug'] },
        ]);
      }

      const existing = await db
        .select()
        .from(publication)
        .where(
          and(
            eq(publication.organizationId, orgId),
            eq(publication.subjectKind, body.subjectKind),
            eq(publication.subjectId, body.subjectId),
          ),
        )
        .limit(1);
      const prior = existing[0];

      // Re-publishing keeps the original address unless the caller explicitly asked for a new
      // one; that is what makes an already-shared link survive a withdrawal.
      const targetSlug = prior && body.slug === undefined ? prior.slug : slug;
      await assertSlugFree(orgId, targetSlug, prior?.id);

      const now = new Date();
      const row = prior
        ? (
            await db
              .update(publication)
              .set({ slug: targetSlug, publishedAt: now })
              .where(eq(publication.id, prior.id))
              .returning()
          )[0]
        : (
            await db
              .insert(publication)
              .values({
                organizationId: orgId,
                subjectKind: body.subjectKind,
                subjectId: body.subjectId,
                slug: targetSlug,
                publishedAt: now,
                createdBy: actorId,
              })
              .returning()
          )[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns one row */
      if (!row) throw new Error('publication write returned no row');

      return created(c, PublicationOut, await toOut(row, await workspaceSlug(orgId)));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Publishing',
      summary: 'Move or withdraw a brief',
      capability: 'contribute',
      response: PublicationOut,
      description: `Change a brief's public address (\`slug\`) or its published state (\`published\`) without losing the row. Moving a brief takes effect immediately: the old address stops resolving and the new one starts, and a clash with another brief in the same workspace returns **409 \`public_name_taken\`** with nothing written. Setting \`published: false\` withdraws the brief — the same as \`DELETE\` — and \`published: true\` restores it at the same address. Requires \`contribute\`.`,
    }),
    zParam(publicationIdParam),
    zJson(PublicationUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const prior = await loadPublication(orgId, id);

      if (body.slug !== undefined && body.slug !== prior.slug) {
        await assertSlugFree(orgId, body.slug, prior.id);
      }

      const now = new Date();
      const publishedPatch =
        body.published === undefined
          ? {}
          : body.published
            ? { publishedAt: prior.publishedAt ?? now }
            : { publishedAt: null, unpublishedAt: now };

      const rows = await db
        .update(publication)
        .set({ ...(body.slug === undefined ? {} : { slug: body.slug }), ...publishedPatch })
        .where(eq(publication.id, prior.id))
        .returning();
      const row = rows[0];
      /* v8 ignore next -- @preserve defensive: update always returns one row */
      if (!row) throw new Error('publication update returned no row');
      return ok(c, PublicationOut, await toOut(row, await workspaceSlug(orgId)));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Publishing',
      summary: 'Withdraw a brief',
      capability: 'contribute',
      response: PublicationOut,
      description: `Withdraw a published brief. The public URL begins returning **404** to logged-out visitors immediately — the serving guard is \`published_at IS NOT NULL\`, so there is no cache window on the authorization decision.

The row is deliberately **retained** with its address reserved, rather than deleted: re-publishing the same record later restores the identical URL, so a link already circulating in a deck or an email does not permanently rot because a brief was withdrawn for a week. Requires \`contribute\`.`,
    }),
    zParam(publicationIdParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const prior = await loadPublication(orgId, id);
      const rows = await db
        .update(publication)
        .set({ publishedAt: null, unpublishedAt: new Date() })
        .where(eq(publication.id, prior.id))
        .returning();
      const row = rows[0];
      /* v8 ignore next -- @preserve defensive: update always returns one row */
      if (!row) throw new Error('publication withdraw returned no row');
      return ok(c, PublicationOut, await toOut(row, await workspaceSlug(orgId)));
    },
  );

export default publications;
