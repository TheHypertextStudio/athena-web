import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { schema, connect, seed, index, linked, file, list, get, Results } from './library-fixtures';

describe('MCP Library', () => {
  it('advertises Library detail and content templates alongside entity reads', async () => {
    const s = await seed();
    const client = await connect(s.ctx);
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.map((template) => template.uriTemplate).sort()).toEqual([
      'docket://{org}/library/{kind}/{id}',
      'docket://{org}/library/{kind}/{id}/content',
      'docket://{org}/{type}/{id}',
    ]);
  });
  it('browses both Library kinds, filters and pages without exposing attachment internals', async () => {
    const s = await seed();
    const linkId = await linked(s);
    const fileId = await file(s);
    const client = await connect(s.ctx);
    const first = await list(client, { orgId: s.orgId, limit: 1 });
    expect(first.items).toHaveLength(1);
    const second = await list(client, { orgId: s.orgId, limit: 1, cursor: first.nextCursor });
    expect(new Set([...first.items, ...second.items].map((item) => item.id))).toEqual(
      new Set([linkId, fileId]),
    );
    const filtered = await list(client, {
      orgId: s.orgId,
      kinds: ['external_resource'],
      query: 'Transit',
    });
    expect(filtered.items.map((item) => item.id)).toEqual([linkId]);
    expect(JSON.stringify(await list(client, { orgId: s.orgId }))).not.toMatch(
      /privateToken|sourceIntegrationId|blobKey|never-return/,
    );
  });

  it('searches all and only the user’s workspaces, while agents remain workspace scoped', async () => {
    const a = await seed();
    const b = await seed();
    const foreign = await seed();
    await schema.db
      .insert(schema.actor)
      .values({ organizationId: b.orgId, kind: 'human', userId: a.userId, displayName: 'Ada' });
    const aId = await linked(a);
    const bId = await linked(b);
    await linked(foreign);
    const user = await connect(a.ctx);
    expect((await list(user)).items.map((item) => item.id).sort()).toEqual([aId, bId].sort());
    expect((await list(user, { orgId: foreign.orgId })).items).toEqual([]);
    const agent = await connect({
      scopes: ['work:read'],
      principal: {
        kind: 'agent',
        agentId: a.agentId,
        agentActorId: a.agentActorId,
        orgId: a.orgId,
        displayName: 'Agent',
      },
    });
    expect((await list(agent)).items.map((item) => item.id)).toEqual([aId]);
    expect((await get(agent, b.orgId, 'external_resource', bId)).status).toBe('not_found');
  });

  it('reads current details through tools and URIs even without an index row', async () => {
    const s = await seed();
    const id = await linked(s);
    const client = await connect(s.ctx);
    await schema.db.delete(schema.searchDocument).where(eq(schema.searchDocument.entityId, id));
    await schema.db
      .update(schema.externalResource)
      .set({ title: 'Corrected title' })
      .where(eq(schema.externalResource.id, id));
    const detail = await get(client, s.orgId, 'external_resource', id);
    expect(detail).toMatchObject({
      status: 'ok',
      resource: { title: 'Corrected title', content: { status: 'unsupported' } },
    });
    const read = await client.readResource({
      uri: `docket://${s.orgId}/library/external_resource/${id}`,
    });
    const content = assertDefined(read.contents[0]);
    expect('text' in content && JSON.parse(content.text)).toEqual(detail['resource']);
    expect(JSON.stringify(detail)).not.toMatch(/sourceIntegrationId|unfurlLease|unfurlError/);
  });

  it('fetches uploaded bytes and MIME type and rechecks visibility after discovery', async () => {
    const s = await seed();
    const id = await file(s);
    const client = await connect(s.ctx);
    const uri = `docket://${s.orgId}/library/attachment/${id}/content`;
    expect(await get(client, s.orgId, 'attachment', id)).toMatchObject({
      resource: { content: { status: 'available', uri } },
    });
    const read = await client.readResource({ uri });
    expect(read.contents[0]).toMatchObject({
      mimeType: 'text/plain',
      blob: Buffer.from('Transit file contents').toString('base64'),
    });
    await schema.db
      .update(schema.task)
      .set({ visibility: 'private' })
      .where(eq(schema.task.id, s.taskId));
    expect((await list(client, { orgId: s.orgId })).items).toEqual([]);
    expect((await get(client, s.orgId, 'attachment', id)).status).toBe('not_found');
    await expect(client.readResource({ uri })).rejects.toThrow();
  });

  it.each(['membership', 'membership_archive', 'archive', 'subject_archive'] as const)(
    'hides resources after %s changes without waiting for reindexing',
    async (change) => {
      const s = await seed();
      const id = change === 'subject_archive' ? await file(s) : await linked(s);
      const kind = change === 'subject_archive' ? 'attachment' : 'external_resource';
      const client = await connect(s.ctx);
      await list(client, { orgId: s.orgId });
      if (change === 'membership')
        await schema.db
          .update(schema.actor)
          .set({ status: 'suspended' })
          .where(eq(schema.actor.id, s.actorId));
      else if (change === 'membership_archive')
        await schema.db
          .update(schema.actor)
          .set({ archivedAt: new Date() })
          .where(eq(schema.actor.id, s.actorId));
      else if (change === 'archive')
        await schema.db
          .update(schema.externalResource)
          .set({ archivedAt: new Date() })
          .where(eq(schema.externalResource.id, id));
      else
        await schema.db
          .update(schema.task)
          .set({ archivedAt: new Date() })
          .where(eq(schema.task.id, s.taskId));
      expect((await get(client, s.orgId, kind, id)).status).toBe('not_found');
      await expect(
        client.readResource({ uri: `docket://${s.orgId}/library/${kind}/${id}` }),
      ).rejects.toThrow();
    },
  );

  it('exposes only visible usage and rechecks guest grants on every detail/content read', async () => {
    const s = await seed();
    const id = await file(s);
    const linkId = await linked(s);
    await schema.db
      .update(schema.task)
      .set({ visibility: 'private' })
      .where(eq(schema.task.id, s.task2Id));
    await index('task', s.task2Id);
    for (const subjectId of [s.taskId, s.task2Id]) {
      await schema.db.insert(schema.mention).values({
        organizationId: s.orgId,
        createdBy: s.actorId,
        subjectType: 'task',
        subjectId,
        field: 'description',
        position: 0,
        targetKind: 'external',
        externalResourceId: linkId,
        label: 'Research',
      });
    }
    const client = await connect(s.ctx);
    expect(await get(client, s.orgId, 'external_resource', linkId)).toMatchObject({
      resource: { usedBy: { total: 1, groups: [{ items: [{ subjectId: s.taskId }] }] } },
    });
    const [role] = await schema.db
      .insert(schema.role)
      .values({
        organizationId: s.orgId,
        key: 'guest',
        name: 'Guest',
        capabilities: [],
        defaultVisibility: 'private',
      })
      .returning();
    await schema.db
      .update(schema.actor)
      .set({ roleId: assertDefined(role).id })
      .where(eq(schema.actor.id, s.actorId));
    expect((await get(client, s.orgId, 'attachment', id)).status).toBe('not_found');
    const [grant] = await schema.db
      .insert(schema.grant)
      .values({
        organizationId: s.orgId,
        subjectKind: 'actor',
        subjectId: s.actorId,
        resourceKind: 'task',
        resourceId: s.taskId,
        capabilities: ['view'],
        effect: 'allow',
        cascades: false,
      })
      .returning();
    expect((await get(client, s.orgId, 'attachment', id)).status).toBe('ok');
    await schema.db.delete(schema.grant).where(eq(schema.grant.id, assertDefined(grant).id));
    const uri = `docket://${s.orgId}/library/attachment/${id}/content`;
    await expect(client.readResource({ uri })).rejects.toThrow();
    expect((await get(client, s.orgId, 'external_resource', linkId)).status).toBe('ok');
  });

  it('omits archived rows from discovery while preserving a cursor through a stale page', async () => {
    const s = await seed();
    const olderId = await linked(s, 'Older material');
    const staleId = await linked(s, 'Archived material');
    await schema.db
      .update(schema.externalResource)
      .set({ archivedAt: new Date() })
      .where(eq(schema.externalResource.id, staleId));
    const client = await connect(s.ctx);
    const page = await list(client, { orgId: s.orgId, limit: 1 });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeDefined();
    expect(
      (await list(client, { orgId: s.orgId, limit: 1, cursor: page.nextCursor })).items.map(
        (item) => item.id,
      ),
    ).toEqual([olderId]);
  });

  it('validates batch/page bounds and binds pagination to its workspace and query', async () => {
    const s = await seed();
    await linked(s);
    await linked(s, 'Other research');
    const client = await connect(s.ctx);
    const page = await list(client, { orgId: s.orgId, limit: 1 });
    for (const args of [
      { limit: 101 },
      { kinds: ['task'] },
      { orgId: s.orgId, query: 'changed', cursor: page.nextCursor },
    ]) {
      expect((await client.callTool({ name: 'list_resources', arguments: args })).isError).toBe(
        true,
      );
    }
    expect(
      (await client.callTool({ name: 'get_resources', arguments: { refs: [] } })).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: 'get_resources',
          arguments: {
            refs: Array.from({ length: 11 }, () => ({
              orgId: s.orgId,
              kind: 'attachment',
              id: 'missing',
            })),
          },
        })
      ).isError,
    ).toBe(true);
  });

  it.each([
    { missing: true, status: 'unavailable' },
    { size: 4194305, status: 'too_large' },
  ])('reports $status content without hiding metadata', async ({ status, ...options }) => {
    const s = await seed();
    const id = await file(s, options);
    const client = await connect(s.ctx);
    expect(await get(client, s.orgId, 'attachment', id)).toMatchObject({
      status: 'ok',
      resource: { title: 'Transit file', content: { status } },
    });
    await expect(
      client.readResource({ uri: `docket://${s.orgId}/library/attachment/${id}/content` }),
    ).rejects.toThrow();
  });

  it('returns per-item misses and keeps scope failures outside the batch', async () => {
    const s = await seed();
    const id = await linked(s);
    const client = await connect(s.ctx);
    const result = await client.callTool({
      name: 'get_resources',
      arguments: {
        refs: [
          { orgId: s.orgId, kind: 'external_resource', id },
          { orgId: s.orgId, kind: 'external_resource', id: 'missing' },
        ],
      },
    });
    expect(Results.parse(result.structuredContent).items.map((item) => item.status)).toEqual([
      'ok',
      'not_found',
    ]);
    const unscoped = await connect({ ...s.ctx, scopes: [] });
    expect((await unscoped.callTool({ name: 'list_resources', arguments: {} })).isError).toBe(true);
    expect(
      (
        await unscoped.callTool({
          name: 'get_resources',
          arguments: { refs: [{ orgId: s.orgId, kind: 'external_resource', id }] },
        })
      ).isError,
    ).toBe(true);
    await expect(
      unscoped.readResource({ uri: `docket://${s.orgId}/library/external_resource/${id}` }),
    ).rejects.toThrow(/work:read/);
  });

  it.each(['project', 'initiative'] as const)(
    'reads %s attachments with current subject permissions and archival',
    async (subjectType) => {
      const s = await seed();
      const subjectId = subjectType === 'project' ? s.projectId : s.initiativeId;
      const [row] = await schema.db
        .insert(schema.attachment)
        .values({
          organizationId: s.orgId,
          createdBy: s.actorId,
          subjectType,
          subjectId,
          kind: 'url',
          title: 'Shared reference',
          url: 'https://example.com/reference',
        })
        .returning();
      const id = assertDefined(row).id;
      await index('attachment', id);
      await index(subjectType, subjectId);
      const client = await connect(s.ctx);
      expect(await get(client, s.orgId, 'attachment', id)).toMatchObject({
        status: 'ok',
        resource: {
          title: 'Shared reference',
          content: { status: 'unsupported' },
          usedBy: { total: 1 },
        },
      });
      const table = subjectType === 'project' ? schema.project : schema.initiative;
      await schema.db.update(table).set({ archivedAt: new Date() }).where(eq(table.id, subjectId));
      expect((await get(client, s.orgId, 'attachment', id)).status).toBe('not_found');
    },
  );

  it('rejects oversized stored bytes despite a small declared size, and handles an absent storage key', async () => {
    const s = await seed();
    const id = await file(s);
    const [row] = await schema.db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.id, id));
    const { getContainer } = await import('../../src/container');
    await getContainer().blob.put(
      assertDefined(assertDefined(row).blobKey),
      new Uint8Array(4194305),
    );
    const client = await connect(s.ctx);
    expect(await get(client, s.orgId, 'attachment', id)).toMatchObject({
      resource: { content: { status: 'too_large' } },
    });
    await expect(
      client.readResource({ uri: `docket://${s.orgId}/library/attachment/${id}/content` }),
    ).rejects.toThrow();
    await getContainer().blob.delete(assertDefined(assertDefined(row).blobKey));
    await schema.db
      .update(schema.attachment)
      .set({ blobKey: null })
      .where(eq(schema.attachment.id, id));
    expect(await get(client, s.orgId, 'attachment', id)).toMatchObject({
      resource: { content: { status: 'unavailable' } },
    });
  });

  it('preserves the MCP product entitlement gate for tools and URI reads', async () => {
    const s = await seed();
    const id = await linked(s);
    const client = await connect(s.ctx);
    await schema.db
      .delete(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, s.orgId));
    expect((await list(client, { orgId: s.orgId })).items).toEqual([]);
    const result = await client.callTool({
      name: 'get_resources',
      arguments: { refs: [{ orgId: s.orgId, kind: 'external_resource', id }] },
    });
    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain('product_required');
    await expect(
      client.readResource({ uri: `docket://${s.orgId}/library/external_resource/${id}` }),
    ).rejects.toThrow();
  });

  it('authorizes Library subscriptions with the same scope and current visibility as reads', async () => {
    const s = await seed();
    const id = await linked(s);
    const uri = `docket://${s.orgId}/library/external_resource/${id}`;
    const { authorizeResourceUri } = await import('../../src/mcp/resources');
    await expect(authorizeResourceUri(s.ctx, uri)).resolves.toBeUndefined();
    await expect(authorizeResourceUri(s.ctx, `${uri}/content`)).rejects.toThrow();
    await schema.db
      .update(schema.actor)
      .set({ archivedAt: new Date() })
      .where(eq(schema.actor.id, s.actorId));
    await expect(authorizeResourceUri(s.ctx, uri)).rejects.toThrow();
  });
});

describe('Library deliverables', () => {
  it('discovers files attached to both comments and updates, and reads their bytes', async () => {
    const s = await seed();
    await schema.db.insert(schema.grant).values({
      organizationId: s.orgId,
      subjectKind: 'actor',
      subjectId: s.actorId,
      resourceKind: 'organization',
      resourceId: s.orgId,
      capabilities: ['view'],
      effect: 'allow',
      cascades: false,
    });
    const client = await connect(s.ctx);
    for (const kind of ['comment', 'update'] as const) {
      const [post] = await schema.db
        .insert(kind === 'comment' ? schema.comment : schema.update)
        .values({
          organizationId: s.orgId,
          createdBy: s.actorId,
          authorId: s.actorId,
          subjectType: 'project',
          subjectId: s.projectId,
          body: 'Finished work',
        })
        .returning({ id: kind === 'comment' ? schema.comment.id : schema.update.id });
      const postId = assertDefined(post).id;
      const id = await file(s);
      await schema.db
        .update(schema.attachment)
        .set({ subjectType: kind, subjectId: postId })
        .where(eq(schema.attachment.id, id));
      await index('attachment', id);
      expect((await list(client, { orgId: s.orgId })).items.map((item) => item.id)).toContain(id);
      const read = await client.readResource({ uri: `docket://${s.orgId}/${kind}/${postId}` });
      const content = assertDefined(read.contents[0]);
      expect('text' in content && JSON.parse(content.text)).toMatchObject({
        attachments: [{ id }],
      });
      expect(await get(client, s.orgId, 'attachment', id)).toMatchObject({
        status: 'ok',
        resource: { content: { status: 'available' } },
      });
    }
  });
});
