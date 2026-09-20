/**
 * `@docket/api` — publications router (mounted at `/v1/orgs/:orgId/publications`).
 *
 * @remarks
 * Publishing writes one row saying *that* a record is public and *where*. It never copies what
 * the record says — see `./publish-brief`, which projects every published byte from the live
 * work tables on each request.
 *
 * **Capability.** Publishing requires `contribute`, the same level that authors the record
 * itself, not `manage`. A brief is a view of work its author already owns, the action is
 * reversible in one click, and every publication in the workspace is listed on the publishing
 * settings surface where an admin can withdraw it. Requiring `manage` would put an
 * administrator in the loop for every status page a team wants to share, which is how a feature
 * ends up unused. Domains are the opposite case and *are* `manage`-only — a domain
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
  suggestPublicSlug,
} from '@docket/work/publish-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, desc, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import { created, memberUrl, ok } from '../lib/ok';
import { pageResult, seekAfter } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
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
      description: `List every brief in the workspace in \`createdAt DESC, id DESC\` order, including withdrawn briefs. Pages default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Each item's \`urls\` array contains its current public addresses. Reads require workspace membership.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      const [rows, slug] = await Promise.all([
        db
          .select()
          .from(publication)
          .where(
            and(
              eq(publication.organizationId, orgId),
              seekAfter(publication.createdAt, publication.id, cursor),
            ),
          )
          .orderBy(desc(publication.createdAt), desc(publication.id))
          .limit(limit + 1),
        workspaceSlug(orgId),
      ]);
      const page = pageResult(rows, limit, (row) => row.createdAt);
      const items = await Promise.all(page.items.map((row) => toOut(row, slug)));
      return ok(c, pageOf(PublicationOut), {
        items,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      });
    },
  )
  .get(
    '/:subjectKind/:subjectId',
    apiDoc({
      tag: 'Publishing',
      summary: "Read one record's publication state",
      response: PublicationStateOut,
      description: `Return whether one initiative, program, or project is published, withdrawn, or has never been published. A resource that has never been published returns 200 with \`publication: null\`. Docket returns 404 only when the subject is unavailable or inaccessible.`,
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
      description: `Publish an initiative, program, or project as a public brief. The subject must belong to this organization; otherwise Docket returns 404.

\`slug\` becomes the last segment of the public URL. When omitted, Docket derives it from the subject title. A slug must contain 1 to 64 lowercase letters, numbers, or single hyphens, cannot use a reserved name, and must be unique in the workspace. A conflict returns 409 \`public_name_taken\` without changing publication state.

Publishing a previously withdrawn subject restores its original URL. \`urls\` contains the currently reachable shared-host URL and URLs for verified custom domains. It is empty only when the deployment has no shared brief host and the workspace has no verified custom domain.`,
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

      return created(
        c,
        PublicationOut,
        await toOut(row, await workspaceSlug(orgId)),
        memberUrl(c, `${row.subjectKind}/${row.subjectId}`),
      );
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
      description: `Change a brief's public address (\`slug\`) or published state (\`published\`) without deleting the brief. Moving it takes effect immediately: the old address stops resolving and the new one starts. An address conflict returns **409 \`public_name_taken\`** without changing the brief. Setting \`published: false\` withdraws it, and \`published: true\` restores it at the same address. Requires \`contribute\`.`,
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
      description: `Withdraw a published brief. The public URL begins returning **404** to logged-out visitors immediately.

Docket reserves the address. Publishing the brief again restores the same URL, so existing links remain valid after republication. Requires \`contribute\`.`,
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
