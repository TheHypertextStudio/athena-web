import { beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type * as DbModule from '@docket/db';
import { ActorId } from '@docket/identity-access/ids';
import { InitiativeId, LabelId } from '@docket/work/ids';
import { ProjectWorkViewQueryRequest } from '@docket/work/work-view-contract';

import { queryWorkView } from '../../src/lib/work-views/query';
import { getDb, seedBaseOrg } from '../support/routes-harness';

type ProjectRequest = z.output<typeof ProjectWorkViewQueryRequest>;

function projectRequest(over: Partial<ProjectRequest> = {}): ProjectRequest {
  return ProjectWorkViewQueryRequest.parse({
    target: 'project',
    definition: {
      version: 2,
      target: 'project',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['status', 'priority'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    temporaryFilter: null,
    context: { kind: 'organization' },
    limit: 100,
    ...over,
  });
}

function projectFilterRequest(
  filter: NonNullable<ProjectRequest['definition']['filter']>,
): ProjectRequest {
  return projectRequest({
    definition: {
      ...projectRequest().definition,
      filter,
    },
  });
}

describe('work-view relation tenant boundaries', () => {
  let schema: typeof DbModule;

  beforeAll(async () => {
    schema = await getDb();
  });

  it('rejects corrupt Label, Project-member, and Initiative edges in every read shape', async () => {
    const rootOrg = await seedBaseOrg(schema.db, schema);
    const foreignOrg = await seedBaseOrg(schema.db, schema);
    const [project] = await schema.db
      .insert(schema.project)
      .values({
        organizationId: rootOrg.orgId,
        name: 'Tenant-safe relations',
        teamId: rootOrg.teamId,
        status: 'planned',
        statusId: rootOrg.statusId('project', 'planned'),
        visibility: 'public',
      })
      .returning({ id: schema.project.id });
    if (!project) throw new Error('Project was not seeded');
    const [localLabel, foreignLabel] = await schema.db
      .insert(schema.label)
      .values([
        { organizationId: rootOrg.orgId, name: 'Wrong-edge-org Label', color: 'red' },
        { organizationId: foreignOrg.orgId, name: 'Foreign Label leak', color: 'blue' },
      ])
      .returning({ id: schema.label.id, name: schema.label.name });
    if (!localLabel || !foreignLabel) throw new Error('Labels were not seeded');
    const [localMember] = await schema.db
      .insert(schema.actor)
      .values({
        organizationId: rootOrg.orgId,
        kind: 'human',
        displayName: 'Wrong-edge-org member',
      })
      .returning({ id: schema.actor.id });
    if (!localMember) throw new Error('local member was not seeded');
    const [localInitiative] = await schema.db
      .insert(schema.initiative)
      .values({
        organizationId: rootOrg.orgId,
        name: 'Wrong-edge-org Initiative',
        status: 'active',
        statusId: rootOrg.statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    const [foreignInitiative] = await schema.db
      .insert(schema.initiative)
      .values({
        organizationId: foreignOrg.orgId,
        name: 'Foreign Initiative leak',
        status: 'active',
        statusId: foreignOrg.statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    if (!localInitiative || !foreignInitiative) throw new Error('Initiatives were not seeded');
    await schema.db.insert(schema.projectLabel).values([
      {
        organizationId: foreignOrg.orgId,
        projectId: project.id,
        labelId: localLabel.id,
      },
      {
        organizationId: rootOrg.orgId,
        projectId: project.id,
        labelId: foreignLabel.id,
      },
    ]);
    await schema.db.insert(schema.projectMember).values([
      {
        organizationId: foreignOrg.orgId,
        projectId: project.id,
        actorId: localMember.id,
      },
      {
        organizationId: rootOrg.orgId,
        projectId: project.id,
        actorId: foreignOrg.humanActorId,
      },
    ]);
    await schema.db.insert(schema.initiativeProject).values([
      {
        organizationId: foreignOrg.orgId,
        projectId: project.id,
        initiativeId: localInitiative.id,
      },
      {
        organizationId: rootOrg.orgId,
        projectId: project.id,
        initiativeId: foreignInitiative.id,
      },
    ]);

    const roster = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: projectRequest(),
    });
    const row = roster.rows.find((candidate) => candidate.target === 'project');
    expect(row?.labels).toEqual([]);
    expect(row?.members).toEqual([]);
    expect(row?.initiatives).toEqual([]);

    const relationCases = [
      {
        field: 'labels' as const,
        requests: [LabelId.parse(localLabel.id), LabelId.parse(foreignLabel.id)].map((operand) =>
          projectFilterRequest({
            kind: 'predicate',
            field: 'labels',
            operator: 'includesAny',
            operand: [operand],
          }),
        ),
        leakedLabels: ['Wrong-edge-org Label', 'Foreign Label leak'],
      },
      {
        field: 'members' as const,
        requests: [
          { kind: 'actor' as const, actorId: ActorId.parse(localMember.id) },
          { kind: 'actor' as const, actorId: ActorId.parse(foreignOrg.humanActorId) },
        ].map((operand) =>
          projectFilterRequest({
            kind: 'predicate',
            field: 'members',
            operator: 'includesAny',
            operand: [operand],
          }),
        ),
        leakedLabels: ['Wrong-edge-org member', 'Ada'],
      },
      {
        field: 'initiatives' as const,
        requests: [
          InitiativeId.parse(localInitiative.id),
          InitiativeId.parse(foreignInitiative.id),
        ].map((operand) =>
          projectFilterRequest({
            kind: 'predicate',
            field: 'initiatives',
            operator: 'includesAny',
            operand: [operand],
          }),
        ),
        leakedLabels: ['Wrong-edge-org Initiative', 'Foreign Initiative leak'],
      },
    ];
    for (const relationCase of relationCases) {
      for (const request of relationCase.requests) {
        const filtered = await queryWorkView({
          database: schema.db,
          organizationId: rootOrg.orgId,
          actorId: rootOrg.humanActorId,
          request,
        });
        expect(filtered.totalCount).toBe(0);
      }
      const grouped = await queryWorkView({
        database: schema.db,
        organizationId: rootOrg.orgId,
        actorId: rootOrg.humanActorId,
        request: projectRequest({
          definition: {
            ...projectRequest().definition,
            arrangement: {
              groupBy: relationCase.field,
              subGroupBy: null,
              orderBy: [],
            },
          },
        }),
      });
      expect(grouped.groups).toContainEqual({
        path: ['__empty__'],
        key: '__empty__',
        label: 'No value',
        count: 1,
      });
      for (const leakedLabel of relationCase.leakedLabels) {
        expect(grouped.groups.map((group) => group.label)).not.toContain(leakedLabel);
      }
    }

    for (const initiativeId of [localInitiative.id, foreignInitiative.id]) {
      const contextual = await queryWorkView({
        database: schema.db,
        organizationId: rootOrg.orgId,
        actorId: rootOrg.humanActorId,
        request: projectRequest({
          context: { kind: 'initiative', initiativeId: InitiativeId.parse(initiativeId) },
        }),
      });
      expect(contextual).toMatchObject({ totalCount: 0, rows: [] });
    }
  });
});
