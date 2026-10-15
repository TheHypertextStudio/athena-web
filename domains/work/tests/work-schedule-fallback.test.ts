import { describe, expect, it } from 'vitest';
import { WorkScheduleRevisionFallback } from '../src/contracts/work-schedule-fallback';

const id = '01M4Y1B4B5V04E5ANJQ5QHTEZ8';
function fallback() {
  return {
    kind: 'schedule_fallback',
    revision: 1,
    seriesRevisionId: id,
    sourceInvocationId: null,
    draftFingerprint: `sha256:${'a'.repeat(64)}`,
    roots: [
      {
        key: 'dinner',
        kind: 'project',
        workTypeId: id,
        versionId: id,
        resolvedManifest: [
          { path: [], workTypeId: id, versionId: id },
          { path: ['venue'], workTypeId: id, versionId: id },
        ],
        optionalChoices: [],
        selectedPaths: [
          { path: [], kind: 'project' },
          { path: ['venue'], kind: 'task' },
        ],
      },
    ],
  };
}
describe('private revision authoring fallback', () => {
  it('stores the full validated publication closure without a fabricated run context', () => {
    const saved = WorkScheduleRevisionFallback.parse(fallback());
    expect(saved.roots[0]?.resolvedManifest).toHaveLength(2);
    expect(saved.seriesRevisionId).toBe(id);
    expect(saved.sourceInvocationId).toBeNull();
  });
  it('refuses root-only fallback when a nested Task was selected', () => {
    const root = fallback().roots[0];
    if (!root) throw new Error('Missing test root.');
    expect(
      WorkScheduleRevisionFallback.safeParse({
        ...fallback(),
        roots: [{ ...root, resolvedManifest: [root.resolvedManifest[0]] }],
      }).success,
    ).toBe(false);
  });
  it('refuses client archive flags, ordinary latest selections and occurrence date fields', () => {
    for (const patch of [
      { archived: true },
      { runDate: '2026-10-08' },
      { selection: { kind: 'latest' } },
    ])
      expect(WorkScheduleRevisionFallback.safeParse({ ...fallback(), ...patch }).success).toBe(
        false,
      );
  });
});
