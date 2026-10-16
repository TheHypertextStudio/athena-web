/** Public Undo ownership; MCP retains its existing Pro transport gate, while gallery installation stays Free. */
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import meAthenaUndo from '../../src/routes/me-athena-undo';
import tasksRouter from '../../src/routes/tasks';
import { undoPhoneCallChange } from '../../src/routes/phone-call-summary';
import { LinkHarness, userContext } from '../mcp/mcp-link-fixtures';
import {
  appWithActor,
  fakeSession,
  getDb,
  grantDocketPro,
  one,
  seedTask,
} from '../support/routes-harness';
import { errorText } from '../mcp/mcp-catalog-harness';
import {
  galleryUndoState,
  installTemplateGallery,
  otherGalleryMember,
  setGalleryCapability,
  templateGalleryFixture,
  type TemplateGalleryFixture,
} from '../support/template-gallery-fixtures';

let schema: typeof DbModule;
let harness: LinkHarness;
beforeAll(async () => {
  schema = await getDb();
  harness = new LinkHarness((await import('../../src/mcp/tools')).registerTools);
});
afterEach(async () => {
  await harness.closeAll();
});

async function athenaSession(f: TemplateGalleryFixture) {
  return one(
    await schema.db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: f.userId,
        contextOrganizationId: f.orgId,
        kind: 'job',
        trigger: 'delegation',
        status: 'completed',
      })
      .returning(),
  );
}
function athenaApp(userId: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(userId));
    await next();
  });
  app.route('/', meAthenaUndo);
  app.onError(onError);
  return app;
}

describe('gallery copy receipt Undo through existing public doors', () => {
  it('uses actual MCP for aggregate Undo and replays terminal outcomes with current View only', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    await grantDocketPro(schema.db, schema, f.orgId);
    const client = await harness.connect(userContext(f.userId, 'gallery@example.test'));
    const arguments_ = { orgId: f.orgId, changeSetId: installed.receipt.changeSetId };
    const initial = await client.callTool({ name: 'undo', arguments: arguments_ });
    expect(initial.isError ?? false, JSON.stringify(initial)).toBe(false);
    await setGalleryCapability(f, 'view');
    const before = await galleryUndoState(f, installed);
    const replay = await client.callTool({ name: 'undo', arguments: arguments_ });
    expect(replay.isError ?? false).toBe(false);
    expect(replay.structuredContent).toEqual(initial.structuredContent);
    expect(await galleryUndoState(f, installed)).toEqual(before);
  });

  it('does not let another actual MCP manager reverse the acceptor’s private bundle', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    await grantDocketPro(schema.db, schema, f.orgId);
    const other = await otherGalleryMember(f);
    if (!other.userId) throw new Error('Missing other human user');
    const client = await harness.connect(userContext(other.userId, 'other-gallery@example.test'));
    const before = await galleryUndoState(f, installed);
    expect(
      (
        await client.callTool({
          name: 'undo',
          arguments: { orgId: f.orgId, changeSetId: installed.receipt.changeSetId },
        })
      ).isError,
    ).toBe(true);
    expect(await galleryUndoState(f, installed)).toEqual(before);
  });

  it('does not expose private receipt registration through View-only nonacceptor MCP errors', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    await grantDocketPro(schema.db, schema, f.orgId);
    const other = await otherGalleryMember(f);
    if (!other.userId) throw new Error('Missing other human user');
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['view'] })
      .where(and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectId, other.id)));
    const client = await harness.connect(userContext(other.userId, 'view-only@example.test'));
    const before = await galleryUndoState(f, installed);
    const privateReceipt = await client.callTool({
      name: 'undo',
      arguments: { orgId: f.orgId, changeSetId: installed.receipt.changeSetId },
    });
    const missingReceipt = await client.callTool({
      name: 'undo',
      arguments: { orgId: f.orgId, changeSetId: schema.genId() },
    });
    expect(privateReceipt.isError).toBe(true);
    expect(missingReceipt.isError).toBe(true);
    expect(errorText(missingReceipt)).toMatch(/^forbidden:/);
    expect(errorText(privateReceipt)).toBe(errorText(missingReceipt));
    expect(await galleryUndoState(f, installed)).toEqual(before);
  });

  it('dispatches a genuinely owned Athena-session receipt and permits its terminal View replay', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    const session = await athenaSession(f);
    await schema.db
      .update(schema.changeSet)
      .set({ origin: { tool: 'work_template_gallery_copy', sessionId: session.id } })
      .where(eq(schema.changeSet.id, installed.receipt.changeSetId));
    const app = athenaApp(f.userId),
      path = `/${installed.receipt.changeSetId}/undo`;
    expect((await app.request(path, { method: 'POST' })).status).toBe(200);
    await setGalleryCapability(f, 'view');
    const before = await galleryUndoState(f, installed);
    expect((await app.request(path, { method: 'POST' })).status).toBe(200);
    expect(await galleryUndoState(f, installed)).toEqual(before);
  });

  it('keeps the Athena session ownership boundary even for another current manager', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    const session = await athenaSession(f),
      other = await otherGalleryMember(f);
    if (!other.userId) throw new Error('Missing other human user');
    await schema.db
      .update(schema.changeSet)
      .set({ origin: { tool: 'work_template_gallery_copy', sessionId: session.id } })
      .where(eq(schema.changeSet.id, installed.receipt.changeSetId));
    const before = await galleryUndoState(f, installed);
    expect(
      (
        await athenaApp(other.userId).request(`/${installed.receipt.changeSetId}/undo`, {
          method: 'POST',
        })
      ).status,
    ).toBe(404);
    expect(await galleryUndoState(f, installed)).toEqual(before);
  });

  it('does not turn an owned phone call into authority for an unrelated gallery-only receipt', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    const conversation = await athenaSession(f);
    const phone = one(
      await schema.db
        .insert(schema.voiceSession)
        .values({
          conversationId: conversation.id,
          userId: f.userId,
          organizationId: f.orgId,
          channel: 'phone',
          callSid: `CA_${conversation.id}`,
          provider: 'twilio-relay',
        })
        .returning(),
    );
    await schema.db
      .update(schema.changeSet)
      .set({ origin: { tool: 'work_template_gallery_copy', sessionId: phone.id } })
      .where(eq(schema.changeSet.id, installed.receipt.changeSetId));
    const before = await galleryUndoState(f, installed);
    await expect(
      undoPhoneCallChange(f.userId, phone.id, installed.receipt.changeSetId),
    ).rejects.toMatchObject({ status: 404 });
    expect(await galleryUndoState(f, installed)).toEqual(before);
  });

  it('does not accept a gallery receipt as an owned task expansion token without the task subject', async () => {
    const f = await templateGalleryFixture(schema),
      installed = await installTemplateGallery(f);
    await grantDocketPro(schema.db, schema, f.orgId);
    const task = await seedTask(schema.db, schema, f.statusId, {
      organizationId: f.orgId,
      teamId: f.teamId,
      title: 'Unrelated task',
      state: 'todo',
      createdBy: f.humanActorId,
    });
    const before = await galleryUndoState(f, installed);
    const response = await appWithActor(tasksRouter, f.orgId, ['manage'], f.humanActorId).request(
      `/${task.id}/expand/undo`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ undoToken: installed.receipt.changeSetId }),
      },
    );
    expect(response.status).toBe(404);
    expect(await galleryUndoState(f, installed)).toEqual(before);
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, task.id))),
    ).toEqual(task);
  });
});
