import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import {
  WorkTemplateArchiveImpact,
  WorkTemplateDefinition,
} from '@docket/work/work-template-contract';
import { ProcessDefinitionCreate, SeriesEdit } from '../../src/contracts/recurrence';
import { appendPublishedProcessRevision } from '../../src/lib/recurrence/process-definition';
import { editRecurrenceSeries } from '../../src/lib/recurrence/series';
import {
  createWorkTemplate,
  publishWorkTemplate,
  editWorkTemplateDraft,
} from '../../src/lib/templates/service';
import definitions from '../../src/routes/work-template-definitions';
import { retainedFixture } from '../recurrence/work-template-adapter-fixture';
import { appWithActor, getDb, one } from '../support/routes-harness';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
type Fixture = Awaited<ReturnType<typeof retainedFixture>>;
type Publication = Awaited<ReturnType<typeof publishWorkTemplate>>;
function app(f: Fixture, actorId = f.humanActorId, capabilities = ['manage']) {
  return appWithActor(definitions, f.orgId, capabilities, actorId);
}
async function impact(f: Fixture, id = f.published.id, caller = app(f), query = '') {
  const response = await caller.request(`/${id}/archive-impact${query}`);
  expect(response.status).toBe(200);
  return WorkTemplateArchiveImpact.parse(await response.json());
}
async function publication(
  f: Fixture,
  kind: 'task' | 'project' | 'program',
  name: string,
  child?: Publication,
  selection: 'pinned' | 'latest' = 'pinned',
) {
  const step = child
    ? {
        key: 'child',
        kind: child.targetType,
        parentStepKey: null,
        sort: 0,
        optional: { enabled: false, selectedByDefault: true },
        template: {
          workTypeId: child.id,
          selection:
            selection === 'pinned'
              ? { kind: 'pinned', workTypeVersionId: child.latestPublishedVersionId }
              : { kind: 'latest' },
        },
        teamRule: 'creation_team',
        actorRule: 'creator',
        fields: child.targetType === 'task' ? { title: 'Child' } : { name: 'Child' },
        dates: {},
        ...(child.targetType === 'task' ? { cycleRule: 'none' } : {}),
      }
    : null;
  const draft = await createWorkTemplate(f.caller, {
    targetType: kind,
    scope: 'personal',
    offeredTeamIds: [],
    definition: WorkTemplateDefinition.parse({
      name,
      payload: { targetType: kind, ...(kind === 'task' ? { title: name } : {}) },
      blueprint: { steps: step ? [step] : [], dependencies: [] },
    }),
  });
  return publishWorkTemplate(f.caller, draft.id, draft.draftRevision);
}
async function contributor(f: Fixture) {
  const actor = one(
    await schema.db
      .insert(schema.actor)
      .values({ organizationId: f.orgId, kind: 'human', displayName: 'Contributor' })
      .returning(),
  );
  const grant = one(
    await schema.db
      .insert(schema.grant)
      .values({
        organizationId: f.orgId,
        subjectKind: 'actor',
        subjectId: actor.id,
        resourceKind: 'organization',
        resourceId: f.orgId,
        capabilities: ['contribute'],
        effect: 'allow',
        cascades: true,
      })
      .returning(),
  );
  return { actor, grant };
}
describe('authorized bounded archive impact', () => {
  it('includes direct and transitive current published parents, with independent bounded pages', async () => {
    const f = await retainedFixture(schema),
      parent = await publication(f, 'project', 'Dinner', f.published);
    await publication(f, 'program', 'Events', parent);
    const first = await impact(f, f.published.id, app(f), '?limit=1');
    expect(first.parents.total).toBe(2);
    expect(first.parents.items).toHaveLength(1);
    expect(first.parents.nextOffset).toBe(1);
    expect(first.schedules.total).toBe(1);
    const second = await impact(f, f.published.id, app(f), '?limit=1&parentOffset=1');
    expect(second.parents.nextOffset).toBeNull();
    expect(
      new Set([...first.parents.items, ...second.parents.items].map((item) => item.name)),
    ).toEqual(new Set(['Dinner', 'Events']));
    expect(first.schedules.items).toEqual(second.schedules.items);
  });
  it('follows pinned historical intermediate versions while latest references follow their current publication', async () => {
    const f = await retainedFixture(schema),
      parent = await publication(f, 'project', 'Parent', f.published);
    const pinned = await publication(f, 'program', 'Pinned parent', parent),
      latest = await publication(f, 'program', 'Latest parent', parent, 'latest');
    const draft = await editWorkTemplateDraft(f.caller, parent.id, {
      expectedRevision: parent.draftRevision,
      definition: WorkTemplateDefinition.parse({
        name: 'Parent v2',
        payload: { targetType: 'project' },
      }),
    });
    await publishWorkTemplate(f.caller, parent.id, draft.draftRevision);
    const result = await impact(f);
    expect(result.parents.items.map((item) => item.id)).toEqual([pinned.id]);
    expect(result.parents.items.some((item) => item.id === latest.id)).toBe(false);
  });
  it('returns published parent names without exposing private next-draft names or bodies', async () => {
    const f = await retainedFixture(schema),
      parent = await publication(f, 'project', 'Published dinner', f.published);
    await editWorkTemplateDraft(f.caller, parent.id, {
      expectedRevision: parent.draftRevision,
      definition: WorkTemplateDefinition.parse({
        ...parent.draftDefinition,
        name: 'SECRET next title',
        payload: { targetType: 'project', description: 'SECRET instructions' },
      }),
    });
    const result = await impact(f);
    expect(result.parents.items).toEqual([{ id: parent.id, name: 'Published dinner' }]);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('does not reveal another creator schedule name or count, even with stale claimed administrator capabilities', async () => {
    const f = await retainedFixture(schema),
      other = await contributor(f);
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ name: 'Private financial report' })
      .where(eq(schema.recurrenceSeries.id, f.series.id));
    const reader = app(f, other.actor.id, ['manage']);
    expect((await impact(f, f.published.id, reader)).schedules).toEqual({
      items: [],
      total: 0,
      nextOffset: null,
    });
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['manage'] })
      .where(eq(schema.grant.id, other.grant.id));
    expect((await impact(f, f.published.id, reader)).schedules.items).toEqual([
      { id: f.series.id, name: 'Private financial report' },
    ]);
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['contribute'] })
      .where(eq(schema.grant.id, other.grant.id));
    expect((await impact(f, f.published.id, reader)).schedules.total).toBe(0);
  });
  it('allows the exact contributor creator and excludes paused, ended and archived schedules', async () => {
    const f = await retainedFixture(schema),
      other = await contributor(f);
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ createdBy: other.actor.id })
      .where(eq(schema.recurrenceSeries.id, f.series.id));
    const reader = app(f, other.actor.id, ['contribute']);
    expect((await impact(f, f.published.id, reader)).schedules.total).toBe(1);
    for (const lifecycle of [
      { status: 'paused' as const, pausedAt: new Date(), endedAt: null, archivedAt: null },
      { status: 'ended' as const, pausedAt: null, endedAt: new Date(), archivedAt: null },
      { status: 'active' as const, pausedAt: null, endedAt: null, archivedAt: new Date() },
    ]) {
      await schema.db
        .update(schema.recurrenceSeries)
        .set(lifecycle)
        .where(eq(schema.recurrenceSeries.id, f.series.id));
      expect((await impact(f, f.published.id, reader)).schedules.total).toBe(0);
    }
  });
  it('counts only the latest immutable schedule revision, preserving historical bindings without claiming current use', async () => {
    const f = await retainedFixture(schema),
      other = await publication(f, 'task', 'Different task');
    await appendPublishedProcessRevision(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      definitionId: f.definition.id,
      revision: ProcessDefinitionCreate.parse({
        name: 'Reports',
        tasks: [
          {
            key: 'report',
            title: 'New report',
            teamId: f.teamId,
            workTypeId: other.id,
            workTypeVersionId: other.latestPublishedVersionId,
          },
        ],
      }),
    });
    await editRecurrenceSeries(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      seriesId: f.series.id,
      asOf: '2026-10-14',
      edit: SeriesEdit.parse({
        scope: 'future',
        effectiveFrom: '2026-11-01',
        trigger: { kind: 'manual' },
      }),
    });
    expect((await impact(f)).schedules.total).toBe(0);
    expect((await impact(f, other.id)).schedules.total).toBe(1);
  });
  it('refuses foreign/private definitions, suspended actors, and oversized pages', async () => {
    const f = await retainedFixture(schema),
      foreign = await retainedFixture(schema),
      other = await contributor(f);
    expect((await app(f).request(`/${foreign.published.id}/archive-impact`)).status).toBe(404);
    const draft = await createWorkTemplate(f.caller, {
      targetType: 'task',
      scope: 'personal',
      offeredTeamIds: [],
      definition: WorkTemplateDefinition.parse({
        name: 'Private',
        payload: { targetType: 'task', title: 'Private' },
      }),
    });
    expect(
      (await app(f, other.actor.id, ['contribute']).request(`/${draft.id}/archive-impact`)).status,
    ).toBe(404);
    expect((await app(f).request(`/${f.published.id}/archive-impact?limit=51`)).status).toBe(422);
    await schema.db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, f.humanActorId));
    expect(
      (await app(f).request(`/${f.published.id}/archive-impact`)).status,
    ).toBeGreaterThanOrEqual(400);
  });
});
