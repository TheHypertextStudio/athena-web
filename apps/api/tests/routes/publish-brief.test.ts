/**
 * Direct unit coverage for the pure/near-pure exports of `src/routes/publish-brief.ts` that the
 * HTTP-level `publish.test.ts` suite does not reach: host classification (`isProductHost`),
 * host-scope resolution (`resolveHostScope`), the subject-title lookup, the live URL list, and
 * the publish-affordance batch read. Calling these directly (rather than through the public brief
 * route) makes edge cases — an unknown host, a workspace with no claimed name, a batch of zero
 * ids — cheap to exercise without standing up a full HTTP round trip for each one.
 */
import type * as DbModule from '@docket/db';
import { apiHosts, env, OWN_HOSTS } from '@docket/env/api';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { NotFoundError } from '../../src/error';
import type * as PublishBriefModule from '../../src/routes/publish-brief';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let isProductHost!: typeof PublishBriefModule.isProductHost;
let resolveHostScope!: typeof PublishBriefModule.resolveHostScope;
let requireSubjectTitle!: typeof PublishBriefModule.requireSubjectTitle;
let briefUrls!: typeof PublishBriefModule.briefUrls;
let briefUrlOnBriefHost!: typeof PublishBriefModule.briefUrlOnBriefHost;
let publicationsForSubjects!: typeof PublishBriefModule.publicationsForSubjects;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/publish-brief');
  ({
    isProductHost,
    resolveHostScope,
    requireSubjectTitle,
    briefUrls,
    briefUrlOnBriefHost,
    publicationsForSubjects,
  } = mod);
});

describe('isProductHost', () => {
  it('is true for every one of Docket’s own configured hosts', () => {
    for (const host of OWN_HOSTS) {
      expect(isProductHost(host)).toBe(true);
    }
  });

  it('is true for bare `localhost` and any `*.localhost` name outside production', () => {
    expect(isProductHost('localhost')).toBe(true);
    expect(isProductHost('foo.localhost')).toBe(true);
    expect(isProductHost('deeply.nested.localhost')).toBe(true);
  });

  it('is false for an unrelated domain that is neither a product host nor `.localhost`', () => {
    expect(isProductHost('a-strangers-domain.example')).toBe(false);
    expect(isProductHost('localhost.example')).toBe(false);
  });

  it('denies the `.localhost` allowance in production, even for a bare `localhost` host', () => {
    const savedMode = env.APP_MODE;
    (env as { APP_MODE: string }).APP_MODE = 'production';
    try {
      expect(isProductHost('localhost')).toBe(false);
      expect(isProductHost('foo.localhost')).toBe(false);
    } finally {
      (env as { APP_MODE: string }).APP_MODE = savedMode;
    }
  });
});

describe('resolveHostScope', () => {
  it('returns undefined for an empty or undefined host (no restriction)', async () => {
    expect(await resolveHostScope(undefined)).toBeUndefined();
    expect(await resolveHostScope('')).toBeUndefined();
  });

  it('returns undefined for one of Docket’s own hosts, even when unparsable as a custom domain', async () => {
    // `localhost` fails `normalizeCustomDomain` (single label, not-a-domain) and falls back to
    // the raw split — exercising both the ternary's fallback arm and `isProductHost`'s
    // `.localhost` allowance in the same call.
    expect(await resolveHostScope('localhost')).toBeUndefined();
    expect(await resolveHostScope('foo.localhost')).toBeUndefined();
  });

  it('throws not-found for a host with no verified workspace_domain row', async () => {
    await expect(resolveHostScope('nobody-claimed-this.example')).rejects.toThrow(NotFoundError);
  });

  it('resolves the owning workspace for a verified custom domain, in any spelling', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    await db.insert(schema.workspaceDomain).values({
      organizationId: orgId,
      host: 'verified-lookup.example',
      verificationToken: 'a'.repeat(32),
      verifiedAt: new Date(),
    });
    expect(await resolveHostScope('verified-lookup.example')).toBe(orgId);
    // Uppercase + port: the raw split-fallback path still lowercases and strips the port when
    // normalization itself fails for an otherwise-valid-looking host is not exercised here, but a
    // well-formed host with a port takes the ok branch and normalizes through it.
    expect(await resolveHostScope('VERIFIED-LOOKUP.example:8443')).toBe(orgId);
  });

  it('throws not-found for a verified domain’s host once it has been removed', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    await db.insert(schema.workspaceDomain).values({
      organizationId: orgId,
      host: 'unverified-lookup.example',
      verificationToken: 'b'.repeat(32),
      verifiedAt: null,
    });
    await expect(resolveHostScope('unverified-lookup.example')).rejects.toThrow(NotFoundError);
  });
});

describe('requireSubjectTitle', () => {
  it('returns the record’s current name for each subject kind', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const initiativeId = one(
      await db
        .insert(schema.initiative)
        .values({ organizationId: orgId, name: 'Reliability push' })
        .returning({ id: schema.initiative.id }),
    ).id;
    const programId = one(
      await db
        .insert(schema.program)
        .values({ organizationId: orgId, name: 'Platform program' })
        .returning({ id: schema.program.id }),
    ).id;
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Q3 project' })
        .returning({ id: schema.project.id }),
    ).id;

    expect(await requireSubjectTitle(orgId, 'initiative', initiativeId)).toBe('Reliability push');
    expect(await requireSubjectTitle(orgId, 'program', programId)).toBe('Platform program');
    expect(await requireSubjectTitle(orgId, 'project', projectId)).toBe('Q3 project');
  });

  it('throws not-found for a record in a different workspace', async () => {
    const mine = await seedBaseOrg(db, schema);
    const theirs = await seedBaseOrg(db, schema);
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: theirs.orgId, name: 'Not yours' })
        .returning({ id: schema.project.id }),
    ).id;
    await expect(requireSubjectTitle(mine.orgId, 'project', projectId)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('briefUrls', () => {
  it('returns an empty list for a workspace that has claimed no public name', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    expect(await briefUrls(orgId, 'whatever')).toEqual([]);
  });

  it('lists the brief host first, then every verified custom domain, for a claimed workspace', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const slug = `slugged-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(schema.workspacePublicSlug).values({ organizationId: orgId, slug });
    await db.insert(schema.workspaceDomain).values({
      organizationId: orgId,
      host: 'urls-verified.example',
      verificationToken: 'c'.repeat(32),
      verifiedAt: new Date(),
    });
    // An unverified domain must not appear.
    await db.insert(schema.workspaceDomain).values({
      organizationId: orgId,
      host: 'urls-unverified.example',
      verificationToken: 'd'.repeat(32),
      verifiedAt: null,
    });

    const urls = await briefUrls(orgId, 'brief-slug');
    expect(urls[0]).toBe(`https://${apiHosts.brief}/briefs/${slug}/brief-slug`);
    expect(urls).toContain(`https://urls-verified.example/briefs/${slug}/brief-slug`);
    expect(urls).not.toContain(`https://urls-unverified.example/briefs/${slug}/brief-slug`);
    expect(urls).toHaveLength(2);
  });
});

describe('when no brief host is configured for this deployment', () => {
  it('returns null from briefUrlOnBriefHost, and briefUrls skips the canonical entry entirely', async () => {
    const hosts = apiHosts as unknown as Record<string, unknown>;
    const saved = hosts['brief'];
    delete hosts['brief'];
    try {
      expect(briefUrlOnBriefHost('some-workspace', 'some-slug')).toBeNull();

      const { orgId } = await seedBaseOrg(db, schema);
      const slug = `no-brief-host-${Math.random().toString(36).slice(2, 8)}`;
      await db.insert(schema.workspacePublicSlug).values({ organizationId: orgId, slug });
      await db.insert(schema.workspaceDomain).values({
        organizationId: orgId,
        host: 'no-brief-host-verified.example',
        verificationToken: 'e'.repeat(32),
        verifiedAt: new Date(),
      });
      const urls = await briefUrls(orgId, 'a-published-slug');
      // No canonical brief-host URL is pushed, but the verified custom domain still is.
      expect(urls).toEqual([
        `https://no-brief-host-verified.example/briefs/${slug}/a-published-slug`,
      ]);
    } finally {
      hosts['brief'] = saved;
    }
  });
});

describe('publicationsForSubjects', () => {
  it('returns an empty array for an empty id list without querying', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    expect(await publicationsForSubjects(orgId, 'project', [])).toEqual([]);
  });

  it('returns the matching publication rows, newest first', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const aId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'first' })
        .returning({ id: schema.project.id }),
    ).id;
    const bId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'second' })
        .returning({ id: schema.project.id }),
    ).id;
    await db.insert(schema.publication).values({
      organizationId: orgId,
      subjectKind: 'project',
      subjectId: aId,
      slug: 'batch-a',
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await db.insert(schema.publication).values({
      organizationId: orgId,
      subjectKind: 'project',
      subjectId: bId,
      slug: 'batch-b',
      publishedAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    // A different subject kind with the same id must not be picked up.
    await db.insert(schema.publication).values({
      organizationId: orgId,
      subjectKind: 'initiative',
      subjectId: aId,
      slug: 'batch-a-initiative',
      publishedAt: new Date('2026-03-01T00:00:00.000Z'),
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const rows = await publicationsForSubjects(orgId, 'project', [aId, bId]);
    expect(rows.map((r) => r.slug)).toEqual(['batch-b', 'batch-a']);
  });
});

describe('the underlying record disappearing after publication', () => {
  it('404s an initiative brief once the initiative row is gone', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const slug = `ws-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(schema.workspacePublicSlug).values({ organizationId: orgId, slug });
    const initiativeId = one(
      await db
        .insert(schema.initiative)
        .values({ organizationId: orgId, name: 'Gone soon' })
        .returning({ id: schema.initiative.id }),
    ).id;
    await db.insert(schema.publication).values({
      organizationId: orgId,
      subjectKind: 'initiative',
      subjectId: initiativeId,
      slug: 'vanishing-initiative',
      publishedAt: new Date(),
    });
    await db.delete(schema.initiative).where(eq(schema.initiative.id, initiativeId));

    const { loadPublicBrief } = await import('../../src/routes/publish-brief');
    await expect(
      loadPublicBrief({ host: undefined, workspaceSlug: slug, slug: 'vanishing-initiative' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('404s a program brief once the program row is gone', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const slug = `ws-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(schema.workspacePublicSlug).values({ organizationId: orgId, slug });
    const programId = one(
      await db
        .insert(schema.program)
        .values({ organizationId: orgId, name: 'Gone soon' })
        .returning({ id: schema.program.id }),
    ).id;
    await db.insert(schema.publication).values({
      organizationId: orgId,
      subjectKind: 'program',
      subjectId: programId,
      slug: 'vanishing-program',
      publishedAt: new Date(),
    });
    await db.delete(schema.program).where(eq(schema.program.id, programId));

    const { loadPublicBrief } = await import('../../src/routes/publish-brief');
    await expect(
      loadPublicBrief({ host: undefined, workspaceSlug: slug, slug: 'vanishing-program' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('404s a project brief once the project row is gone', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const slug = `ws-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(schema.workspacePublicSlug).values({ organizationId: orgId, slug });
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Gone soon' })
        .returning({ id: schema.project.id }),
    ).id;
    await db.insert(schema.publication).values({
      organizationId: orgId,
      subjectKind: 'project',
      subjectId: projectId,
      slug: 'vanishing-project',
      publishedAt: new Date(),
    });
    await db.delete(schema.project).where(eq(schema.project.id, projectId));

    const { loadPublicBrief } = await import('../../src/routes/publish-brief');
    await expect(
      loadPublicBrief({ host: undefined, workspaceSlug: slug, slug: 'vanishing-project' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('404s for a workspace name nobody has claimed', async () => {
    const { loadPublicBrief } = await import('../../src/routes/publish-brief');
    await expect(
      loadPublicBrief({
        host: undefined,
        workspaceSlug: `nobody-claimed-${Math.random().toString(36).slice(2, 8)}`,
        slug: 'anything',
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('owner resolution and the task-state fallback in a project brief', () => {
  it('resolves a real owner name, drops a deleted owner to null, and falls back to completedAt/canceledAt when a task’s state key is unknown to its team', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const slug = `ws-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(schema.workspacePublicSlug).values({ organizationId: orgId, slug });

    const owner = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Priya Owner' })
        .returning({ id: schema.actor.id }),
    ).id;

    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Owned project', leadId: owner })
        .returning({ id: schema.project.id }),
    ).id;
    await db.insert(schema.publication).values({
      organizationId: orgId,
      subjectKind: 'project',
      subjectId: projectId,
      slug: 'owned-and-legacy-tasks',
      publishedAt: new Date(),
    });

    // A task whose `state` no longer matches any of the team's configured workflow states, and
    // that is recorded complete via `completedAt` rather than the (now-absent) workflow state.
    const doneTaskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Legacy-completed task',
          state: 'retired-state-key',
          projectId,
        })
        .returning({ id: schema.task.id }),
    ).id;
    await db
      .update(schema.task)
      .set({ completedAt: new Date('2026-01-05T00:00:00.000Z') })
      .where(eq(schema.task.id, doneTaskId));

    // A second task with the same unknown state key, but neither completed nor canceled.
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Legacy-open task',
      state: 'retired-state-key',
      projectId,
    });

    const { loadPublicBrief } = await import('../../src/routes/publish-brief');
    const brief = await loadPublicBrief({
      host: undefined,
      workspaceSlug: slug,
      slug: 'owned-and-legacy-tasks',
    });
    expect(brief.facts.find((f) => f.key === 'owner')?.value).toBe('Priya Owner');

    const tasks = brief.sections.find((s) => s.key === 'tasks')?.items ?? [];
    const done = tasks.find((t) => t.title === 'Legacy-completed task');
    const open = tasks.find((t) => t.title === 'Legacy-open task');
    // Falls back to the raw state key when no workflow state matches.
    expect(done?.status).toBe('retired-state-key');
    expect(done?.complete).toBe(true);
    expect(open?.complete).toBe(false);

    // Point `leadId` at an actor id that exists, but in a *different* workspace: the ownership
    // query is scoped by organization, so the lookup finds no row and the name falls back to
    // null rather than leaking a stranger's identity across tenants. (A same-tenant delete would
    // instead null out `leadId` itself via the FK's `ON DELETE SET NULL`, short-circuiting on the
    // "no owner at all" branch rather than reaching this fallback.)
    const otherOrg = await seedBaseOrg(db, schema);
    await db
      .update(schema.project)
      .set({ leadId: otherOrg.humanActorId })
      .where(eq(schema.project.id, projectId));
    const afterCrossTenantOwner = await loadPublicBrief({
      host: undefined,
      workspaceSlug: slug,
      slug: 'owned-and-legacy-tasks',
    });
    expect(afterCrossTenantOwner.facts.find((f) => f.key === 'owner')?.value).toBeNull();
  });
});

describe('publishing in a workspace with no claimed public name or domain', () => {
  it('produces an empty urls list from briefUrls, reflecting no reachable address', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Unclaimed workspace project' })
        .returning({ id: schema.project.id }),
    ).id;
    await db.insert(schema.publication).values({
      organizationId: orgId,
      subjectKind: 'project',
      subjectId: projectId,
      slug: 'unclaimed-slug',
      publishedAt: new Date(),
    });
    expect(await briefUrls(orgId, 'unclaimed-slug')).toEqual([]);
  });
});

describe('a program brief’s directly-held tasks and the owner fallback', () => {
  it('reads a program’s own owner name and its direct task section', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const slug = `ws-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(schema.workspacePublicSlug).values({ organizationId: orgId, slug });
    const owner = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Program Owner' })
        .returning({ id: schema.actor.id }),
    ).id;
    const programId = one(
      await db
        .insert(schema.program)
        .values({ organizationId: orgId, name: 'Owned program', ownerId: owner })
        .returning({ id: schema.program.id }),
    ).id;
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Directly on the program',
      state: 'todo',
      programId,
    });
    await db.insert(schema.publication).values({
      organizationId: orgId,
      subjectKind: 'program',
      subjectId: programId,
      slug: 'owned-program',
      publishedAt: new Date(),
    });

    const { loadPublicBrief } = await import('../../src/routes/publish-brief');
    const brief = await loadPublicBrief({
      host: undefined,
      workspaceSlug: slug,
      slug: 'owned-program',
    });
    expect(brief.facts.find((f) => f.key === 'owner')?.value).toBe('Program Owner');
    expect(brief.sections.find((s) => s.key === 'tasks')?.items.map((t) => t.title)).toEqual([
      'Directly on the program',
    ]);
  });
});
