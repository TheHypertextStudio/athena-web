/** Actual PostgreSQL service acceptance; use an isolated migrated task-owned database. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '@docket/db';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { WorkTemplateSourceCopyPreviewRequest } from '@docket/work/template-copy';
import { templateGalleryFixture, setGalleryCapability } from '../support/template-gallery-fixtures';
import { one } from '../support/routes-harness';
import { createWorkTemplate, editWorkTemplateDraft } from '../../src/lib/templates/service';
import {
  previewTemplateSourceCopy,
  acceptTemplateSourceCopy,
} from '../../src/lib/template-gallery/source-preview';
import { reconcileTemplateGalleryCopy } from '../../src/lib/template-gallery/acceptance';
import { appProvenance, runWithProvenance } from '../../src/lib/provenance/context';

const url = process.env['WORK_TEMPLATE_SOURCE_COPY_PG_URL'] ?? '';
const client = postgres(url, { max: 2, prepare: false });
beforeAll(async () => {
  expect(process.env['DATABASE_URL']).toBe(url);
  const target = new URL(url);
  expect(target.hostname).toBe('127.0.0.1');
  expect(target.pathname).toMatch(/^\/history_oct25_source_copy$/);
  const [row] = await client<
    { version: number; database: string }[]
  >`select current_setting('server_version_num')::integer as version, current_database() as database`;
  expect(row?.version).toBeGreaterThanOrEqual(180000);
  expect(row?.database).toBe('history_oct25_source_copy');
});
afterAll(async () => {
  await schema.closeDb();
  await client.end();
});
const accept: typeof acceptTemplateSourceCopy = (principal, request) =>
  runWithProvenance(appProvenance('settings'), () => acceptTemplateSourceCopy(principal, request));
async function fixture() {
  const source = await templateGalleryFixture(schema),
    destination = await templateGalleryFixture(schema);
  await schema.db
    .update(schema.actor)
    .set({ userId: source.userId })
    .where(eq(schema.actor.id, destination.humanActorId));
  const principal = { organizationId: destination.orgId, userId: source.userId };
  const draft = await createWorkTemplate(
    source.caller,
    WorkTemplateCreate.parse({
      targetType: 'task',
      scope: 'personal',
      definition: {
        name: 'Prepare the venue',
        payload: { targetType: 'task', description: 'Confirm access and supplies.' },
      },
    }),
  );
  const choices = WorkTemplateSourceCopyPreviewRequest.parse({
    roots: [{ kind: 'draft', organizationId: source.orgId, workTypeId: draft.id }],
    mode: 'private_drafts',
  });
  const review = await previewTemplateSourceCopy(principal, choices);
  const request = {
    ...choices,
    requestId: crypto.randomUUID(),
    expectedReviewFingerprint: review.reviewFingerprint,
  };
  return { source, destination, principal, draft, choices, request };
}
describe('source-authorized copies on PostgreSQL', () => {
  it('serializes concurrent same-request acceptance into one private identity and receipt', async () => {
    const f = await fixture();
    const results = await Promise.all([
      accept(f.principal, f.request),
      accept(f.principal, f.request),
    ]);
    expect(results[0]).toEqual(results[1]);
    const receipt = one(results),
      root = one(receipt.roots);
    const definitions = await schema.db
      .select()
      .from(schema.template)
      .where(
        and(
          eq(schema.template.organizationId, f.destination.orgId),
          eq(schema.template.isBase, false),
        ),
      );
    expect(definitions).toHaveLength(1);
    expect(one(definitions)).toMatchObject({
      id: root.workTypeId,
      scope: 'personal',
      ownerActorId: f.destination.humanActorId,
      latestPublishedVersionId: null,
    });
    const bundles = await schema.db
      .select()
      .from(schema.workTemplateCopyBundle)
      .where(eq(schema.workTemplateCopyBundle.organizationId, f.destination.orgId));
    expect(bundles).toHaveLength(1);
    expect(await reconcileTemplateGalleryCopy(f.principal, f.request.requestId)).toEqual(receipt);
  });
  it('replays the committed receipt after source deletion and loss of authoring rights', async () => {
    const f = await fixture();
    const receipt = await accept(f.principal, f.request);
    await schema.db.delete(schema.template).where(eq(schema.template.id, f.draft.id));
    await setGalleryCapability(f.destination, 'view');
    expect(await accept(f.principal, f.request)).toEqual(receipt);
  });
  it('rejects stale source facts before allocating any destination definition or receipt', async () => {
    const f = await fixture();
    await editWorkTemplateDraft(f.source.caller, f.draft.id, {
      expectedRevision: f.draft.draftRevision,
      definition: { ...f.draft.draftDefinition, name: 'Changed venue instructions' },
    });
    await expect(accept(f.principal, f.request)).rejects.toMatchObject({ code: 'conflict' });
    expect(
      await schema.db
        .select()
        .from(schema.workTemplateCopyBundle)
        .where(eq(schema.workTemplateCopyBundle.organizationId, f.destination.orgId)),
    ).toEqual([]);
    expect(
      await schema.db
        .select()
        .from(schema.template)
        .where(
          and(
            eq(schema.template.organizationId, f.destination.orgId),
            eq(schema.template.isBase, false),
          ),
        ),
    ).toEqual([]);
  });
  it('rechecks source membership and hides a private definition before destination writes', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, f.source.humanActorId));
    await expect(accept(f.principal, f.request)).rejects.toMatchObject({ code: 'not_found' });
    expect(
      await schema.db
        .select()
        .from(schema.workTemplateCopyBundle)
        .where(eq(schema.workTemplateCopyBundle.organizationId, f.destination.orgId)),
    ).toEqual([]);
  });
});
