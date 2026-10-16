import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import { CycleId } from '../src/ids';
import { planBlueprint, aggregateBlueprintWarnings } from '../src/blueprints/rules';
import {
  actor,
  team,
  context,
  input,
  existing,
  present,
  graph,
  publication,
  resolution,
  step,
  ulid,
} from './blueprint-fixtures';
import {
  BlueprintCreationOptions,
  BlueprintPreviewOptions,
  BlueprintCreationPreview,
} from '../src/contracts/work-template-blueprint';

describe('public blueprint creation review contracts', () => {
  it('allows a fresh read-only review of optional choices but requires a token to create them', () => {
    const input = { optionalChoices: [{ path: ['prepare'], selected: false }] };
    expect(BlueprintPreviewOptions.safeParse(input).success).toBe(true);
    expect(BlueprintCreationOptions.safeParse(input).success).toBe(false);
  });
  it('refuses duplicate choices in read-only previews as well as creation', () => {
    const input = {
      optionalChoices: [
        { path: ['prepare'], selected: false },
        { path: ['prepare'], selected: true },
      ],
    };
    expect(BlueprintPreviewOptions.safeParse(input).success).toBe(false);
  });
  it('bounds summaries and refuses private definition or body properties', () => {
    const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const preview = {
      workTypeId: id,
      workTypeVersionId: id,
      previewToken: `sha256:${'a'.repeat(64)}`,
      resolvedManifest: [],
      descendants: [],
      descendantCount: 0,
      selectedCount: 1,
      additionalMilestoneCount: 0,
      summaryOffset: 0,
      nextSummaryOffset: null,
      warnings: [],
    };
    expect(BlueprintCreationPreview.safeParse(preview).success).toBe(true);
    expect(
      BlueprintCreationPreview.safeParse({
        ...preview,
        definition: { description: 'Private draft' },
      }).success,
    ).toBe(false);
    expect(BlueprintCreationPreview.safeParse({ ...preview, selectedCount: 501 }).success).toBe(
      false,
    );
  });
});

describe('authorized planner overrides and retained context', () => {
  it('refuses root-kind, workspace and retained-path ambiguity before planning children', () => {
    const source = input();
    expect(() => planBlueprint({ ...source, root: { ...source.root, kind: 'task' } })).toThrow(
      /kind or workspace mismatch/i,
    );
    expect(() =>
      planBlueprint({
        ...source,
        context: context({
          organizationId: OrganizationId.parse(ulid(80)),
        }),
      }),
    ).toThrow(/kind or workspace mismatch/i);
    const child = present(existing()[1]);
    expect(() =>
      planBlueprint({
        ...source,
        context: context({
          existingNodes: [child, { ...child, id: 'duplicate-path' }],
        }),
      }),
    ).toThrow(/retained paths must be unique/i);
  });

  it('refuses an unavailable explicit actor instead of falling back to a relative default', () => {
    const unavailable = ActorId.parse(ulid(81));
    expect(() =>
      planBlueprint(
        input({
          context: context({
            actors: [{ id: unavailable, active: false }],
            overrides: [{ path: ['child'], responsibleActorId: unavailable }],
          }),
        }),
      ),
    ).toThrow(/explicit responsible actor is unavailable/i);
  });

  it('requires a resolved team for a root Task even when a creation fallback exists', () => {
    const root = publication(2, 'task');
    expect(() =>
      planBlueprint(
        input({
          graph: graph(root, [], []),
          root: {
            kind: 'task',
            fields: { title: 'Root' },
            teamId: null,
            responsibleActorId: null,
            cycleId: null,
            dates: {},
          },
        }),
      ),
    ).toThrow(/creation team/i);
  });

  it('inherits the nearest Task cycle through an intervening uncycled Task', () => {
    const base = publication(9, 'task');
    const root = publication(2, 'task', [
      step('child'),
      step('nested', 'task', { parentStepKey: 'child', cycleRule: 'parent_cycle' }),
    ]);
    const cycle = {
      id: CycleId.parse(ulid(82)),
      organizationId: context().organizationId,
      teamId: team,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      archived: false,
      closed: false,
    };
    const planned = planBlueprint(
      input({
        graph: graph(root, [base], [resolution(['child'], base), resolution(['nested'], base)]),
        root: {
          kind: 'task',
          fields: { title: 'Root' },
          teamId: team,
          responsibleActorId: actor,
          cycleId: cycle.id,
          dates: {},
        },
        context: context({ cycles: [cycle] }),
      }),
    );
    expect(planned.nodes.find((node) => node.path[0] === 'child')?.cycleId).toBeNull();
    expect(planned.nodes.find((node) => node.path[0] === 'nested')?.cycleId).toBe(cycle.id);
    expect(planned.warnings).toEqual([]);
  });

  it.each([{ archived: true }, { closed: true }, { teamId: TeamId.parse(ulid(83)) }])(
    'rejects an invalid explicit cycle instead of silently removing it: %j',
    (change) => {
      const cycle = {
        id: CycleId.parse(ulid(82)),
        organizationId: context().organizationId,
        teamId: team,
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        archived: false,
        closed: false,
      };
      expect(() =>
        planBlueprint(
          input({
            context: context({
              cycles: [{ ...cycle, ...change }],
              overrides: [{ path: ['child'], cycleId: cycle.id }],
            }),
          }),
        ),
      ).toThrow(/explicit cycle is unavailable/i);
    },
  );

  it('lets an explicit null cycle override suppress an unavailable current-cycle default', () => {
    const base = publication(9, 'task');
    const root = publication(2, 'project', [step('child', 'task', { cycleRule: 'current_cycle' })]);
    const planned = planBlueprint(
      input({
        graph: graph(root, [base], [resolution(['child'], base)]),
        context: context({ overrides: [{ path: ['child'], cycleId: null }] }),
      }),
    );
    expect(planned.nodes[1]?.cycleId).toBeNull();
    expect(planned.warnings).toEqual([]);
  });

  it('uses the frozen run date rather than creation day to resolve a current cycle', () => {
    const base = publication(9, 'task');
    const root = publication(2, 'project', [step('child', 'task', { cycleRule: 'current_cycle' })]);
    const cycle = {
      id: CycleId.parse(ulid(82)),
      organizationId: context().organizationId,
      teamId: team,
      startDate: '2026-10-01',
      endDate: '2026-10-10',
      archived: false,
      closed: false,
    };
    const planned = planBlueprint(
      input({
        graph: graph(root, [base], [resolution(['child'], base)]),
        context: context({ runDate: '2026-10-15', cycles: [cycle] }),
      }),
    );
    expect(planned.nodes[1]?.cycleId).toBeNull();
    expect(planned.warnings).toMatchObject([{ code: 'cycle_unavailable', paths: [['child']] }]);
  });

  it('bounds displayed warning paths while preserving the count and removing duplicates', () => {
    const paths = Array.from({ length: 105 }, (_, i) => [`child_${String(i)}`]);
    const warnings = aggregateBlueprintWarnings([
      { code: 'actor_unavailable', paths, count: paths.length },
      { code: 'actor_unavailable', paths: [['child_0']], count: 1 },
      { code: 'cycle_unavailable', paths: [['child_0']], count: 1 },
    ]);
    expect(warnings[0]).toEqual({
      code: 'actor_unavailable',
      paths: paths.slice(0, 100),
      count: 105,
    });
    expect(warnings[1]).toEqual({ code: 'cycle_unavailable', paths: [['child_0']], count: 1 });
  });
});
