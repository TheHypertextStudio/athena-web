import type * as DbModule from '@docket/db';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { WorkTemplateCopyReceipt } from '@docket/work/template-gallery-contract';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/context';
import definitions from '../../src/routes/work-template-definitions';
import {
  createWorkTemplate,
  editWorkTemplateDraft,
  publishWorkTemplate,
} from '../../src/lib/templates/service';
import { appWithActor, fakeSession, getDb, one } from '../support/routes-harness';
import {
  installTemplateGallery,
  otherGalleryMember,
  templateGalleryFixture,
} from '../support/template-gallery-fixtures';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
const routes = new Hono<AppEnv>().route('/v1/orgs/:orgId/templates/definitions', definitions);
const headers = { 'content-type': 'application/json' };
async function fixture() {
  const source = await templateGalleryFixture(schema),
    destination = await templateGalleryFixture(schema);
  await schema.db
    .update(schema.actor)
    .set({ userId: source.userId })
    .where(eq(schema.actor.id, destination.humanActorId));
  const draft = await createWorkTemplate(
    source.caller,
    WorkTemplateCreate.parse({
      targetType: 'task',
      scope: 'personal',
      ownerActorId: source.humanActorId,
      definition: {
        name: 'Prepare the venue',
        payload: { targetType: 'task', description: 'Confirm access and supplies.' },
      },
    }),
  );
  const client = appWithActor(
    routes,
    destination.orgId,
    ['manage'],
    destination.humanActorId,
    fakeSession(source.userId),
  );
  const url = `/v1/orgs/${destination.orgId}/templates/definitions/copies`;
  const post = (path: string, body: unknown) =>
    client.request(url + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { source, destination, draft, post };
}

describe('source-authorized independent copies', () => {
  it('copies a real private source on Free, then reconciles without rereading a removed source', async () => {
    const f = await fixture();
    const choices = {
      roots: [{ kind: 'draft', organizationId: f.source.orgId, workTypeId: f.draft.id }],
      mode: 'private_drafts',
    };
    const preview = await f.post('/preview', choices);
    expect(preview.status).toBe(200);
    const review = (await preview.json()) as {
      reviewFingerprint: string;
      copies: { name: string }[];
    };
    expect(review.copies.map((copy) => copy.name)).toEqual(['Prepare the venue']);
    const request = {
      ...choices,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: review.reviewFingerprint,
    };
    const saved = await f.post('', request);
    expect(saved.status).toBe(200);
    const receipt = WorkTemplateCopyReceipt.parse(await saved.json());
    const [copy] = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, one(receipt.roots).workTypeId));
    expect(copy).toMatchObject({
      organizationId: f.destination.orgId,
      ownerActorId: f.destination.humanActorId,
      scope: 'personal',
      latestPublishedVersionId: null,
    });
    expect(copy?.draftDefinition.name).toBe('Prepare the venue');
    await schema.db.delete(schema.template).where(eq(schema.template.id, f.draft.id));
    const repeated = await f.post('', request);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(receipt);
  });
  it('keeps two exact historical publications of one source as separate independent drafts', async () => {
    const f = await fixture();
    const first = await publishWorkTemplate(f.source.caller, f.draft.id, f.draft.draftRevision);
    if (!first.latestPublishedVersionId) throw new Error('Missing first publication');
    const edited = await editWorkTemplateDraft(f.source.caller, f.draft.id, {
      expectedRevision: first.draftRevision,
      definition: { ...first.draftDefinition, name: 'Prepare the larger venue' },
    });
    const second = await publishWorkTemplate(f.source.caller, f.draft.id, edited.draftRevision);
    const choices = {
      roots: [first.latestPublishedVersionId, second.latestPublishedVersionId].map(
        (workTypeVersionId) => ({
          kind: 'publication',
          organizationId: f.source.orgId,
          workTypeId: f.draft.id,
          selection: { kind: 'pinned', workTypeVersionId },
        }),
      ),
      mode: 'private_drafts',
    };
    const preview = await f.post('/preview', choices);
    expect(preview.status).toBe(200);
    const review = (await preview.json()) as {
      reviewFingerprint: string;
      copies: { name: string }[];
    };
    expect(review.copies.map((copy) => copy.name)).toEqual([
      'Prepare the venue',
      'Prepare the larger venue',
    ]);
    const saved = await f.post('', {
      ...choices,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: review.reviewFingerprint,
    });
    expect(saved.status).toBe(200);
    const receipt = WorkTemplateCopyReceipt.parse(await saved.json());
    expect(new Set(receipt.roots.map((root) => root.workTypeId)).size).toBe(2);
  });
  it('withholds another member’s private body and rejects caller-supplied user authority', async () => {
    const f = await fixture();
    const owner = await otherGalleryMember(f.source);
    await schema.db
      .update(schema.template)
      .set({ ownerActorId: owner.id })
      .where(eq(schema.template.id, f.draft.id));
    const choices = {
      roots: [{ kind: 'draft', organizationId: f.source.orgId, workTypeId: f.draft.id }],
      mode: 'private_drafts',
    };
    const denied = await f.post('/preview', choices);
    expect(denied.status).toBe(404);
    expect(JSON.stringify(await denied.json())).not.toContain('Confirm access and supplies');
    expect((await f.post('/preview', { ...choices, userId: owner.userId })).status).toBe(422);
  });
  it('rejects changed source facts before creating a reservation or a destination draft', async () => {
    const f = await fixture();
    const choices = {
      roots: [{ kind: 'draft', organizationId: f.source.orgId, workTypeId: f.draft.id }],
      mode: 'private_drafts',
    };
    const review = (await (await f.post('/preview', choices)).json()) as {
      reviewFingerprint: string;
    };
    await editWorkTemplateDraft(f.source.caller, f.draft.id, {
      expectedRevision: f.draft.draftRevision,
      definition: { ...f.draft.draftDefinition, name: 'Changed venue preparation' },
    });
    const response = await f.post('', {
      ...choices,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: review.reviewFingerprint,
    });
    expect(response.status).toBe(409);
    expect(
      await schema.db
        .select()
        .from(schema.workTemplateCopyBundle)
        .where(eq(schema.workTemplateCopyBundle.organizationId, f.destination.orgId)),
    ).toEqual([]);
  });
  it('copies an authorized unpublished bundle without pretending its reserved child pin is a publication', async () => {
    const f = await fixture();
    const installed = await installTemplateGallery(f.source);
    const choices = {
      roots: [
        {
          kind: 'draft',
          organizationId: f.source.orgId,
          workTypeId: installed.root.destinationWorkTypeId,
        },
      ],
      mode: 'private_drafts',
    };
    const preview = await f.post('/preview', choices);
    expect(preview.status).toBe(200);
    const review = (await preview.json()) as {
      reviewFingerprint: string;
      copies: { source: { kind: string } }[];
    };
    expect(review.copies).toHaveLength(2);
    expect(review.copies.every((copy) => copy.source.kind === 'draft')).toBe(true);
    const response = await f.post('', {
      ...choices,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: review.reviewFingerprint,
    });
    expect(response.status).toBe(200);
    const receipt = WorkTemplateCopyReceipt.parse(await response.json());
    const entries = await schema.db
      .select()
      .from(schema.workTemplateCopyEntry)
      .where(eq(schema.workTemplateCopyEntry.bundleId, receipt.bundleId));
    expect(entries).toHaveLength(2);
    expect(
      entries.every(
        (entry) => entry.reservationState === 'pending' && entry.consumedVersionId === null,
      ),
    ).toBe(true);
  });
});
