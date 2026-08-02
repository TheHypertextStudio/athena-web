/**
 * `@docket/api` — publishing addresses router (mounted at `/v1/orgs/:orgId/publishing`).
 *
 * @remarks
 * Where a workspace's briefs answer, as opposed to which briefs exist (`./publish.ts`). Two
 * addressing mechanisms, both administered here:
 *
 * 1. **Custom domains** (CORE-29 … CORE-31, MISS-04). A workspace claims a host, Docket mints a
 *    per-row token, and the host serves nothing until a DNS `TXT` record proves ownership.
 *    Uniqueness is global and enforced by a unique index, so one host belongs to exactly one
 *    workspace forever (CORE-30).
 * 2. **A public name** (CORE-32). The fallback for a workspace that owns no domain: claim a
 *    name and briefs answer at `<brief host>/briefs/<name>/<slug>`.
 *
 * **Everything here is `manage`-only.** CORE-29 asks for admin-gated domain configuration, and
 * the public name gets the same gate for the same reason: both decide the identity the whole
 * workspace presents to the internet, which is not a per-member decision. A non-admin member
 * receives 403 from every route in this file, and a non-member receives 404 from
 * `orgContextMiddleware` before reaching it.
 *
 * **No resolver text ever reaches a response.** DNS answers come from a domain Docket does not
 * own, so failures are reported as the stable codes `@docket/env/custom-domain` defines and the
 * *count* of Docket-prefixed records observed — never the observed values.
 */
import { resolveTxt } from 'node:dns/promises';

import { db, organization, workspaceDomain, workspacePublicSlug } from '@docket/db';
import { apiHostConfig } from '@docket/env/api';
import {
  acceptCustomDomain,
  domainRoutingRecord,
  domainVerificationRecord,
  generateCustomDomainToken,
  type DomainVerificationFailure,
  type TxtLookup,
  verifyCustomDomain,
} from '@docket/env/custom-domain';
import { resolveHost } from '@docket/env/hosts';
import {
  DomainVerificationFailureCode,
  WorkspaceDomainCreate,
  WorkspaceDomainOut,
  WorkspaceDomainVerifyOut,
  WorkspacePublicSlugClaim,
  WorkspacePublicSlugOut,
  pageOf,
  suggestPublicSlug,
} from '@docket/types';
import { and, asc, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

/** Path parameter for a single domain row. */
const domainIdParam = z.object({ id: z.string() });

/** A stored domain row. */
type DomainRow = typeof workspaceDomain.$inferSelect;

/**
 * Read a persisted failure code back as the closed wire enum.
 *
 * @remarks
 * The column is plain `text` so a future failure code needs no migration, which means a value
 * read back could in principle be one this build does not know. Parsing rather than casting is
 * what keeps an unknown value out of a typed response — it degrades to `null` ("no recorded
 * reason") instead of widening the client's union behind its back.
 */
function failureCode(value: string | null): DomainVerificationFailureCode | null {
  if (value === null) return null;
  const parsed = DomainVerificationFailureCode.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Serialize a domain row, including the DNS records its operator must publish.
 *
 * @remarks
 * The routing `CNAME` is `null` when the deployment has configured no custom-domain target.
 * That is a real state — a local stack, or a production deploy mid-cutover — and showing an
 * invented target would send an admin to change DNS to a host that does not serve.
 */
function toDomainOut(row: DomainRow): z.input<typeof WorkspaceDomainOut> {
  const routingRecord = routingRecordFor(row.host);
  return {
    id: row.id,
    organizationId: row.organizationId,
    host: row.host,
    verified: row.verifiedAt !== null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastFailure: failureCode(row.lastFailure),
    verificationRecord: domainVerificationRecord(row.host, row.verificationToken),
    routingRecord,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The routing `CNAME` for a host, or `null` when the deployment has no target configured.
 *
 * @remarks
 * `domainRoutingRecord` throws rather than returning a placeholder, which is right for a caller
 * that must have a target; here the absence is a legitimate state to report, so it is converted
 * to `null` at exactly this boundary and nowhere else.
 */
function routingRecordFor(host: string): z.input<typeof WorkspaceDomainOut>['routingRecord'] {
  try {
    return domainRoutingRecord(host, apiHostConfig);
  } catch {
    return null;
  }
}

/** The absolute URL prefix a workspace's briefs answer on, or `null` with no brief host. */
function workspaceBaseUrl(slug: string): string | null {
  const brief = resolveHost(apiHostConfig, 'brief');
  return brief ? `${brief.origin}/briefs/${slug}` : null;
}

/** Load one domain scoped to the org, or 404. */
async function loadDomain(organizationId: string, id: string): Promise<DomainRow> {
  const rows = await db
    .select()
    .from(workspaceDomain)
    .where(and(eq(workspaceDomain.id, id), eq(workspaceDomain.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Domain not found');
  return row;
}

/**
 * Build the publishing-addresses router.
 *
 * @remarks
 * A factory rather than a module-level instance so the DNS resolver is injectable. Verification
 * is the one part of this feature that reaches the network, and a test that had to publish a
 * real `TXT` record could not run at all — so the seam is the argument, and production simply
 * passes `node:dns/promises`'s `resolveTxt`.
 *
 * @param lookupTxt - The `TXT` resolver; defaults to the platform resolver.
 * @returns The Hono router to mount under `/v1/orgs/:orgId/publishing`.
 */
export function createPublishingAddressRoutes(lookupTxt: TxtLookup = resolveTxt) {
  return new Hono<AppEnv>()
    .get(
      '/domains',
      capabilityGuard('manage'),
      apiDoc({
        tag: 'Publishing',
        summary: 'List custom domains',
        capability: 'manage',
        response: pageOf(WorkspaceDomainOut),
        description: `List every custom domain claimed by this workspace, oldest first, each with its current verification state and the exact DNS records to publish. Requires \`manage\`: domain configuration decides which host the entire workspace answers on, so it is an administrator's decision, not a member's. A non-admin member receives **403**; a member of another workspace receives **404** from the org-context gate before this handler runs.

\`lastFailure\` is a stable code (\`lookup-failed\` / \`no-record\` / \`token-mismatch\`), never resolver output — DNS answers come from a domain Docket does not own, so their text is never rendered.`,
      }),
      async (c) => {
        const { orgId } = c.get('actorCtx');
        const rows = await db
          .select()
          .from(workspaceDomain)
          .where(eq(workspaceDomain.organizationId, orgId))
          .orderBy(asc(workspaceDomain.createdAt));
        return ok(c, pageOf(WorkspaceDomainOut), { items: rows.map(toDomainOut) });
      },
    )
    .post(
      '/domains',
      capabilityGuard('manage'),
      apiDoc({
        tag: 'Publishing',
        summary: 'Claim a custom domain',
        capability: 'manage',
        response: WorkspaceDomainOut,
        status: 201,
        description: `Claim a domain for this workspace's published briefs. The submitted value is normalized first — a full URL, mixed case, a trailing dot, and a \`www.\` prefix all collapse to one canonical host — and **that normalized host is the uniqueness key**, so \`Example.COM\`, \`https://www.example.com/x\`, and \`example.com.\` are one claim, not three.

The row is created **unverified** and serves nothing. The response carries the \`TXT\` record to publish (type, name, value, TTL) and, once a custom-domain target is configured, the \`CNAME\` that routes traffic. Call \`POST /domains/{id}/verify\` after publishing the \`TXT\`.

- A host already claimed by **any** workspace returns **409 \`domain_already_claimed\`** and writes nothing — a globally unique index backs this, so two simultaneous claims cannot both win (CORE-30).
- A malformed host, an IP literal, a wildcard, or one of Docket's own hosts returns **422** with a \`host\` field issue.

Requires \`manage\`.`,
      }),
      zJson(WorkspaceDomainCreate),
      async (c) => {
        const { orgId, actorId } = c.get('actorCtx');
        const { host } = c.req.valid('json');

        const accepted = acceptCustomDomain(host, apiHostConfig);
        if (!accepted.ok) {
          // Every rejection reason lands on the same field issue on purpose. The reasons are
          // stable machine codes for Docket's own use; the person typing needs one sentence
          // about the field, which the client owns.
          throw new ValidationError([
            { message: 'Enter a domain you own, like example.com.', path: ['host'] },
          ]);
        }

        const taken = await db
          .select({ id: workspaceDomain.id })
          .from(workspaceDomain)
          .where(eq(workspaceDomain.host, accepted.host))
          .limit(1);
        if (taken[0]) {
          throw new ConflictError(
            'That domain is already claimed by a workspace.',
            'domain_already_claimed',
          );
        }

        const rows = await db
          .insert(workspaceDomain)
          .values({
            organizationId: orgId,
            host: accepted.host,
            verificationToken: generateCustomDomainToken(),
            createdBy: actorId,
          })
          .returning();
        const row = rows[0];
        /* v8 ignore next -- @preserve defensive: insert always returns one row */
        if (!row) throw new Error('workspace domain insert returned no row');
        c.status(201);
        return ok(c, WorkspaceDomainOut, toDomainOut(row));
      },
    )
    .post(
      '/domains/:id/verify',
      capabilityGuard('manage'),
      apiDoc({
        tag: 'Publishing',
        summary: 'Check a custom domain’s DNS',
        capability: 'manage',
        response: WorkspaceDomainVerifyOut,
        description: `Re-run the DNS ownership check for a claimed domain and record the outcome. Verification is always re-run against live DNS and never served from cache: a domain that stops proving ownership must stop serving.

Success requires a \`TXT\` record at \`_docket-verify.<host>\` whose value is exactly \`docket-domain-verification=<this row's token>\`. A record containing the token as a substring does not pass, and another workspace's token does not pass.

The response reports \`failure\` as a stable code and \`observedCount\` as **how many** Docket-prefixed values were seen — a count, never the values, which are strings from a domain Docket does not own. \`0\` means "not published yet"; \`≥1\` with \`token-mismatch\` means "published, but the wrong token". Requires \`manage\`.`,
      }),
      zParam(domainIdParam),
      async (c) => {
        const { orgId } = c.get('actorCtx');
        const { id } = c.req.valid('param');
        const prior = await loadDomain(orgId, id);

        const result = await verifyCustomDomain({
          host: prior.host,
          token: prior.verificationToken,
          lookupTxt,
        });
        const failure: DomainVerificationFailure | undefined = result.failure;
        const rows = await db
          .update(workspaceDomain)
          .set({
            verifiedAt: result.verified ? (prior.verifiedAt ?? new Date()) : null,
            lastCheckedAt: new Date(),
            lastFailure: failure ?? null,
          })
          .where(eq(workspaceDomain.id, prior.id))
          .returning();
        const row = rows[0];
        /* v8 ignore next -- @preserve defensive: update always returns one row */
        if (!row) throw new Error('workspace domain verify update returned no row');

        return ok(c, WorkspaceDomainVerifyOut, {
          domain: toDomainOut(row),
          verified: result.verified,
          failure: failure ?? null,
          observedCount: result.observedCount,
        });
      },
    )
    .delete(
      '/domains/:id',
      capabilityGuard('manage'),
      apiDoc({
        tag: 'Publishing',
        summary: 'Remove a custom domain',
        capability: 'manage',
        response: WorkspaceDomainOut,
        description: `Release a domain. The row is deleted outright — unlike a withdrawn brief, there is nothing to preserve, and leaving the row would keep the host locked against every other workspace forever. The host stops serving Docket content on the next request (MISS-04), and becomes claimable again by any workspace that can prove ownership. Requires \`manage\`.`,
      }),
      zParam(domainIdParam),
      async (c) => {
        const { orgId } = c.get('actorCtx');
        const { id } = c.req.valid('param');
        const prior = await loadDomain(orgId, id);
        await db.delete(workspaceDomain).where(eq(workspaceDomain.id, prior.id));
        return ok(c, WorkspaceDomainOut, toDomainOut(prior));
      },
    )
    .get(
      '/public-name',
      apiDoc({
        tag: 'Publishing',
        summary: 'Read the workspace’s public name',
        response: WorkspacePublicSlugOut,
        description: `Return the name this workspace's briefs answer on at the shared brief host, or \`null\` when nothing has been claimed. Readable by any member — a member needs to know whether the brief they just published is reachable, and the answer is the same one an anonymous visitor could derive from any published URL. Claiming or changing the name requires \`manage\`.`,
      }),
      async (c) => {
        const { orgId } = c.get('actorCtx');
        const rows = await db
          .select({ slug: workspacePublicSlug.slug })
          .from(workspacePublicSlug)
          .where(eq(workspacePublicSlug.organizationId, orgId))
          .limit(1);
        const slug = rows[0]?.slug ?? null;
        return ok(c, WorkspacePublicSlugOut, {
          organizationId: orgId,
          slug,
          baseUrl: slug === null ? null : workspaceBaseUrl(slug),
        });
      },
    )
    .put(
      '/public-name',
      capabilityGuard('manage'),
      apiDoc({
        tag: 'Publishing',
        summary: 'Claim the workspace’s public name',
        capability: 'manage',
        response: WorkspacePublicSlugOut,
        description: `Claim (or change) the name this workspace's briefs answer on at the shared brief host — the addressing path for a workspace that owns no custom domain (CORE-32).

The name must be 1–64 lowercase alphanumeric characters separated by single hyphens. **Reserved system names are refused** (\`api\`, \`admin\`, \`settings\`, \`sign-in\`, \`privacy\`, and the rest of \`RESERVED_PUBLIC_SLUGS\`) with **422**, because a workspace answering on one would shadow a page the product owns. A name already claimed by another workspace returns **409 \`public_name_taken\`** and writes nothing; a globally unique index backs it.

Changing the name updates the existing claim rather than adding a second, so a workspace can never hoard names — and be aware that every already-shared brief URL moves with it. Requires \`manage\`. This is deliberately **not** \`organization.slug\`: that column is an auto-derived internal tenant key nobody chose, and publishing it would hand every workspace a public identity it never opted into.`,
      }),
      zJson(WorkspacePublicSlugClaim),
      async (c) => {
        const { orgId, actorId } = c.get('actorCtx');
        const { slug } = c.req.valid('json');

        const taken = await db
          .select({ id: workspacePublicSlug.id })
          .from(workspacePublicSlug)
          .where(
            and(eq(workspacePublicSlug.slug, slug), ne(workspacePublicSlug.organizationId, orgId)),
          )
          .limit(1);
        if (taken[0]) {
          throw new ConflictError('That workspace name is already taken.', 'public_name_taken');
        }

        const existing = await db
          .select({ id: workspacePublicSlug.id })
          .from(workspacePublicSlug)
          .where(eq(workspacePublicSlug.organizationId, orgId))
          .limit(1);
        const prior = existing[0];
        if (prior) {
          await db
            .update(workspacePublicSlug)
            .set({ slug })
            .where(eq(workspacePublicSlug.id, prior.id));
        } else {
          await db
            .insert(workspacePublicSlug)
            .values({ organizationId: orgId, slug, createdBy: actorId });
        }

        return ok(c, WorkspacePublicSlugOut, {
          organizationId: orgId,
          slug,
          baseUrl: workspaceBaseUrl(slug),
        });
      },
    )
    .get(
      '/suggested-name',
      capabilityGuard('manage'),
      apiDoc({
        tag: 'Publishing',
        summary: 'Suggest an available public name',
        capability: 'manage',
        response: WorkspacePublicSlugOut,
        description: `Return a public name derived from the workspace's own display name that is currently free, so the claim form can be pre-filled instead of demanding invention. Purely a suggestion: it is re-validated and re-checked for collisions on \`PUT /public-name\`, since another workspace may claim it in between. \`slug\` is \`null\` when the workspace name yields nothing usable. Requires \`manage\` (same audience as the claim it feeds).`,
      }),
      async (c) => {
        const { orgId } = c.get('actorCtx');
        const orgs = await db
          .select({ name: organization.name })
          .from(organization)
          .where(eq(organization.id, orgId))
          .limit(1);
        const base = suggestPublicSlug(orgs[0]?.name ?? '');
        let candidate: string | null = null;
        for (let attempt = 0; attempt < 12 && base.length > 0; attempt += 1) {
          const trial = attempt === 0 ? base : `${base}-${String(attempt + 1)}`;
          const clash = await db
            .select({ id: workspacePublicSlug.id })
            .from(workspacePublicSlug)
            .where(
              and(
                eq(workspacePublicSlug.slug, trial),
                ne(workspacePublicSlug.organizationId, orgId),
              ),
            )
            .limit(1);
          if (!clash[0]) {
            candidate = trial;
            break;
          }
        }
        return ok(c, WorkspacePublicSlugOut, {
          organizationId: orgId,
          slug: candidate,
          baseUrl: candidate === null ? null : workspaceBaseUrl(candidate),
        });
      },
    );
}

/** The publishing-addresses router wired to the platform DNS resolver. */
const publishingAddresses = createPublishingAddressRoutes();

export default publishingAddresses;
