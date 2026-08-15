/**
 * `@docket/api` — Time Ledger context/allocation access policy.
 *
 * @remarks
 * `tests/routes/time.test.ts` exercises this policy end to end through the HTTP layer for the
 * common `work_item` context and `task`/`workspace` allocation targets. This file exercises the
 * rest of the switch directly: every other `EntityRef.kind`, the `TimeAllocationTargetKind`
 * variants, and `canReadTimeContext`'s revoked-membership and calendar-ownership branches — the
 * places a silent gap here would leak another tenant's context or grant read access to a Time
 * Ledger row that was never the caller's.
 */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type {
  assertOwnedTimeCategory as AssertOwnedTimeCategory,
  canReadTimeContext as CanReadTimeContext,
  prepareInitialTimeContexts as PrepareInitialTimeContexts,
  resolveTimeHubId as ResolveTimeHubId,
  validateTimeAllocationTarget as ValidateTimeAllocationTarget,
  validateTimeContext as ValidateTimeContext,
} from '../../src/time/access';
import {
  addMember,
  getDb,
  one,
  seedBaseOrg,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let resolveTimeHubId!: typeof ResolveTimeHubId;
let assertOwnedTimeCategory!: typeof AssertOwnedTimeCategory;
let validateTimeContext!: typeof ValidateTimeContext;
let prepareInitialTimeContexts!: typeof PrepareInitialTimeContexts;
let validateTimeAllocationTarget!: typeof ValidateTimeAllocationTarget;
let canReadTimeContext!: typeof CanReadTimeContext;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({
    resolveTimeHubId,
    assertOwnedTimeCategory,
    validateTimeContext,
    prepareInitialTimeContexts,
    validateTimeAllocationTarget,
    canReadTimeContext,
  } = await import('../../src/time/access'));
});

function docketRef(
  kind: string,
  externalId: string,
): {
  kind: never;
  source: 'docket';
  externalId: string;
  title: null;
  url: null;
  docketEntityId: null;
} {
  return {
    kind: kind as never,
    source: 'docket',
    externalId,
    title: null,
    url: null,
    docketEntityId: null,
  };
}

describe('resolveTimeHubId', () => {
  it('throws when the account has no Hub', async () => {
    await expect(resolveTimeHubId('nonexistent-user-id')).rejects.toThrow('Hub not found');
  });
});

describe('assertOwnedTimeCategory', () => {
  it('is a no-op for a null/undefined category', async () => {
    await expect(assertOwnedTimeCategory(null, 'hub_x')).resolves.toBeUndefined();
    await expect(assertOwnedTimeCategory(undefined, 'hub_x')).resolves.toBeUndefined();
  });

  it('refuses a category id owned by a different Hub', async () => {
    const ownerUserId = await seedUserWithHub(db, schema, 'CategoryOwner');
    const hubId = await resolveTimeHubId(ownerUserId);
    const category = one(
      await db
        .insert(schema.timeCategory)
        .values({ hubId, name: 'Deep work' })
        .returning({ id: schema.timeCategory.id }),
    );

    await expect(assertOwnedTimeCategory(category.id, 'some-other-hub')).rejects.toThrow(
      'Time category not found',
    );
    await expect(assertOwnedTimeCategory(category.id, hubId)).resolves.toBeUndefined();
  });
});

describe('validateTimeContext / resolveDocketContextOrganization', () => {
  it.each(['project', 'program', 'initiative', 'cycle'] as const)(
    'resolves a Docket %s context to its owning workspace',
    async (kind) => {
      const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
      const userId = await seedUserWithHub(db, schema, `TimeCtx-${kind}`);
      await addMember(db, schema, orgId, userId);

      let entityId: string;
      if (kind === 'project') {
        entityId = one(
          await db
            .insert(schema.project)
            .values({
              organizationId: orgId,
              name: 'P',
              teamId,
              status: 'planned',
              statusId: statusId('project', 'planned'),
            })
            .returning({ id: schema.project.id }),
        ).id;
      } else if (kind === 'program') {
        entityId = one(
          await db
            .insert(schema.program)
            .values({
              organizationId: orgId,
              name: 'Prog',
              status: 'active',
              statusId: statusId('program', 'active'),
            })
            .returning({ id: schema.program.id }),
        ).id;
      } else if (kind === 'initiative') {
        entityId = one(
          await db
            .insert(schema.initiative)
            .values({
              organizationId: orgId,
              name: 'I',
              status: 'active',
              statusId: statusId('initiative', 'active'),
            })
            .returning({ id: schema.initiative.id }),
        ).id;
      } else {
        entityId = one(
          await db
            .insert(schema.cycle)
            .values({
              organizationId: orgId,
              teamId,
              number: 1,
              startsAt: new Date(),
              endsAt: new Date(Date.now() + 6.048e8),
            })
            .returning({ id: schema.cycle.id }),
        ).id;
      }

      const organizationId = await validateTimeContext(userId, {
        role: 'related',
        entityRef: docketRef(kind, entityId),
      });
      expect(organizationId).toBe(orgId);
    },
  );

  it('resolves a Docket organization context to itself', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'TimeCtxOrg');
    await addMember(db, schema, orgId, userId);

    const organizationId = await validateTimeContext(userId, {
      role: 'related',
      entityRef: docketRef('organization', orgId),
    });
    expect(organizationId).toBe(orgId);
  });

  it('refuses a project/program/initiative/cycle id that does not resolve', async () => {
    const userId = await seedUserWithHub(db, schema, 'TimeCtxMissing');
    await expect(
      validateTimeContext(userId, { role: 'related', entityRef: docketRef('project', 'nope') }),
    ).rejects.toThrow('Time context not found');
  });

  it('resolves an owned calendar_event context without requiring workspace membership', async () => {
    const userId = await seedUserWithHub(db, schema, 'TimeCtxCalendar');
    const layer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId, sourceKind: 'native', title: 'Layer' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await db
        .insert(schema.calendarItem)
        .values({ userId, layerId: layer.id, kind: 'block', title: 'Focus' })
        .returning({ id: schema.calendarItem.id }),
    );

    const organizationId = await validateTimeContext(userId, {
      role: 'related',
      entityRef: docketRef('calendar_event', item.id),
    });
    expect(organizationId).toBeNull();
  });

  it('refuses a calendar_event id owned by another account', async () => {
    const owner = await seedUserWithHub(db, schema, 'TimeCtxCalOwner');
    const other = await seedUserWithHub(db, schema, 'TimeCtxCalOther');
    const layer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId: owner, sourceKind: 'native', title: 'Layer' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await db
        .insert(schema.calendarItem)
        .values({ userId: owner, layerId: layer.id, kind: 'block', title: 'Focus' })
        .returning({ id: schema.calendarItem.id }),
    );

    await expect(
      validateTimeContext(other, {
        role: 'related',
        entityRef: docketRef('calendar_event', item.id),
      }),
    ).rejects.toThrow('Calendar context not found');
  });

  it.each(['thread', 'message', 'document', 'person'] as const)(
    'refuses an unsupported %s context kind outright',
    async (kind) => {
      const userId = await seedUserWithHub(db, schema, `TimeCtxUnsupported-${kind}`);
      await expect(
        validateTimeContext(userId, { role: 'related', entityRef: docketRef(kind, 'x') }),
      ).rejects.toThrow('Time context not found');
    },
  );

  it('treats a non-docket source as workspace-agnostic', async () => {
    const userId = await seedUserWithHub(db, schema, 'TimeCtxNonDocket');
    const organizationId = await validateTimeContext(userId, {
      role: 'related',
      entityRef: {
        kind: 'work_item',
        source: 'linear',
        externalId: 'ext-1',
        title: null,
        url: null,
        docketEntityId: null,
      },
    });
    expect(organizationId).toBeNull();
  });

  it('refuses an explicit organizationId that disagrees with the referenced item’s own workspace', async () => {
    const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
    const otherOrgId = await seedOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'TimeCtxMismatch');
    await addMember(db, schema, orgId, userId);
    await addMember(db, schema, otherOrgId, userId);
    const project = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'P',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id }),
    );

    await expect(
      validateTimeContext(userId, {
        role: 'related',
        entityRef: docketRef('project', project.id),
        organizationId: otherOrgId as never,
      }),
    ).rejects.toThrow('Time context workspace does not match its referenced item');
  });
});

describe('prepareInitialTimeContexts', () => {
  it('builds one prepared context per supplied ref (primary, workspace, contextual)', async () => {
    const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'TimePrepare');
    await addMember(db, schema, orgId, userId);
    const project = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'P',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id }),
    );

    const prepared = await prepareInitialTimeContexts(userId, {
      label: 'Ship the feature',
      primaryRef: docketRef('project', project.id),
      workspaceRef: docketRef('organization', orgId),
      contextualRefs: [docketRef('organization', orgId)],
    });
    expect(prepared.map((p) => p.role)).toEqual(['primary', 'related', 'related']);
    expect(prepared.every((p) => p.organizationId === orgId)).toBe(true);
  });

  it('returns an empty array when no refs are supplied', async () => {
    const userId = await seedUserWithHub(db, schema, 'TimePrepareEmpty');
    expect(
      await prepareInitialTimeContexts(userId, { label: 'Untitled', contextualRefs: [] }),
    ).toEqual([]);
  });
});

describe('validateTimeAllocationTarget', () => {
  it('accepts a workspace-kind allocation for a member workspace', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'AllocWorkspace');
    await addMember(db, schema, orgId, userId);
    const hubId = await resolveTimeHubId(userId);

    const organizationId = await validateTimeAllocationTarget(userId, hubId, {
      targetKind: 'workspace',
      targetId: orgId,
      basisPoints: 10_000,
    });
    expect(organizationId).toBe(orgId);
  });

  it('accepts a project-kind allocation resolved to its workspace', async () => {
    const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'AllocProject');
    await addMember(db, schema, orgId, userId);
    const hubId = await resolveTimeHubId(userId);
    const project = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'P',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id }),
    );

    const organizationId = await validateTimeAllocationTarget(userId, hubId, {
      targetKind: 'project',
      targetId: project.id,
      basisPoints: 10_000,
    });
    expect(organizationId).toBe(orgId);
  });

  it('accepts a category-kind allocation with no workspace, refusing an attached organizationId', async () => {
    const userId = await seedUserWithHub(db, schema, 'AllocCategory');
    const hubId = await resolveTimeHubId(userId);
    const category = one(
      await db
        .insert(schema.timeCategory)
        .values({ hubId, name: 'Admin' })
        .returning({ id: schema.timeCategory.id }),
    );

    expect(
      await validateTimeAllocationTarget(userId, hubId, {
        targetKind: 'category',
        targetId: category.id,
        basisPoints: 10_000,
      }),
    ).toBeNull();

    const { orgId } = await seedBaseOrg(db, schema);
    await expect(
      validateTimeAllocationTarget(userId, hubId, {
        targetKind: 'category',
        targetId: category.id,
        organizationId: orgId as never,
        basisPoints: 10_000,
      }),
    ).rejects.toThrow('Personal category allocations cannot name a workspace');
  });

  it('refuses a task/project target that does not resolve to a workspace', async () => {
    const userId = await seedUserWithHub(db, schema, 'AllocMissingTarget');
    const hubId = await resolveTimeHubId(userId);
    await expect(
      validateTimeAllocationTarget(userId, hubId, {
        targetKind: 'task',
        targetId: 'nonexistent',
        basisPoints: 10_000,
      }),
    ).rejects.toThrow('Allocation target not found');
  });

  it('refuses an explicit organizationId that disagrees with the target’s own workspace', async () => {
    const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
    const otherOrgId = await seedOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'AllocMismatch');
    await addMember(db, schema, orgId, userId);
    await addMember(db, schema, otherOrgId, userId);
    const hubId = await resolveTimeHubId(userId);
    const task = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'T',
          teamId,
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        })
        .returning({ id: schema.task.id }),
    );

    await expect(
      validateTimeAllocationTarget(userId, hubId, {
        targetKind: 'task',
        targetId: task.id,
        organizationId: otherOrgId as never,
        basisPoints: 10_000,
      }),
    ).rejects.toThrow('Allocation workspace does not match its target');
  });
});

describe('canReadTimeContext', () => {
  it('always allows reading a non-docket context', async () => {
    const userId = await seedUserWithHub(db, schema, 'ReadNonDocket');
    expect(
      await canReadTimeContext(userId, {
        sourceSystem: 'linear',
      } as never),
    ).toBe(true);
  });

  it('allows reading a calendar_event context owned by the caller, and refuses another’s', async () => {
    const owner = await seedUserWithHub(db, schema, 'ReadCalOwner');
    const other = await seedUserWithHub(db, schema, 'ReadCalOther');
    const layer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId: owner, sourceKind: 'native', title: 'Layer' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await db
        .insert(schema.calendarItem)
        .values({ userId: owner, layerId: layer.id, kind: 'block', title: 'Focus' })
        .returning({ id: schema.calendarItem.id }),
    );
    const context = {
      sourceSystem: 'docket',
      entityKind: 'calendar_event',
      docketEntityId: item.id,
      externalId: item.id,
      organizationId: null,
    } as never;
    expect(await canReadTimeContext(owner, context)).toBe(true);
    expect(await canReadTimeContext(other, context)).toBe(false);
  });

  it('refuses a docket context with no recorded organization', async () => {
    const userId = await seedUserWithHub(db, schema, 'ReadNoOrg');
    expect(
      await canReadTimeContext(userId, {
        sourceSystem: 'docket',
        entityKind: 'work_item',
        docketEntityId: null,
        externalId: 'x',
        organizationId: null,
      } as never),
    ).toBe(false);
  });

  it('allows a current member and refuses once membership is gone', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'ReadMember');
    const actorId = await addMember(db, schema, orgId, userId);
    const context = {
      sourceSystem: 'docket',
      entityKind: 'work_item',
      docketEntityId: 'task-x',
      externalId: 'task-x',
      organizationId: orgId,
    } as never;
    expect(await canReadTimeContext(userId, context)).toBe(true);

    await db.delete(schema.actor).where(eq(schema.actor.id, actorId));
    expect(await canReadTimeContext(userId, context)).toBe(false);
  });
});
