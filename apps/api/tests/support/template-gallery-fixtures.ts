/** Canonical gallery installations shared by actual copy Undo regressions. */
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { WorkTemplateGalleryPreviewRequest } from '@docket/work/template-gallery-contract';
import { clearDocketPro, one, seedTaskAccessOrg, seedUserWithHub } from './routes-harness';
import { previewTemplateGalleryCopy } from '../../src/lib/template-gallery/preview';
import { acceptTemplateGalleryCopy } from '../../src/lib/template-gallery/acceptance';
import { appProvenance, runWithProvenance } from '../../src/lib/provenance/context';

/** Seed actual active human membership and persisted Manage on a Free workspace. */
export async function templateGalleryFixture(schema: typeof DbModule) {
  const workspace = await seedTaskAccessOrg(schema.db, schema, 'manage');
  await clearDocketPro(schema.db, schema, workspace.orgId);
  const userId = await seedUserWithHub(schema.db, schema, 'Gallery author');
  await schema.db
    .update(schema.actor)
    .set({ userId })
    .where(eq(schema.actor.id, workspace.humanActorId));
  return {
    ...workspace,
    schema,
    userId,
    principal: { organizationId: workspace.orgId, userId },
    caller: { orgId: workspace.orgId, actorId: workspace.humanActorId },
  };
}
/** A real workspace/principal used to install and edit canonical copies. */
export type TemplateGalleryFixture = Awaited<ReturnType<typeof templateGalleryFixture>>;

/** Preview then accept through the real canonical service; every call allocates a separate bundle. */
export async function installTemplateGallery(
  f: TemplateGalleryFixture,
  mode: 'private_drafts' | 'published' = 'private_drafts',
) {
  const request: WorkTemplateGalleryPreviewRequest = {
    roots: ['event'],
    release: 1,
    mode,
    labels: [],
    offerings: [],
  };
  const preview = await previewTemplateGalleryCopy(f.caller, request);
  const receipt = await runWithProvenance(appProvenance('settings'), () =>
    acceptTemplateGalleryCopy(f.principal, {
      ...request,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: preview.reviewFingerprint,
    }),
  );
  const entries = await galleryCopyEntries(f, receipt.bundleId);
  const root = one(entries.filter((entry) => entry.targetType === 'project'));
  const vendor = one(entries.filter((entry) => entry.targetType === 'task'));
  return { receipt, entries, root, vendor };
}

/** Read exact persisted copy members, without substituting current template identities. */
export async function galleryCopyEntries(f: TemplateGalleryFixture, bundleId: string) {
  const { schema } = f;
  return schema.db
    .select()
    .from(schema.workTemplateCopyEntry)
    .where(
      and(
        eq(schema.workTemplateCopyEntry.organizationId, f.orgId),
        eq(schema.workTemplateCopyEntry.bundleId, bundleId),
      ),
    );
}

/** Read the complete original aggregate receipt and bundle for rollback/terminal assertions. */
export async function galleryUndoState(
  f: TemplateGalleryFixture,
  installed: Awaited<ReturnType<typeof installTemplateGallery>>,
) {
  const { schema } = f;
  return {
    bundle: one(
      await schema.db
        .select()
        .from(schema.workTemplateCopyBundle)
        .where(eq(schema.workTemplateCopyBundle.id, installed.receipt.bundleId)),
    ),
    receipt: one(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.id, installed.receipt.changeSetId)),
    ),
    entries: await galleryCopyEntries(f, installed.receipt.bundleId),
    templates: await schema.db
      .select()
      .from(schema.template)
      .where(and(eq(schema.template.organizationId, f.orgId), eq(schema.template.isBase, false))),
  };
}

/** Change actual org grants; no test-only capability object overrides production authorization. */
export async function setGalleryCapability(
  f: TemplateGalleryFixture,
  capability: 'view' | 'manage',
) {
  const { schema } = f;
  await schema.db
    .update(schema.grant)
    .set({ capabilities: [capability] })
    .where(
      and(
        eq(schema.grant.organizationId, f.orgId),
        eq(schema.grant.subjectId, f.humanActorId),
        eq(schema.grant.resourceKind, 'organization'),
      ),
    );
}

/** Seed a separate active principal with actual Manage in the same organization. */
export async function otherGalleryMember(
  f: TemplateGalleryFixture,
  kind: 'human' | 'agent' = 'human',
) {
  const { schema } = f;
  const userId =
    kind === 'human' ? await seedUserWithHub(schema.db, schema, 'Other gallery member') : null;
  const member = one(
    await schema.db
      .insert(schema.actor)
      .values({ organizationId: f.orgId, kind, userId, displayName: 'Other member' })
      .returning(),
  );
  await schema.db.insert(schema.grant).values({
    organizationId: f.orgId,
    subjectKind: 'actor',
    subjectId: member.id,
    resourceKind: 'organization',
    resourceId: f.orgId,
    capabilities: ['manage'],
    effect: 'allow',
    cascades: true,
  });
  return member;
}
