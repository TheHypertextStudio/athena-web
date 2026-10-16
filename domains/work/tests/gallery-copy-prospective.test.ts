import { describe, expect, it, vi } from 'vitest';
import { fingerprintCopyFacts } from '../src/gallery/copy-api';
import { TeamId } from '@docket/identity-access/ids';
import { LabelId } from '../src/ids';
import {
  previewTemplateCopySources,
  planTemplateCopySources,
} from '../src/gallery/copy-prospective-plan';
import { copyIdentityKey } from '../src/gallery/copy-identity';
import { WorkTemplateDefinition } from '../src/contracts/work-template';
import { step } from './blueprint-fixtures';
import {
  prospectiveSource,
  prospectiveInput,
  prospectiveBinding,
  prospectiveReference,
  prospectiveDestination,
} from './gallery-prospective-fixture';
describe('prospective copy source planning', () => {
  it('previews revision-zero drafts with inline work before any destination IDs exist', async () => {
    const root = prospectiveSource(3, 'project', [step('child')]);
    const preview = await previewTemplateCopySources(prospectiveInput([root]));
    expect(preview.copies).toEqual([
      {
        source: root.identity,
        sourceFingerprint: root.fingerprint,
        kind: 'project',
        previewDefinition: root.definition,
        offeredTeamIds: [],
        dependencies: [],
      },
    ]);
    expect(preview).not.toHaveProperty('destinations');
    expect(preview.copies[0]).not.toHaveProperty('versionId');
    expect(preview.reviewFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
  it('plans mixed private/public source units into honest independent reserved destination pins', async () => {
    const child = prospectiveSource(2, 'task', [], 'publication');
    const root = prospectiveSource(3, 'project', [
      step('child', 'task', { template: prospectiveReference(child) }),
    ]);
    const input = prospectiveInput([root, child], [prospectiveBinding(root, child)]);
    const destinations = [prospectiveDestination(root, 1000), prospectiveDestination(child, 1001)];
    const before = JSON.stringify(input);
    const plan = await planTemplateCopySources({ ...input, destinations });
    expect(plan.copies.map((copy) => copyIdentityKey(copy.source))).toEqual([
      copyIdentityKey(child.identity),
      copyIdentityKey(root.identity),
    ]);
    expect(plan.copies.map((copy) => copy.kind)).toEqual(['reserved', 'reserved']);
    expect(plan.copies.every((copy) => !('versionId' in copy))).toBe(true);
    expect(plan.copies.at(-1)?.definition.blueprint.steps[0]?.template).toEqual({
      workTypeId: destinations[1]?.workTypeId,
      selection: { kind: 'pinned', workTypeVersionId: destinations[1]?.reservedFirstPublicationId },
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(plan.reviewFingerprint).toBe(
      (await previewTemplateCopySources(input)).reviewFingerprint,
    );
  });
  it('keeps a next draft separate from an already published version of the same definition', async () => {
    const draft = prospectiveSource(2),
      published = prospectiveSource(2, 'task', [], 'publication');
    const input = {
      ...prospectiveInput([draft, published]),
      roots: [draft.identity, published.identity],
    };
    expect((await previewTemplateCopySources(input)).copies).toHaveLength(2);
  });
  it('rejects hierarchy and combined date/dependency cycles through the shared prospective grammar', async () => {
    const bad = prospectiveSource(3, 'task', [step('wrong', 'project')]);
    await expect(previewTemplateCopySources(prospectiveInput([bad]))).rejects.toThrow('hierarchy');
    const cyclic = prospectiveSource(3, 'project', [
      step('a', 'task', {
        dates: {
          dueDate: {
            kind: 'after_completion',
            stepKeys: ['b'],
            offset: { days: 0, unit: 'calendar' },
          },
        },
      }),
      step('b'),
    ]);
    const source = {
      ...cyclic,
      definition: WorkTemplateDefinition.parse({
        ...cyclic.definition,
        blueprint: {
          ...cyclic.definition.blueprint,
          dependencies: [{ blockerStepKey: 'a', blockedStepKey: 'b' }],
        },
      }),
    };
    await expect(previewTemplateCopySources(prospectiveInput([source]))).rejects.toThrow(/cycle/);
  });
  it('counts optional work and Milestones toward the same500 limit without fake base projections', async () => {
    const root = prospectiveSource(
      3,
      'project',
      Array.from({ length: 499 }, (_, i) =>
        step(`child_${i}`, i === 0 ? 'milestone' : 'task', {
          sort: i,
          optional: { enabled: true, selectedByDefault: false },
        }),
      ),
    );
    expect((await previewTemplateCopySources(prospectiveInput([root]))).copies).toHaveLength(1);
    const child = prospectiveSource(2, 'task', [step('nested')]);
    const oversized = prospectiveSource(4, 'project', [
      ...root.definition.blueprint.steps.slice(0, 498),
      step('extra', 'task', { template: prospectiveReference(child) }),
    ]);
    await expect(
      previewTemplateCopySources(
        prospectiveInput([oversized, child], [prospectiveBinding(oversized, child, 'extra')]),
      ),
    ).rejects.toThrow(/500/);
  });
  it('binds review to normalized bodies and reviewed copy decisions but not destination allocation', async () => {
    const root = prospectiveSource(3);
    const input = prospectiveInput([root]);
    const initial = await previewTemplateCopySources(input);
    const changed = {
      ...root,
      definition: WorkTemplateDefinition.parse({
        ...root.definition,
        description: 'A different reusable document',
      }),
    };
    expect(
      (await previewTemplateCopySources(prospectiveInput([changed]))).reviewFingerprint,
    ).not.toBe(initial.reviewFingerprint);
    const later = await planTemplateCopySources({
      ...input,
      destinations: [prospectiveDestination(root, 1200)],
    });
    expect(later.reviewFingerprint).toBe(initial.reviewFingerprint);
    await expect(
      planTemplateCopySources({
        ...input,
        destinations: [
          { ...prospectiveDestination(root, 1200), workTypeId: root.identity.workTypeId },
        ],
      }),
    ).rejects.toThrow('independent');
  });
  it('rewrites a checked private reservation closure without publishing either source', async () => {
    const child = prospectiveSource(2),
      root = prospectiveSource(3, 'project', [
        step('child', 'task', { template: prospectiveReference(child) }),
      ]);
    const input = prospectiveInput([root, child], [prospectiveBinding(root, child)]);
    const destinations = [prospectiveDestination(root, 1000), prospectiveDestination(child, 1001)];
    const plan = await planTemplateCopySources({ ...input, destinations });
    expect(plan.copies.every((copy) => copy.source.kind === 'draft')).toBe(true);
    expect(plan.copies.at(-1)?.definition.blueprint.steps[0]?.template?.selection).toEqual({
      kind: 'pinned',
      workTypeVersionId: destinations[1]?.reservedFirstPublicationId,
    });
    await expect(
      planTemplateCopySources({
        ...input,
        destinations: [
          { ...prospectiveDestination(root, 1000), kind: 'published' as 'reserved' },
          prospectiveDestination(child, 1001),
        ],
      }),
    ).rejects.toThrow('explicit reservations');
  });
  it('bounds100 exact draft units and rejects the101st without destination allocation', async () => {
    const sources = Array.from({ length: 101 }, (_, index) => prospectiveSource(1000 + index));
    const input = {
      ...prospectiveInput(sources),
      roots: sources.slice(0, 100).map((source) => source.identity),
    };
    expect((await previewTemplateCopySources(input)).copies).toHaveLength(100);
    await expect(
      previewTemplateCopySources({ ...input, roots: sources.map((source) => source.identity) }),
    ).rejects.toThrow('100 distinct');
  });
});

it('shows the exact reviewed document, labels and offerings before destination allocation', async () => {
  const root = { ...prospectiveSource(3), labelSuggestions: ['Bug'] };
  root.definition = WorkTemplateDefinition.parse({
    ...root.definition,
    payload: { targetType: 'task', description: 'Original image' },
  });
  const label = LabelId.parse('01ARZ3NDEKTSV4RRFFQ0000700');
  const team = TeamId.parse('01ARZ3NDEKTSV4RRFFQ0000701');
  const input = {
    ...prospectiveInput([root]),
    suggestedLabelMappings: [
      { source: root.identity, suggestion: 'Bug', destinationLabelId: label },
    ],
    offeringChoices: [{ source: root.identity, teamIds: [team] }],
    documentEdits: [
      {
        source: root.identity,
        path: ['payload', 'description'],
        original: 'Original image',
        replacement: 'Reviewed context',
        omittedImageCount: 1,
      },
    ],
  };
  const before = JSON.stringify(input);
  const preview = await previewTemplateCopySources(input);
  expect(preview.copies[0]).toMatchObject({
    previewDefinition: { payload: { description: 'Reviewed context', labelIds: [label] } },
    offeredTeamIds: [team],
  });
  expect(preview.copies[0]).not.toHaveProperty('reservedFirstPublicationId');
  expect(JSON.stringify(input)).toBe(before);
});

describe('native copy review fingerprints', () => {
  it('hashes canonical UTF-8 bytes without depending on object insertion order', async () => {
    const facts = { z: ['café', null, true, 2], a: '🙂', ignored: undefined };
    const expected = 'sha256:b431e60a48463fb50fd34650e58fbe93e39db28574e52e2e7c9499df93c320e8';
    expect(await fingerprintCopyFacts(facts)).toBe(expected);
    expect(await fingerprintCopyFacts({ a: facts.a, z: facts.z })).toBe(expected);
    expect(await fingerprintCopyFacts({ ...facts, z: [...facts.z].reverse() })).not.toBe(expected);
  });

  it.each([
    { capability: 'crypto', value: undefined },
    { capability: 'crypto', value: {} },
    { capability: 'TextEncoder', value: undefined },
  ])('refuses unavailable native $capability support', async ({ capability, value }) => {
    vi.stubGlobal(capability, value);
    try {
      await expect(fingerprintCopyFacts({ name: 'Reviewed outline' })).rejects.toMatchObject({
        code: 'blueprint_invalid',
        message: 'Copy review requires native SHA-256 support.',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
