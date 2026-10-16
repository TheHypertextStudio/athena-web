import { describe, expect, it } from 'vitest';
import { genId } from '@docket/db';
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
