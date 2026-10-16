import type * as DbModule from '@docket/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  WorkTemplateCopyBundle,
  WorkTemplateCopyReceipt,
  WorkTemplateCopyUndoResult,
} from '@docket/work/template-gallery-contract';
import type { AppEnv } from '../../src/context';
import definitions from '../../src/routes/work-template-definitions';
import { previewTemplateGalleryCopy } from '../../src/lib/template-gallery/preview';
import { appWithActor, fakeSession, getDb } from '../support/routes-harness';
import {
  otherGalleryMember,
  setGalleryCapability,
  templateGalleryFixture,
  type TemplateGalleryFixture,
} from '../support/template-gallery-fixtures';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
const headers = { 'content-type': 'application/json' };
const nested = new Hono<AppEnv>().route('/v1/orgs/:orgId/templates/definitions', definitions);
function copyUrl(f: TemplateGalleryFixture, path = ''): string {
  return `/v1/orgs/${f.orgId}/templates/definitions/gallery/copies${path}`;
}
function app(f: TemplateGalleryFixture, capabilities = ['manage']) {
  return appWithActor(nested, f.orgId, capabilities, f.humanActorId, fakeSession(f.userId));
}
async function request(f: TemplateGalleryFixture) {
  const choices = {
    roots: ['event'],
    release: 1 as const,
    mode: 'private_drafts' as const,
    labels: [],
    offerings: [],
  };
  const review = await previewTemplateGalleryCopy(f.caller, choices);
  return {
    ...choices,
    requestId: crypto.randomUUID(),
    expectedReviewFingerprint: review.reviewFingerprint,
  };
}

describe('actual manual gallery copy routes on Free', () => {
  it('keeps, reopens, undoes and reconciles the same canonical private bundle', async () => {
    const f = await templateGalleryFixture(schema),
      body = await request(f),
      client = app(f);
    const saved = await client.request(copyUrl(f), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(saved.status).toBe(200);
    const receipt = WorkTemplateCopyReceipt.parse(await saved.json());
    expect(receipt.state).toBe('installed');
    expect(receipt.roots[0]?.workTypeVersionId).toBeNull();
    const reopened = await client.request(copyUrl(f, `/${receipt.bundleId}`));
    expect(reopened.status).toBe(200);
    const bundle = WorkTemplateCopyBundle.parse(await reopened.json());
    expect(bundle.entries).toHaveLength(2);
    expect(
      bundle.entries.every(
        (entry) =>
          entry.template?.pendingPublication?.reservedFirstVersionId ===
          entry.reservation.reservedFirstPublicationId,
      ),
    ).toBe(true);
    const reversed = await client.request(copyUrl(f, `/${receipt.bundleId}/undo`), {
      method: 'POST',
    });
    expect(reversed.status).toBe(200);
    const undone = WorkTemplateCopyUndoResult.parse(await reversed.json());
    expect(undone).toEqual({ receipt: { ...receipt, state: 'undone' }, retained: [] });
    await setGalleryCapability(f, 'view');
    const viewer = app(f, ['view']);
    const repeated = await viewer.request(copyUrl(f), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(undone.receipt);
    expect(
      (await viewer.request(copyUrl(f, `/${receipt.bundleId}/undo`), { method: 'POST' })).status,
    ).toBe(200);
    const status = await viewer.request(copyUrl(f, `/requests/${body.requestId}`));
    expect(status.status).toBe(200);
    expect(WorkTemplateCopyReceipt.parse(await status.json())).toEqual(undone.receipt);
    expect(
      (
        await viewer.request(copyUrl(f), {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...body, requestId: crypto.randomUUID() }),
        })
      ).status,
    ).toBe(403);
  });
  it('keeps private bundle metadata and reversal unavailable to another workspace manager', async () => {
    const f = await templateGalleryFixture(schema),
      body = await request(f),
      owner = app(f);
    const receipt = WorkTemplateCopyReceipt.parse(
      await (
        await owner.request(copyUrl(f), {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      ).json(),
    );
    const other = await otherGalleryMember(f);
    if (!other.userId) throw new Error('Missing other principal');
    const unrelated = appWithActor(
      nested,
      f.orgId,
      ['manage'],
      other.id,
      fakeSession(other.userId),
    );
    expect((await unrelated.request(copyUrl(f, `/${receipt.bundleId}`))).status).toBe(404);
    expect((await unrelated.request(copyUrl(f, `/requests/${body.requestId}`))).status).toBe(404);
    expect(
      (await unrelated.request(copyUrl(f, `/${receipt.bundleId}/undo`), { method: 'POST' })).status,
    ).toBe(404);
    expect((await owner.request(copyUrl(f, `/${receipt.bundleId}`))).status).toBe(200);
  });
  it('requires a real authenticated user and refuses JSON authority or destination identity', async () => {
    const f = await templateGalleryFixture(schema),
      body = await request(f);
    expect(
      (
        await appWithActor(nested, f.orgId, ['manage'], f.humanActorId).request(copyUrl(f), {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(401);
    for (const injection of [
      { actorId: f.humanActorId },
      { reservedFirstPublicationId: schema.genId() },
    ]) {
      expect(
        (
          await app(f).request(copyUrl(f), {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...body, ...injection }),
          })
        ).status,
      ).toBe(422);
    }
    expect((await app(f).request(copyUrl(f, '/invented/undo'), { method: 'POST' })).status).toBe(
      422,
    );
    expect((await app(f).request(copyUrl(f, '/requests/not-a-uuid'))).status).toBe(422);
  });
});
