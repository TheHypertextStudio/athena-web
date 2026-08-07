/**
 * Publishing: briefs, custom domains, and the public-name claim.
 *
 * @remarks
 * Covers CORE-26 (all three entity types publish and unpublish), CORE-27 (a brief reads live
 * records, never a snapshot), CORE-29 (admin-only domain administration), CORE-30 (one host, one
 * workspace — in the handler AND in the database), CORE-31 (DNS ownership before serving),
 * CORE-32 (the slug fallback), and MISS-04 (a verified domain serves its own workspace and only
 * its own workspace).
 */
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import { appWithActor, getDb, one, seedBaseOrg } from '../support/routes-harness';

type Db = typeof DbModule.db;

let schema: typeof DbModule;
let db: Db;

/** A publish/withdraw router mounted with the given capabilities. */
async function publishApp(orgId: string, capabilities: readonly string[], actorId = 'actor_test') {
  const publications = (await import('../../src/routes/publish')).default;
  return appWithActor(publications, orgId, capabilities, actorId);
}

/** The publishing-addresses router with an injected DNS resolver. */
async function addressApp(
  orgId: string,
  capabilities: readonly string[],
  txt: Record<string, readonly (string | readonly string[])[]> = {},
  actorId = 'actor_test',
) {
  const { createPublishingAddressRoutes } = await import('../../src/routes/domains');
  const router = createPublishingAddressRoutes(async (name) => {
    const found = txt[name];
    if (!found) throw new Error('ENOTFOUND');
    return Promise.resolve(found);
  });
  return appWithActor(router, orgId, capabilities, actorId);
}

/** The anonymous brief reader, mounted exactly as `server.ts` mounts it: no session at all. */
async function publicApp() {
  const publicBriefs = (await import('../../src/routes/publish-public')).default;
  const app = new Hono<AppEnv>();
  app.route('/', publicBriefs);
  app.onError(onError);
  return app;
}

/** Seed an org that has claimed a public name, so its briefs are addressable. */
async function seedPublishingOrg(
  name: string,
): Promise<{ orgId: string; teamId: string; humanActorId: string }> {
  const seeded = await seedBaseOrg(db, schema);
  await db.insert(schema.workspacePublicSlug).values({ organizationId: seeded.orgId, slug: name });
  return seeded;
}

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

describe('CORE-26 · publishing each of the three entity types', () => {
  it('serves a brief for an initiative, a program, and a project, and 404s once withdrawn', async () => {
    const workspace = `ws-${Math.random().toString(36).slice(2, 8)}`;
    const { orgId, teamId, humanActorId } = await seedPublishingOrg(workspace);
    const app = await publishApp(orgId, ['contribute'], humanActorId);
    const anon = await publicApp();

    const initiativeId = one(
      await db
        .insert(schema.initiative)
        .values({ organizationId: orgId, name: 'Reliability', summary: 'Keep the lights on' })
        .returning({ id: schema.initiative.id }),
    ).id;
    const programId = one(
      await db
        .insert(schema.program)
        .values({ organizationId: orgId, name: 'Platform Ops' })
        .returning({ id: schema.program.id }),
    ).id;
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Payments Hardening', programId })
        .returning({ id: schema.project.id }),
    ).id;
    // A task under the project, so the project brief has a body to render.
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Add idempotency keys',
      state: 'todo',
      projectId,
    });

    const cases = [
      { subjectKind: 'initiative' as const, subjectId: initiativeId, title: 'Reliability' },
      { subjectKind: 'program' as const, subjectId: programId, title: 'Platform Ops' },
      { subjectKind: 'project' as const, subjectId: projectId, title: 'Payments Hardening' },
    ];

    for (const target of cases) {
      const created = await app.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectKind: target.subjectKind, subjectId: target.subjectId }),
      });
      expect(created.status).toBe(201);
      const publication = (await created.json()) as {
        id: string;
        slug: string;
        published: boolean;
      };
      expect(publication.published).toBe(true);

      // Anonymous, no session anywhere in the stack.
      const read = await anon.request(`/briefs/${workspace}/${publication.slug}`);
      expect(read.status).toBe(200);
      const brief = (await read.json()) as { title: string; subjectKind: string };
      expect(brief.title).toBe(target.title);
      expect(brief.subjectKind).toBe(target.subjectKind);

      const withdrawn = await app.request(`/${publication.id}`, { method: 'DELETE' });
      expect(withdrawn.status).toBe(200);

      const afterWithdraw = await anon.request(`/briefs/${workspace}/${publication.slug}`);
      expect(afterWithdraw.status).toBe(404);

      // Re-publishing restores the SAME url rather than minting a new one.
      const republished = await app.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectKind: target.subjectKind, subjectId: target.subjectId }),
      });
      expect(republished.status).toBe(201);
      expect(((await republished.json()) as { slug: string }).slug).toBe(publication.slug);
      expect((await anon.request(`/briefs/${workspace}/${publication.slug}`)).status).toBe(200);
    }
  });

  it('refuses to publish a record belonging to another workspace', async () => {
    const other = await seedBaseOrg(db, schema);
    const { orgId, humanActorId } = await seedPublishingOrg(
      `ws-${Math.random().toString(36).slice(2, 8)}`,
    );
    const foreignProject = one(
      await db
        .insert(schema.project)
        .values({ organizationId: other.orgId, name: 'Not yours' })
        .returning({ id: schema.project.id }),
    ).id;

    const app = await publishApp(orgId, ['contribute'], humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'project', subjectId: foreignProject }),
    });
    expect(res.status).toBe(404);
    expect(
      await db
        .select()
        .from(schema.publication)
        .where(
          and(
            eq(schema.publication.organizationId, orgId),
            eq(schema.publication.subjectId, foreignProject),
          ),
        )
        .then((rows) => rows.length),
    ).toBe(0);
  });

  it('requires contribute to publish', async () => {
    const { orgId, humanActorId } = await seedPublishingOrg(
      `ws-${Math.random().toString(36).slice(2, 8)}`,
    );
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Gated' })
        .returning({ id: schema.project.id }),
    ).id;
    const viewer = await publishApp(orgId, ['view'], humanActorId);
    const res = await viewer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'project', subjectId: projectId }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses to publish a record whose title yields no sluggable characters', async () => {
    const { orgId, humanActorId } = await seedPublishingOrg(
      `ws-${Math.random().toString(36).slice(2, 8)}`,
    );
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: '🎉🎉🎉' })
        .returning({ id: schema.project.id }),
    ).id;
    const app = await publishApp(orgId, ['contribute'], humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'project', subjectId: projectId }),
    });
    expect(res.status).toBe(422);
    const problem = (await res.json()) as { fieldErrors?: Record<string, unknown> };
    expect(Object.keys(problem.fieldErrors ?? {})).toContain('slug');
  });

  it('publishes in a workspace with no claimed public name: path uses the placeholder and urls is empty', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Unclaimed workspace project' })
        .returning({ id: schema.project.id }),
    ).id;
    const app = await publishApp(orgId, ['contribute'], humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'project', subjectId: projectId, slug: 'no-claim' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { path: string; urls: string[] };
    expect(body.path).toBe('/briefs/:workspace/no-claim');
    expect(body.urls).toEqual([]);
  });
});

describe('reading publication state (GET /, GET /:subjectKind/:subjectId)', () => {
  it('lists every publication in the workspace, newest first, including withdrawn rows', async () => {
    const workspace = `ws-${Math.random().toString(36).slice(2, 8)}`;
    const { orgId, humanActorId } = await seedPublishingOrg(workspace);
    const app = await publishApp(orgId, ['contribute'], humanActorId);
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Listed' })
        .returning({ id: schema.project.id }),
    ).id;
    const created = (await (
      await app.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectKind: 'project', subjectId: projectId, slug: 'listed' }),
      })
    ).json()) as { id: string };
    await app.request(`/${created.id}`, { method: 'DELETE' });

    const listed = (await (await app.request('/')).json()) as {
      items: { id: string; published: boolean; urls: string[] }[];
    };
    const row = listed.items.find((item) => item.id === created.id);
    expect(row).toBeDefined();
    expect(row?.published).toBe(false);
    // A withdrawn brief resolves no live urls.
    expect(row?.urls).toEqual([]);
  });

  it('reports publication: null for a record that has never been published', async () => {
    const { orgId, humanActorId } = await seedPublishingOrg(
      `ws-${Math.random().toString(36).slice(2, 8)}`,
    );
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Never published' })
        .returning({ id: schema.project.id }),
    ).id;
    const app = await publishApp(orgId, ['contribute'], humanActorId);
    const res = await app.request(`/project/${projectId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ publication: null });
  });

  it('reports the full publication state for a published record', async () => {
    const workspace = `ws-${Math.random().toString(36).slice(2, 8)}`;
    const { orgId, humanActorId } = await seedPublishingOrg(workspace);
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Has state' })
        .returning({ id: schema.project.id }),
    ).id;
    const app = await publishApp(orgId, ['contribute'], humanActorId);
    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'project', subjectId: projectId, slug: 'has-state' }),
    });
    const res = await app.request(`/project/${projectId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publication: { published: boolean; slug: string } | null };
    expect(body.publication?.published).toBe(true);
    expect(body.publication?.slug).toBe('has-state');
  });
});

describe('404s for an id that does not belong to this workspace', () => {
  it('404s a DELETE on an unknown publication id', async () => {
    const { orgId, humanActorId } = await seedPublishingOrg(
      `ws-${Math.random().toString(36).slice(2, 8)}`,
    );
    const app = await publishApp(orgId, ['contribute'], humanActorId);
    expect((await app.request('/not-a-real-id', { method: 'DELETE' })).status).toBe(404);
  });

  it('404s a PATCH on an unknown publication id', async () => {
    const { orgId, humanActorId } = await seedPublishingOrg(
      `ws-${Math.random().toString(36).slice(2, 8)}`,
    );
    const app = await publishApp(orgId, ['contribute'], humanActorId);
    const res = await app.request('/not-a-real-id', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ published: true }),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /:id · moving and withdrawing a brief in place', () => {
  async function publishedFixture(): Promise<{
    app: Awaited<ReturnType<typeof publishApp>>;
    anon: Awaited<ReturnType<typeof publicApp>>;
    orgId: string;
    humanActorId: string;
    workspace: string;
    publicationId: string;
    slug: string;
  }> {
    const workspace = `ws-${Math.random().toString(36).slice(2, 8)}`;
    const { orgId, humanActorId } = await seedPublishingOrg(workspace);
    const app = await publishApp(orgId, ['contribute'], humanActorId);
    const anon = await publicApp();
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Patchable' })
        .returning({ id: schema.project.id }),
    ).id;
    const created = (await (
      await app.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectKind: 'project', subjectId: projectId, slug: 'patchable' }),
      })
    ).json()) as { id: string; slug: string };
    return {
      app,
      anon,
      orgId,
      humanActorId,
      workspace,
      publicationId: created.id,
      slug: created.slug,
    };
  }

  it('moves a brief to a new address, leaving its published state untouched', async () => {
    const { app, anon, workspace, publicationId } = await publishedFixture();
    const res = await app.request(`/${publicationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'moved-address' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slug: string; published: boolean };
    expect(body.slug).toBe('moved-address');
    expect(body.published).toBe(true);
    expect((await anon.request(`/briefs/${workspace}/moved-address`)).status).toBe(200);
    expect((await anon.request(`/briefs/${workspace}/patchable`)).status).toBe(404);
  });

  it('no-ops when the patch names the brief’s own current slug', async () => {
    const { app, publicationId, slug } = await publishedFixture();
    const res = await app.request(`/${publicationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { slug: string }).slug).toBe(slug);
  });

  it('409s a PATCH that names another brief’s address, and changes nothing', async () => {
    const { app, orgId, publicationId, slug } = await publishedFixture();
    const otherProjectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Other patchable' })
        .returning({ id: schema.project.id }),
    ).id;
    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subjectKind: 'project',
        subjectId: otherProjectId,
        slug: 'already-taken',
      }),
    });

    const clash = await app.request(`/${publicationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'already-taken' }),
    });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { code: string }).code).toBe('public_name_taken');

    const unchanged = one(
      await db
        .select({ slug: schema.publication.slug })
        .from(schema.publication)
        .where(eq(schema.publication.id, publicationId)),
    );
    expect(unchanged.slug).toBe(slug);
  });

  it('withdraws via PATCH published:false exactly like DELETE, and restores via published:true at the same address', async () => {
    const { app, anon, workspace, publicationId, slug } = await publishedFixture();

    const withdrawn = await app.request(`/${publicationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ published: false }),
    });
    expect(withdrawn.status).toBe(200);
    const withdrawnBody = (await withdrawn.json()) as { published: boolean; publishedAt: null };
    expect(withdrawnBody.published).toBe(false);
    expect(withdrawnBody.publishedAt).toBeNull();
    expect((await anon.request(`/briefs/${workspace}/${slug}`)).status).toBe(404);

    const restored = await app.request(`/${publicationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ published: true }),
    });
    expect(restored.status).toBe(200);
    const restoredBody = (await restored.json()) as { published: boolean; slug: string };
    expect(restoredBody.published).toBe(true);
    expect(restoredBody.slug).toBe(slug);
    expect((await anon.request(`/briefs/${workspace}/${slug}`)).status).toBe(200);
  });

  it('keeps the original publishedAt when PATCH published:true is a no-op on an already-published brief', async () => {
    const { app, publicationId } = await publishedFixture();
    const before = one(
      await db
        .select({ publishedAt: schema.publication.publishedAt })
        .from(schema.publication)
        .where(eq(schema.publication.id, publicationId)),
    );

    const again = (await (
      await app.request(`/${publicationId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ published: true }),
      })
    ).json()) as { publishedAt: string };
    expect(again.publishedAt).toBe(before.publishedAt?.toISOString());
  });
});

describe('CORE-27 · a brief reads the live record, not a snapshot', () => {
  it('reflects an edit to the title, status, dates, description, and child list', async () => {
    const workspace = `ws-${Math.random().toString(36).slice(2, 8)}`;
    const { orgId, teamId, humanActorId } = await seedPublishingOrg(workspace);
    const app = await publishApp(orgId, ['contribute'], humanActorId);
    const anon = await publicApp();

    const projectId = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Before',
          description: 'Old body',
          status: 'planned',
        })
        .returning({ id: schema.project.id }),
    ).id;
    const created = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'project', subjectId: projectId, slug: 'live-read' }),
    });
    expect(created.status).toBe(201);

    const before = (await (await anon.request(`/briefs/${workspace}/live-read`)).json()) as {
      title: string;
      description: string | null;
      facts: { key: string; value: string | null }[];
      sections: { key: string; items: unknown[] }[];
    };
    expect(before.title).toBe('Before');
    expect(before.facts.find((f) => f.key === 'status')?.value).toBe('planned');
    expect(before.sections.find((s) => s.key === 'tasks')?.items).toHaveLength(0);

    // Edit the underlying rows exactly as the app would, touching nothing in `publication`.
    await db
      .update(schema.project)
      .set({
        name: 'After',
        description: 'New body',
        status: 'active',
        targetDate: new Date('2026-09-30T00:00:00.000Z'),
      })
      .where(eq(schema.project.id, projectId));
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Freshly added',
      state: 'todo',
      projectId,
    });

    const after = (await (await anon.request(`/briefs/${workspace}/live-read`)).json()) as {
      title: string;
      description: string | null;
      facts: { key: string; value: string | null }[];
      sections: { key: string; items: { title: string }[] }[];
    };
    expect(after.title).toBe('After');
    expect(after.description).toBe('New body');
    expect(after.facts.find((f) => f.key === 'status')?.value).toBe('active');
    // A bare calendar day, not an instant: a start/target date is a day, and shipping the ISO
    // instant makes every reader west of UTC print the day before.
    expect(after.facts.find((f) => f.key === 'targetDate')?.value).toBe('2026-09-30');
    expect(after.sections.find((s) => s.key === 'tasks')?.items.map((t) => t.title)).toEqual([
      'Freshly added',
    ]);
  });

  it('stores no copy of the record: the publication table has no content columns', () => {
    // The structural half of CORE-27. If a snapshot column is ever added, this fails and the
    // "same underlying data source" guarantee has to be re-argued rather than quietly lost.
    const columns = Object.keys(schema.publication).filter((key) => !key.startsWith('_'));
    for (const forbidden of ['title', 'name', 'description', 'summary', 'status', 'body', 'html']) {
      expect(columns).not.toContain(forbidden);
    }
  });
});

describe('CORE-29 · only workspace admins configure domains', () => {
  it('403s every domain route for a non-admin member and writes nothing', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const member = await addressApp(orgId, ['contribute'], {}, humanActorId);

    expect((await member.request('/domains')).status).toBe(403);
    const created = await member.request('/domains', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: 'members-cannot.example' }),
    });
    expect(created.status).toBe(403);
    expect((await member.request('/domains/anything/verify', { method: 'POST' })).status).toBe(403);
    expect((await member.request('/domains/anything', { method: 'DELETE' })).status).toBe(403);
    expect(
      (
        await member.request('/public-name', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug: 'members-cannot' }),
        })
      ).status,
    ).toBe(403);

    const rows = await db
      .select()
      .from(schema.workspaceDomain)
      .where(eq(schema.workspaceDomain.host, 'members-cannot.example'));
    expect(rows).toHaveLength(0);
  });

  it("404s a different workspace's domain even for an admin of another org", async () => {
    const owner = await seedBaseOrg(db, schema);
    const intruder = await seedBaseOrg(db, schema);
    const ownerApp = await addressApp(owner.orgId, ['manage'], {}, owner.humanActorId);
    const created = await ownerApp.request('/domains', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: 'owned.example' }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const intruderApp = await addressApp(intruder.orgId, ['manage'], {}, intruder.humanActorId);
    expect((await intruderApp.request(`/domains/${id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await intruderApp.request(`/domains/${id}/verify`, { method: 'POST' })).status).toBe(
      404,
    );
    const listed = (await (await intruderApp.request('/domains')).json()) as {
      items: { host: string }[];
    };
    expect(listed.items.map((d) => d.host)).not.toContain('owned.example');
  });

  it('lets an admin add, list, and remove a domain', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const admin = await addressApp(orgId, ['manage'], {}, humanActorId);
    const created = await admin.request('/domains', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: 'https://WWW.Managed.Example/some/path' }),
    });
    expect(created.status).toBe(201);
    const domain = (await created.json()) as { id: string; host: string; verified: boolean };
    expect(domain.host).toBe('managed.example');
    expect(domain.verified).toBe(false);

    const listed = (await (await admin.request('/domains')).json()) as { items: { id: string }[] };
    expect(listed.items.map((d) => d.id)).toContain(domain.id);

    expect((await admin.request(`/domains/${domain.id}`, { method: 'DELETE' })).status).toBe(200);
    const after = (await (await admin.request('/domains')).json()) as { items: unknown[] };
    expect(after.items).toHaveLength(0);
  });

  it('rejects a malformed host with a field issue and no row', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const admin = await addressApp(orgId, ['manage'], {}, humanActorId);
    for (const host of ['localhost', '203.0.113.10', '*.wild.example', 'not a domain']) {
      const res = await admin.request('/domains', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host }),
      });
      expect(res.status).toBe(422);
      const problem = (await res.json()) as { fieldErrors?: Record<string, unknown> };
      expect(Object.keys(problem.fieldErrors ?? {})).toContain('host');
    }
    const rows = await db
      .select()
      .from(schema.workspaceDomain)
      .where(eq(schema.workspaceDomain.organizationId, orgId));
    expect(rows).toHaveLength(0);
  });
});

describe('CORE-30 · a domain belongs to exactly one workspace', () => {
  it('409s a second workspace claiming the same host in any spelling, and writes no row', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const adminA = await addressApp(a.orgId, ['manage'], {}, a.humanActorId);
    const adminB = await addressApp(b.orgId, ['manage'], {}, b.humanActorId);

    expect(
      (
        await adminA.request('/domains', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ host: 'contested.example' }),
        })
      ).status,
    ).toBe(201);

    for (const spelling of [
      'contested.example',
      'CONTESTED.Example',
      'contested.example.',
      'www.contested.example',
      'https://www.CONTESTED.example/briefs',
    ]) {
      const res = await adminB.request('/domains', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host: spelling }),
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { code: string }).code).toBe('domain_already_claimed');
    }

    const rows = await db
      .select()
      .from(schema.workspaceDomain)
      .where(eq(schema.workspaceDomain.host, 'contested.example'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationId).toBe(a.orgId);
  });

  it('violates a unique constraint on a direct duplicate INSERT', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    await db.insert(schema.workspaceDomain).values({
      organizationId: a.orgId,
      host: 'db-level.example',
      verificationToken: 'a'.repeat(32),
    });
    await expect(
      db.insert(schema.workspaceDomain).values({
        organizationId: b.orgId,
        host: 'db-level.example',
        verificationToken: 'b'.repeat(32),
      }),
    ).rejects.toThrow();
  });
});

describe('CORE-31 · DNS ownership before serving', () => {
  it('persists unverified, shows the exact record, and refuses to serve until the token matches', async () => {
    const workspace = `ws-${Math.random().toString(36).slice(2, 8)}`;
    const { orgId, humanActorId } = await seedPublishingOrg(workspace);
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Gated by DNS' })
        .returning({ id: schema.project.id }),
    ).id;
    await (
      await publishApp(orgId, ['contribute'], humanActorId)
    ).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'project', subjectId: projectId, slug: 'dns-gate' }),
    });

    const admin = await addressApp(orgId, ['manage'], {}, humanActorId);
    const created = await admin.request('/domains', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: 'briefs.tenant.example' }),
    });
    const domain = (await created.json()) as {
      id: string;
      verified: boolean;
      verificationRecord: { type: string; name: string; value: string; ttlSeconds: number };
    };
    expect(domain.verified).toBe(false);
    expect(domain.verificationRecord.type).toBe('TXT');
    expect(domain.verificationRecord.name).toBe('_docket-verify.briefs.tenant.example');
    expect(domain.verificationRecord.value).toMatch(/^docket-domain-verification=[0-9a-f]{32}$/);

    const anon = await publicApp();
    // Unverified: the host serves nothing (MISS-04's "before verification the identical request
    // returns 4xx with no brief content").
    const refused = await anon.request(`/briefs/${workspace}/dns-gate?host=briefs.tenant.example`);
    expect(refused.status).toBe(404);
    expect(await refused.text()).not.toContain('Gated by DNS');

    // A wrong token leaves it unverified.
    const wrong = await addressApp(
      orgId,
      ['manage'],
      { '_docket-verify.briefs.tenant.example': [['docket-domain-verification=', 'f'.repeat(32)]] },
      humanActorId,
    );
    const wrongResult = (await (
      await wrong.request(`/domains/${domain.id}/verify`, { method: 'POST' })
    ).json()) as { verified: boolean; failure: string; observedCount: number };
    expect(wrongResult.verified).toBe(false);
    expect(wrongResult.failure).toBe('token-mismatch');
    expect(wrongResult.observedCount).toBe(1);
    expect(
      (await anon.request(`/briefs/${workspace}/dns-gate?host=briefs.tenant.example`)).status,
    ).toBe(404);

    // A missing record is distinguished from a wrong one.
    const missing = (await (
      await (
        await addressApp(orgId, ['manage'], {}, humanActorId)
      ).request(`/domains/${domain.id}/verify`, { method: 'POST' })
    ).json()) as { failure: string; observedCount: number };
    expect(missing.failure).toBe('lookup-failed');
    expect(missing.observedCount).toBe(0);

    // The right token verifies, and the host starts serving.
    const stored = one(
      await db
        .select({ token: schema.workspaceDomain.verificationToken })
        .from(schema.workspaceDomain)
        .where(eq(schema.workspaceDomain.id, domain.id)),
    );
    const right = await addressApp(
      orgId,
      ['manage'],
      { '_docket-verify.briefs.tenant.example': [`docket-domain-verification=${stored.token}`] },
      humanActorId,
    );
    const rightResult = (await (
      await right.request(`/domains/${domain.id}/verify`, { method: 'POST' })
    ).json()) as { verified: boolean; failure: string | null };
    expect(rightResult.verified).toBe(true);
    expect(rightResult.failure).toBeNull();

    const served = await anon.request(`/briefs/${workspace}/dns-gate?host=briefs.tenant.example`);
    expect(served.status).toBe(200);
    expect(((await served.json()) as { title: string }).title).toBe('Gated by DNS');
  });
});

describe('CORE-32 · the workspace slug fallback', () => {
  it('claims a name, serves briefs on it, and refuses a taken or reserved one', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const adminA = await addressApp(a.orgId, ['manage'], {}, a.humanActorId);
    const adminB = await addressApp(b.orgId, ['manage'], {}, b.humanActorId);
    const name = `claimed-${Math.random().toString(36).slice(2, 8)}`;

    expect(
      ((await (await adminA.request('/public-name')).json()) as { slug: null }).slug,
    ).toBeNull();

    const claimed = await adminA.request('/public-name', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: name }),
    });
    expect(claimed.status).toBe(200);
    expect(((await claimed.json()) as { slug: string }).slug).toBe(name);

    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: a.orgId, name: 'Slug-served' })
        .returning({ id: schema.project.id }),
    ).id;
    await (
      await publishApp(a.orgId, ['contribute'], a.humanActorId)
    ).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'project', subjectId: projectId, slug: 'on-a-slug' }),
    });
    const anon = await publicApp();
    expect((await anon.request(`/briefs/${name}/on-a-slug`)).status).toBe(200);

    // A second workspace naming the conflict, with no row written.
    const conflict = await adminB.request('/public-name', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: name }),
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { code: string }).code).toBe('public_name_taken');
    const bRows = await db
      .select()
      .from(schema.workspacePublicSlug)
      .where(eq(schema.workspacePublicSlug.organizationId, b.orgId));
    expect(bRows).toHaveLength(0);

    // Reserved/system names are refused outright.
    for (const reserved of ['api', 'settings', 'sign-in', 'privacy', '_next']) {
      const res = await adminB.request('/public-name', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: reserved }),
      });
      expect(res.status).toBe(422);
    }
  });

  it('rejects a brief slug that collides with another brief in the same workspace', async () => {
    const workspace = `ws-${Math.random().toString(36).slice(2, 8)}`;
    const { orgId, humanActorId } = await seedPublishingOrg(workspace);
    const app = await publishApp(orgId, ['contribute'], humanActorId);
    const first = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'One' })
        .returning({ id: schema.project.id }),
    ).id;
    const second = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Two' })
        .returning({ id: schema.project.id }),
    ).id;

    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'project', subjectId: first, slug: 'shared-address' }),
    });
    const clash = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'project', subjectId: second, slug: 'shared-address' }),
    });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { code: string }).code).toBe('public_name_taken');
  });
});

describe('MISS-04 · a verified domain serves its own workspace only', () => {
  it('serves this workspace, refuses another workspace, and stops when the domain is removed', async () => {
    const tenantName = `tenant-${Math.random().toString(36).slice(2, 8)}`;
    const otherName = `other-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await seedPublishingOrg(tenantName);
    const other = await seedPublishingOrg(otherName);

    const mine = one(
      await db
        .insert(schema.project)
        .values({ organizationId: tenant.orgId, name: 'Mine' })
        .returning({ id: schema.project.id }),
    ).id;
    const theirs = one(
      await db
        .insert(schema.project)
        .values({ organizationId: other.orgId, name: 'Theirs' })
        .returning({ id: schema.project.id }),
    ).id;
    await (
      await publishApp(tenant.orgId, ['contribute'], tenant.humanActorId)
    ).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'project', subjectId: mine, slug: 'mine' }),
    });
    await (
      await publishApp(other.orgId, ['contribute'], other.humanActorId)
    ).request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'project', subjectId: theirs, slug: 'theirs' }),
    });

    const host = 'serving.tenant.example';
    const admin = await addressApp(tenant.orgId, ['manage'], {}, tenant.humanActorId);
    const domain = (await (
      await admin.request('/domains', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host }),
      })
    ).json()) as { id: string };
    const token = one(
      await db
        .select({ token: schema.workspaceDomain.verificationToken })
        .from(schema.workspaceDomain)
        .where(eq(schema.workspaceDomain.id, domain.id)),
    ).token;
    const verifier = await addressApp(
      tenant.orgId,
      ['manage'],
      { [`_docket-verify.${host}`]: [`docket-domain-verification=${token}`] },
      tenant.humanActorId,
    );
    await verifier.request(`/domains/${domain.id}/verify`, { method: 'POST' });

    const anon = await publicApp();
    expect((await anon.request(`/briefs/${tenantName}/mine?host=${host}`)).status).toBe(200);
    // Another workspace's brief is not reachable on this host, even though it is published.
    expect((await anon.request(`/briefs/${otherName}/theirs?host=${host}`)).status).toBe(404);
    // …but it is reachable on Docket's own host.
    expect((await anon.request(`/briefs/${otherName}/theirs`)).status).toBe(200);
    // An entirely unknown host serves nothing at all.
    expect((await anon.request(`/briefs/${tenantName}/mine?host=squatter.example`)).status).toBe(
      404,
    );

    await admin.request(`/domains/${domain.id}`, { method: 'DELETE' });
    expect((await anon.request(`/briefs/${tenantName}/mine?host=${host}`)).status).toBe(404);
  });
});
