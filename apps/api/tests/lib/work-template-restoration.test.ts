import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb, one, seedTaskAccessOrg } from '../support/routes-harness';
import {
  createWorkTemplate,
  archiveWorkTemplate,
  publishWorkTemplate,
} from '../../src/lib/templates/service';
import { restoreTemplateSnapshot } from '../../src/lib/templates/persistence';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import type { TemplateRow } from '../../src/lib/templates/model';
import { prepareTemplateRestoration } from '../../src/lib/templates/restoration';

const previous = WorkTemplateDefinition.parse({
  name: 'Published preparation',
  payload: { targetType: 'project', description: 'Prior public body' },
});
const reviewed = WorkTemplateDefinition.parse({
  ...previous,
  payload: { targetType: 'project', description: 'Reviewed new body' },
  blueprint: {
    steps: [
      BlueprintStep.parse({
        key: 'new_step',
        kind: 'task',
        parentStepKey: null,
        sort: 0,
        fields: { title: 'New pending child' },
        template: null,
        teamRule: 'parent_team',
        actorRule: 'unassigned',
        cycleRule: 'none',
        dates: {},
        optional: { enabled: false, selectedByDefault: true },
      }),
    ],
    dependencies: [],
  },
});

const current: TemplateRow = {
  id: 'template',
  organizationId: 'workspace',
  targetType: 'project',
  createdBy: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  name: reviewed.name,
  description: reviewed.description,
  payload: reviewed.payload,
  scope: 'organization',
  ownerActorId: null,
  teamId: null,
  originWorkTypeId: null,
  originWorkTypeVersionId: null,
  isBase: false,
  isSeed: false,
  publicationState: 'published',
  icon: null,
  draftRevision: 4,
  draftDefinition: reviewed,
  latestPublishedVersionId: 'new-publication',
};

describe('template publication restoration', () => {
  it('restores the exact prior public blueprint while retaining its separately reviewed pending draft', () => {
    const before = {
      ...current,
      name: previous.name,
      description: previous.description,
      payload: previous.payload,
      draftDefinition: reviewed,
      latestPublishedVersionId: 'prior-publication',
    };
    const result = prepareTemplateRestoration(current, before, previous);
    expect(result?.definition).toEqual(previous);
    expect(result?.definition.blueprint.steps).toEqual([]);
    expect(result?.priorDraft).toEqual(reviewed);
    expect(result?.retainedVersionId).toBe('prior-publication');
  });
});

it('retains a current publication when its historical prior state was private', () => {
  const before = {
    ...current,
    scope: 'personal',
    ownerActorId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    publicationState: 'draft',
    latestPublishedVersionId: null,
  };
  expect(prepareTemplateRestoration(current, before)).toBeNull();
});

it('normalizes an older unpublished receipt without inventing a publication or discarding its blueprint', () => {
  const draft: TemplateRow = {
    ...current,
    publicationState: 'draft',
    latestPublishedVersionId: null,
  };
  const result = prepareTemplateRestoration(draft, {
    name: 'Prior legacy draft',
    description: null,
    scope: 'organization',
    ownerActorId: null,
    teamId: null,
    payload: previous.payload,
  });
  expect(result).toMatchObject({ changedPublication: false, retainedVersionId: null });
  expect(result?.definition).toMatchObject({
    name: 'Prior legacy draft',
    payload: previous.payload,
  });
  expect(result?.definition.blueprint).toEqual(reviewed.blueprint);
  expect(result?.priorDraft).toEqual(result?.definition);
});

it('retains the current immutable closure when restoring a first organization publication', () => {
  const result = prepareTemplateRestoration(current, {
    ...current,
    publicationState: 'draft',
    latestPublishedVersionId: null,
  });
  expect(result).toMatchObject({
    changedPublication: true,
    retainedVersionId: current.latestPublishedVersionId,
  });
  expect(result?.definition).toEqual(reviewed);
  expect(result?.priorDraft).toEqual(reviewed);
});

let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});

it('retains an unpublished creation used by actual work when its creation is undone', async () => {
  const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const caller = { orgId: f.orgId, actorId: f.humanActorId };
  const draft = await createWorkTemplate(caller, {
    targetType: 'task',
    scope: 'personal',
    offeredTeamIds: [],
    definition: WorkTemplateDefinition.parse({
      name: 'Retained task origin',
      payload: { targetType: 'task' },
    }),
  });
  const task = one(
    await schema.db
      .insert(schema.task)
      .values({
        organizationId: f.orgId,
        teamId: f.teamId,
        title: 'Existing retained work',
        templateId: draft.id,
        statusId: f.statusId('task', 'todo'),
        state: 'todo',
        createdBy: f.humanActorId,
      })
      .returning(),
  );
  expect(
    await schema.db.transaction((tx) =>
      restoreTemplateSnapshot(tx, f.orgId, draft.id, 'create', null),
    ),
  ).toBe('in_use');
  expect(
    one(await schema.db.select().from(schema.template).where(eq(schema.template.id, draft.id))),
  ).toEqual(draft);
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, task.id))),
  ).toEqual(task);
});

it('removes an unused private creation without claiming a second restoration for an absent row', async () => {
  const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const draft = await createWorkTemplate(
    { orgId: f.orgId, actorId: f.humanActorId },
    {
      targetType: 'project',
      scope: 'personal',
      offeredTeamIds: [],
      definition: previous,
    },
  );
  expect(
    await schema.db.transaction((tx) =>
      restoreTemplateSnapshot(tx, f.orgId, draft.id, 'create', null),
    ),
  ).toBe('restored');
  expect(
    await schema.db.select().from(schema.template).where(eq(schema.template.id, draft.id)),
  ).toEqual([]);
  expect(
    await schema.db.transaction((tx) =>
      restoreTemplateSnapshot(tx, f.orgId, draft.id, 'create', null),
    ),
  ).toBe('in_use');
});

it('refuses an update with no prior state and an unsupported reversal without touching the draft', async () => {
  const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const draft = await createWorkTemplate(
    { orgId: f.orgId, actorId: f.humanActorId },
    {
      targetType: 'project',
      scope: 'personal',
      offeredTeamIds: [],
      definition: previous,
    },
  );
  for (const [operation, before] of [
    ['update', null],
    ['delete', draft],
  ] as const) {
    expect(
      await schema.db.transaction((tx) =>
        restoreTemplateSnapshot(tx, f.orgId, draft.id, operation, before),
      ),
    ).toBe('no_prior_state');
    expect(
      one(await schema.db.select().from(schema.template).where(eq(schema.template.id, draft.id))),
    ).toEqual(draft);
  }
});

it.each([false, true])(
  'restores an archived template lifecycle while retaining publication history (published=%s)',
  async (published) => {
    const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
    const caller = { orgId: f.orgId, actorId: f.humanActorId };
    const draft = await createWorkTemplate(caller, {
      targetType: 'project',
      scope: 'personal',
      offeredTeamIds: [],
      definition: previous,
    });
    const before = published
      ? await publishWorkTemplate(caller, draft.id, draft.draftRevision)
      : draft;
    const versions = await schema.db
      .select()
      .from(schema.workTypeVersion)
      .where(eq(schema.workTypeVersion.workTypeId, draft.id));
    const archived = await archiveWorkTemplate(caller, draft.id);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(
      await schema.db.transaction((tx) =>
        restoreTemplateSnapshot(tx, f.orgId, draft.id, 'update', before),
      ),
    ).toBe('restored');
    const restored = one(
      await schema.db.select().from(schema.template).where(eq(schema.template.id, draft.id)),
    );
    expect(restored).toMatchObject({
      publicationState: published ? 'published' : 'draft',
      archivedAt: null,
      latestPublishedVersionId: before.latestPublishedVersionId,
      draftDefinition: before.draftDefinition,
      draftRevision: archived.draftRevision + 1,
    });
    expect(
      await schema.db
        .select()
        .from(schema.workTypeVersion)
        .where(eq(schema.workTypeVersion.workTypeId, draft.id)),
    ).toEqual(versions);
  },
);

it('refuses to unpublish immutable history when restoring its original private draft snapshot', async () => {
  const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const caller = { orgId: f.orgId, actorId: f.humanActorId };
  const draft = await createWorkTemplate(caller, {
    targetType: 'project',
    scope: 'personal',
    offeredTeamIds: [],
    definition: previous,
  });
  const published = await publishWorkTemplate(caller, draft.id, draft.draftRevision);
  const versions = await schema.db
    .select()
    .from(schema.workTypeVersion)
    .where(
      and(
        eq(schema.workTypeVersion.organizationId, f.orgId),
        eq(schema.workTypeVersion.workTypeId, draft.id),
      ),
    );
  expect(
    await schema.db.transaction((tx) =>
      restoreTemplateSnapshot(tx, f.orgId, draft.id, 'update', draft),
    ),
  ).toBe('in_use');
  expect(
    one(await schema.db.select().from(schema.template).where(eq(schema.template.id, draft.id))),
  ).toEqual(published);
  expect(
    await schema.db
      .select()
      .from(schema.workTypeVersion)
      .where(
        and(
          eq(schema.workTypeVersion.organizationId, f.orgId),
          eq(schema.workTypeVersion.workTypeId, draft.id),
        ),
      ),
  ).toEqual(versions);
});
