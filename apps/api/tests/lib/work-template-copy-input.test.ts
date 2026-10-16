import { describe, expect, it } from 'vitest';
import { genId } from '@docket/db';
import { ValidationError } from '../../src/error';
import { parseCopyBundleAcceptance } from '../../src/lib/templates/copy-reservation-input';
const hash = `sha256:${'1'.repeat(64)}`;
const source = () => ({
  kind: 'draft' as const,
  organizationId: genId(),
  workTypeId: genId(),
  draftRevision: 0,
  draftFingerprint: hash,
});
const acceptance = () => ({
  requestId: 'copy-request',
  reviewFingerprint: hash,
  mode: 'private_drafts' as const,
  roots: ['root'],
  entries: [
    {
      key: 'child',
      kind: 'task' as const,
      source: source(),
      sourceFingerprint: hash,
      dependencies: [],
    },
    {
      key: 'root',
      kind: 'task' as const,
      source: source(),
      sourceFingerprint: hash,
      dependencies: ['child'],
    },
  ],
});
describe('bounded trusted copy reservation input', () => {
  it('accepts actual unpublished revision zero and dependency-first source facts', () => {
    expect(parseCopyBundleAcceptance(acceptance()).entries[0]?.source).toMatchObject({
      kind: 'draft',
      draftRevision: 0,
    });
  });
  it('rejects mismatched current source fingerprints and executable-looking draft identities', () => {
    const input = acceptance();
    expect(() =>
      parseCopyBundleAcceptance({
        ...input,
        entries: [{ ...input.entries[0], sourceFingerprint: `sha256:${'2'.repeat(64)}` }],
      }),
    ).toThrow();
    expect(() =>
      parseCopyBundleAcceptance({
        ...input,
        entries: [{ ...input.entries[0], source: { ...source(), workTypeVersionId: genId() } }],
      }),
    ).toThrow();
  });
  it('rejects missing, duplicated, cyclic and disconnected entry identities', () => {
    const input = acceptance();
    expect(() => parseCopyBundleAcceptance({ ...input, roots: ['missing'] })).toThrow();
    expect(() =>
      parseCopyBundleAcceptance({ ...input, entries: [input.entries[1], input.entries[0]] }),
    ).toThrow();
    expect(() =>
      parseCopyBundleAcceptance({ ...input, entries: [input.entries[0], input.entries[0]] }),
    ).toThrow();
    expect(() => parseCopyBundleAcceptance({ ...input, roots: ['child'] })).toThrow();
  });
  it('rejects source team/owner transfer and more than100 copied definitions', () => {
    expect(() => parseCopyBundleAcceptance({ ...acceptance(), ownerActorId: genId() })).toThrow();
    expect(() =>
      parseCopyBundleAcceptance({
        ...acceptance(),
        entries: Array.from({ length: 101 }, (_, i) => ({
          key: `entry${i}`,
          kind: 'task' as const,
          source: source(),
          sourceFingerprint: hash,
          dependencies: [],
        })),
      }),
    ).toThrow();
  });
});

it('binds explicit choice fingerprints and defaults only omitted choices to the reviewed facts', () => {
  const input = acceptance();
  expect(parseCopyBundleAcceptance(input).choicesFingerprint).toBe(hash);
  const choicesFingerprint = `sha256:${'3'.repeat(64)}`;
  expect(parseCopyBundleAcceptance({ ...input, choicesFingerprint }).choicesFingerprint).toBe(
    choicesFingerprint,
  );
});

it('refuses duplicate source identities, duplicate dependency edges and duplicate roots', () => {
  const input = acceptance(),
    [child, root] = input.entries;
  if (!child || !root) throw new Error('Missing graph fixture');
  for (const changed of [
    { ...input, entries: [child, { ...root, source: child.source }] },
    { ...input, entries: [child, { ...root, dependencies: ['child', 'child'] }] },
    { ...input, roots: ['root', 'root'] },
  ]) {
    expect(() => parseCopyBundleAcceptance(changed)).toThrow(ValidationError);
  }
});

it('accepts the exact edge budget and refuses a larger complete dependency-first graph', () => {
  let remaining = 2000;
  const entries = Array.from({ length: 100 }, (_, index) => {
    const count = Math.min(index, remaining);
    remaining -= count;
    return {
      key: `entry${index}`,
      kind: 'task' as const,
      source: source(),
      sourceFingerprint: hash,
      dependencies: Array.from({ length: count }, (_, dependency) => `entry${dependency}`),
    };
  });
  const input = { ...acceptance(), roots: entries.map((entry) => entry.key), entries };
  expect(remaining).toBe(0);
  expect(parseCopyBundleAcceptance(input).entries).toHaveLength(100);
  const last = entries[99];
  if (!last) throw new Error('Missing graph boundary');
  last.dependencies.push('entry0');
  expect(() => parseCopyBundleAcceptance(input)).toThrow(ValidationError);
});
