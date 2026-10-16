import { describe, expect, it } from 'vitest';
import { TeamId } from '@docket/identity-access/ids';
import { LabelId, WorkTypeVersionId } from '../src/ids';
import { WorkTemplateDefinition } from '../src/contracts/work-template';
import { ProgramDefaultSchedules } from '../src/contracts/work-schedule-defaults';
import { planTemplateCopy } from '../src/gallery/copy-planner';
import { publication, step, ulid } from './blueprint-fixtures';

import { destinationOrganizationId, base, source, ref, destination } from './gallery-copy-fixture';

describe('pure independent template copy planner', () => {
  it('refuses stale image decisions and replacements outside canonical document fields', async () => {
    const root = publication(3, 'task');
    const input = {
      destinationOrganizationId,
      roots: [ref(root)],
      sources: [source(root)],
      bases: [base],
      latest: [],
      destinations: [destination(root, 1000)],
    };
    await expect(
      planTemplateCopy({
        ...input,
        documentEdits: [
          {
            source: ref(root),
            path: ['payload', 'description'],
            original: 'Stale body',
            replacement: 'Changed body',
            omittedImageCount: 1,
          },
        ],
      }),
    ).rejects.toThrow('stale');
    await expect(
      planTemplateCopy({
        ...input,
        documentEdits: [
          {
            source: ref(root),
            path: ['payload', 'teamId'],
            original: 'Team',
            replacement: '',
            omittedImageCount: 1,
          },
        ],
      }),
    ).rejects.toThrow('exact reusable document');
  });
  it('resolves catalog label suggestions only by explicit destination choices', async () => {
    const root = publication(3, 'task'),
      labelId = LabelId.parse(ulid(70)),
      teamId = TeamId.parse(ulid(71));
    const plan = await planTemplateCopy({
      destinationOrganizationId,
      roots: [ref(root)],
      sources: [{ ...source(root), labelSuggestions: ['Bug', 'Feature'] }],
      bases: [base],
      latest: [],
      destinations: [destination(root, 1000)],
      suggestedLabelMappings: [
        { source: ref(root), suggestion: 'Bug', destinationLabelId: labelId },
      ],
      offeringChoices: [{ source: ref(root), teamIds: [teamId] }],
    });
    expect(plan.copies[0]?.definition.payload).toMatchObject({ labelIds: [labelId] });
    expect(plan.copies[0]?.offeredTeamIds).toEqual([teamId]);
    expect(
      plan.omissions
        .filter((entry) => entry.kind === 'label_suggestion')
        .map((entry) => entry.value),
    ).toEqual(['Feature']);
  });
  it('copies one shared exact source once and pins nested latest and explicit references to caller identities', async () => {
    const child = publication(2, 'task');
    const root = publication(3, 'project', [
      step('a', 'task', {
        template: { workTypeId: child.workTypeId, selection: { kind: 'latest' } },
      }),
      step('b', 'task', {
        sort: 1,
        template: {
          workTypeId: child.workTypeId,
          selection: { kind: 'pinned', workTypeVersionId: child.versionId },
        },
      }),
    ]);
    const input = {
      destinationOrganizationId,
      roots: [ref(root)],
      sources: [source(root), source(child)],
      bases: [base],
      latest: [ref(child)],
      destinations: [destination(root, 1000), destination(child, 1001)],
    };
    const plan = await planTemplateCopy(input);
    expect(plan.copies.map((copy) => copy.workTypeId)).toEqual([ulid(1001), ulid(1000)]);
    expect(plan.copies[1]?.definition.blueprint.steps.map((entry) => entry.template)).toEqual([
      { workTypeId: ulid(1001), selection: { kind: 'pinned', workTypeVersionId: ulid(1101) } },
      { workTypeId: ulid(1001), selection: { kind: 'pinned', workTypeVersionId: ulid(1101) } },
    ]);
    expect(plan.roots).toEqual([{ workTypeId: ulid(1000), versionId: ulid(1100) }]);
    expect(plan).toEqual(
      await planTemplateCopy({
        ...input,
        sources: [...input.sources].reverse(),
        destinations: [...input.destinations].reverse(),
      }),
    );
    expect(root.definition.blueprint.steps[0]?.template?.selection.kind).toBe('latest');
  });
  it('keeps distinct historical and latest source versions as separate independent copies', async () => {
    const old = publication(2, 'task'),
      latest = {
        ...old,
        versionId: WorkTypeVersionId.parse(ulid(222)),
        definition: WorkTemplateDefinition.parse({ name: 'V2', payload: { targetType: 'task' } }),
      };
    const root = publication(3, 'project', [
      step('old', 'task', {
        template: {
          workTypeId: old.workTypeId,
          selection: { kind: 'pinned', workTypeVersionId: old.versionId },
        },
      }),
      step('new', 'task', {
        sort: 1,
        template: { workTypeId: old.workTypeId, selection: { kind: 'latest' } },
      }),
    ]);
    const plan = await planTemplateCopy({
      destinationOrganizationId,
      roots: [ref(root)],
      sources: [source(root), source(old), source(latest)],
      bases: [base],
      latest: [ref(latest)],
      destinations: [destination(root, 1000), destination(old, 1001), destination(latest, 1002)],
    });
    expect(plan.copies).toHaveLength(3);
    expect(
      plan.copies.at(-1)?.definition.blueprint.steps.map((entry) => entry.template?.workTypeId),
    ).toEqual([ulid(1001), ulid(1002)]);
  });
  it('moves catalog sibling default schedules into canonical copied definitions without losing cadence or rules', async () => {
    const child = publication(2, 'task'),
      root = publication(3, 'program');
    const defaultSchedules = ProgramDefaultSchedules.parse([
      {
        key: 'monthly',
        name: 'Report',
        template: {
          targetType: 'task',
          workTypeId: child.workTypeId,
          selection: { kind: 'pinned', workTypeVersionId: child.versionId },
        },
        titlePattern: '{month} Report',
        cadence: {
          kind: 'monthly',
          interval: 1,
          startOffsetDays: 0,
          end: { kind: 'never' },
          pattern: { kind: 'day_of_month', day: 1 },
        },
        teamRule: 'parent_team',
        actorRule: 'creator',
      },
    ]);
    const plan = await planTemplateCopy({
      destinationOrganizationId,
      roots: [ref(root)],
      sources: [{ ...source(root), defaultSchedules }, source(child)],
      bases: [base],
      latest: [],
      destinations: [destination(root, 1000), destination(child, 1001)],
    });
    expect(plan.copies.at(-1)?.definition.defaultSchedules[0]).toMatchObject({
      key: 'monthly',
      titlePattern: '{month} Report',
      teamRule: 'parent_team',
      actorRule: 'creator',
      template: {
        targetType: 'task',
        workTypeId: ulid(1001),
        selection: { kind: 'pinned', workTypeVersionId: ulid(1101) },
      },
    });
  });
  it('keeps only explicit destination label and offering mappings and caller-approved image edits', async () => {
    const keep = LabelId.parse(ulid(70)),
      drop = LabelId.parse(ulid(71)),
      mapped = LabelId.parse(ulid(72));
    const root = {
      ...publication(3, 'task'),
      definition: WorkTemplateDefinition.parse({
        name: 'Copy',
        payload: {
          targetType: 'task',
          description: 'Private image source',
          labelIds: [keep, drop],
        },
      }),
    };
    const teamId = TeamId.parse(ulid(73));
    const plan = await planTemplateCopy({
      destinationOrganizationId,
      roots: [ref(root)],
      sources: [
        {
          ...source(root),
          offeredTeamIds: [teamId],
          labelSuggestions: ['Bug'],
          offeringSuggestions: ['Design'],
        },
      ],
      bases: [base],
      latest: [],
      destinations: [destination(root, 1000)],
      labelMappings: [
        {
          sourceOrganizationId: root.organizationId,
          sourceLabelId: keep,
          destinationLabelId: mapped,
        },
      ],
      documentEdits: [
        {
          source: ref(root),
          path: ['payload', 'description'],
          original: 'Private image source',
          replacement: 'Work outline',
          omittedImageCount: 1,
        },
      ],
    });
    expect(plan.copies[0]?.definition.payload).toMatchObject({
      description: 'Work outline',
      labelIds: [mapped],
    });
    expect(plan.copies[0]?.offeredTeamIds).toEqual([]);
    expect(new Set(plan.omissions.map((entry) => entry.kind))).toEqual(
      new Set(['label', 'image', 'offering', 'label_suggestion', 'offering_suggestion']),
    );
    expect(plan.copies[0]).not.toHaveProperty('ownerActorId');
    for (const omission of plan.omissions)
      expect(Object.keys(omission.source).sort()).toEqual(['versionId', 'workTypeId']);
    expect(root.definition.payload.description).toBe('Private image source');
  });
  it('copies an exact authorized archived publication but refuses it as implicit latest', async () => {
    const child = publication(2, 'task');
    const root = publication(3, 'project', [
      step('child', 'task', {
        template: {
          workTypeId: child.workTypeId,
          selection: { kind: 'pinned', workTypeVersionId: child.versionId },
        },
      }),
    ]);
    const input = {
      destinationOrganizationId,
      roots: [ref(root)],
      sources: [source(root), { ...source(child), archived: true }],
      bases: [base],
      latest: [],
      destinations: [destination(root, 1000), destination(child, 1001)],
    };
    expect((await planTemplateCopy(input)).copies).toHaveLength(2);
    const latest = {
      ...root,
      definition: WorkTemplateDefinition.parse({
        ...root.definition,
        blueprint: {
          steps: [
            step('child', 'task', {
              template: { workTypeId: child.workTypeId, selection: { kind: 'latest' } },
            }),
          ],
          dependencies: [],
        },
      }),
    };
    await expect(
      planTemplateCopy({
        ...input,
        sources: [source(latest), { ...source(child), archived: true }],
        latest: [ref(child)],
      }),
    ).rejects.toThrow('Archived');
  });
});
