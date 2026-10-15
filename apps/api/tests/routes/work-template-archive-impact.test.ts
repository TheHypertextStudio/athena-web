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
import { createWorkSchedule } from '../../src/lib/recurrence/schedule-authoring';
import {
  publication,
  republish,
  replaceChild,
} from '../support/work-template-archive-impact-fixture';
import { executeScheduleOccurrence } from '../../src/lib/recurrence/schedule-runtime';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import {
  createWorkTemplate,
  publishWorkTemplate,
  editWorkTemplateDraft,
  archiveWorkTemplate,
} from '../../src/lib/templates/service';
import definitions from '../../src/routes/work-template-definitions';
import { retainedFixture } from '../recurrence/work-template-adapter-fixture';
import { appWithActor, getDb, one, seedProgram } from '../support/routes-harness';
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
async function nativeSchedule(f: Fixture) {
  const program = await seedProgram(schema.db, schema, f.statusId, {
    organizationId: f.orgId,
    createdBy: f.humanActorId,
    name: 'Private operations',
    visibility: 'private',
  });
  const saved = await createWorkSchedule(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    ownerProgramId: program.id,
    name: 'Private routine',
    effectiveFrom: '2026-10-15',
    trigger: { kind: 'manual' },
    document: WorkScheduleDraft.parse({
      kind: 'schedule',
      revision: 1,
      template: { targetType: 'task', workTypeId: f.published.id, selection: { kind: 'latest' } },
      titlePattern: '{month} Report',
      timezone: 'UTC',
      root: { kind: 'task', fields: {}, dates: {}, placement: {}, teamId: f.teamId },
      stepOverrides: [],
      optionalChoices: [],
    }),
  });
  return { program, series: saved.series };
}
async function nativeProject(
  f: Fixture,
  parent: Publication,
  optionalChoices: { path: string[]; selected: boolean }[] = [],
) {
  return createWorkSchedule(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    name: 'Native project routine',
    effectiveFrom: '2026-10-15',
    trigger: { kind: 'manual' },
    document: WorkScheduleDraft.parse({
      kind: 'schedule',
      revision: 1,
      template: { targetType: 'project', workTypeId: parent.id, selection: { kind: 'latest' } },
      titlePattern: '{month} Routine',
      timezone: 'UTC',
      root: { kind: 'project', fields: {}, dates: {}, placement: {}, teamId: f.teamId },
      stepOverrides: [],
      optionalChoices,
    }),
  });
}
describe('authorized bounded archive impact', () => {
  it('uses a live latest root instead of its stale authoring fallback', async () => {
    const f = await retainedFixture(schema),
      parent = await publication(f, 'project', 'Latest project', f.published);
    await nativeProject(f, parent);
    expect((await impact(f)).schedules.total).toBe(2);
    await republish(
      f,
      parent,
      WorkTemplateDefinition.parse({
        name: 'Latest project v2',
        payload: { targetType: 'project' },
      }),
    );
    expect((await impact(f)).schedules.items).toEqual([{ id: f.series.id, name: f.series.name }]);
  });
  it('excludes deselected optional descendants from native schedule impact', async () => {
    const f = await retainedFixture(schema),
      parent = await publication(f, 'project', 'Optional report', f.published);
    const optional = await republish(
      f,
      parent,
      WorkTemplateDefinition.parse({
        ...parent.draftDefinition,
        blueprint: {
          ...parent.draftDefinition.blueprint,
          steps: parent.draftDefinition.blueprint.steps.map((step) => ({
            ...step,
            optional: { enabled: true, selectedByDefault: true },
          })),
        },
      }),
    );
    await nativeProject(f, optional, [{ path: ['child'], selected: false }]);
    expect((await impact(f)).schedules.total).toBe(1);
  });
  it('keeps a guarded authoring closure only when an archived root has no accepted run', async () => {
    const f = await retainedFixture(schema),
      parent = await publication(f, 'project', 'Archived project', f.published);
    const native = await nativeProject(f, parent);
    await archiveWorkTemplate(f.caller, parent.id);
    expect((await impact(f)).schedules.items).toContainEqual({
      id: native.series.id,
      name: native.series.name,
    });
  });
  it('uses the newest accepted same-revision full closure for an archived root', async () => {
    const f = await retainedFixture(schema),
      parent = await publication(f, 'project', 'Retained project', f.published);
    const second = await publication(f, 'task', 'Second report'),
      third = await publication(f, 'task', 'Third report');
    const native = await nativeProject(f, parent);
    const v2 = await republish(f, parent, replaceChild(parent, second));
    const run = {
      organizationId: f.orgId,
      seriesId: native.series.id,
      seriesRevisionId: native.revision.id,
    };
    expect(
      (await executeScheduleOccurrence(schema.db, { ...run, scheduledFor: '2026-10-16' })).status,
    ).toBe('materialized');
    const v3 = await republish(f, v2, replaceChild(v2, third));
    expect(
      (await executeScheduleOccurrence(schema.db, { ...run, scheduledFor: '2026-10-17' })).status,
    ).toBe('materialized');
    await archiveWorkTemplate(f.caller, v3.id);
    expect((await impact(f)).schedules.total).toBe(1);
    expect((await impact(f, second.id)).schedules.total).toBe(0);
    expect((await impact(f, third.id)).schedules.items).toEqual([
      { id: native.series.id, name: native.series.name },
    ]);
  });
  it('includes canonical native selections without consulting process tables or historical runs', async () => {
    const f = await retainedFixture(schema);
    const native = await nativeSchedule(f);
    const result = await impact(f);
    expect(result.schedules.items).toContainEqual({
      id: native.series.id,
      name: 'Private routine',
    });
    expect(result.schedules.total).toBe(2);
  });
  it('counts scoped-manager schedules only while the actual owning Program remains visible', async () => {
    const f = await retainedFixture(schema),
      other = await contributor(f);
    const native = await nativeSchedule(f);
    const scope = one(
      await schema.db
        .insert(schema.grant)
        .values({
          organizationId: f.orgId,
          subjectKind: 'actor',
          subjectId: other.actor.id,
          resourceKind: 'program',
          resourceId: native.program.id,
          capabilities: ['manage'],
          effect: 'allow',
          cascades: true,
        })
        .returning(),
    );
    const reader = app(f, other.actor.id, ['contribute']);
    expect((await impact(f, f.published.id, reader)).schedules).toEqual({
      items: [{ id: native.series.id, name: 'Private routine' }],
      total: 1,
      nextOffset: null,
    });
    expect(
      (await impact(f, f.published.id, reader, '?limit=1&scheduleOffset=1')).schedules,
    ).toEqual({
      items: [],
      total: 1,
      nextOffset: null,
    });
    await schema.db.delete(schema.grant).where(eq(schema.grant.id, scope.id));
    expect((await impact(f, f.published.id, reader)).schedules.total).toBe(0);
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['manage'], cascades: false })
      .where(eq(schema.grant.id, other.grant.id));
    const hidden = await impact(f, f.published.id, reader);
    expect(hidden.schedules.items.some((item) => item.id === native.series.id)).toBe(false);
    expect(JSON.stringify(hidden)).not.toContain('Private routine');
  });
  it('includes reusable Program default schedules and their nested template dependencies', async () => {
    const f = await retainedFixture(schema);
    const event = await publication(f, 'project', 'Event with report', f.published);
    const draft = await createWorkTemplate(f.caller, {
      targetType: 'program',
      scope: 'personal',
      offeredTeamIds: [],
      definition: WorkTemplateDefinition.parse({
        name: 'Community gatherings',
        payload: { targetType: 'program' },
        defaultSchedules: [
          {
            key: 'dinner',
            name: 'Community dinner',
            template: {
              targetType: 'project',
              workTypeId: event.id,
              selection: { kind: 'pinned', workTypeVersionId: event.latestPublishedVersionId },
            },
            titlePattern: '{month} Dinner',
            cadence: {
              kind: 'monthly',
              interval: 1,
              startOffsetDays: 0,
              end: { kind: 'never' },
              pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' },
            },
            teamRule: 'creation_team',
            actorRule: 'creator',
          },
        ],
      }),
    });
    const community = await publishWorkTemplate(f.caller, draft.id, draft.draftRevision);
    const direct = await impact(f, event.id);
    expect(direct.parents.items).toEqual([{ id: community.id, name: 'Community gatherings' }]);
    const nested = await impact(f);
    expect(new Set(nested.parents.items.map((item) => item.id))).toEqual(
      new Set([event.id, community.id]),
    );
    const latestDraft = await createWorkTemplate(f.caller, {
      targetType: 'program',
      scope: 'personal',
      offeredTeamIds: [],
      definition: WorkTemplateDefinition.parse({
        ...community.draftDefinition,
        name: 'Latest gatherings',
        defaultSchedules: community.draftDefinition.defaultSchedules.map((outline) => ({
          ...outline,
          template: { ...outline.template, selection: { kind: 'latest' } },
        })),
      }),
    });
    await publishWorkTemplate(f.caller, latestDraft.id, latestDraft.draftRevision);
    await republish(
      f,
      event,
      WorkTemplateDefinition.parse({ name: 'Event v2', payload: { targetType: 'project' } }),
    );
    expect((await impact(f)).parents.items).toEqual([
      { id: community.id, name: 'Community gatherings' },
    ]);
  });

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
