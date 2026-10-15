import { describe, expect, it } from 'vitest';
import { AcceptedScheduleClaim } from '../src/contracts/work-schedule-claim';
const id = '01M4Y1B4B5V04E5ANJQ5QHTEZ8';
const otherId = '01M4Y1B4B5V04E5ANJQ5QHTEZ9';
function root(key = 'dinner', children = 1) {
  return {
    key,
    kind: 'project',
    workTypeId: id,
    versionId: id,
    resolvedManifest: [{ path: [], workTypeId: id, versionId: id }],
    optionalChoices: [],
    selectedPaths: [
      { path: [], kind: 'project' },
      ...Array.from({ length: children }, (_, i) => ({ path: [`step_${i}`], kind: 'milestone' })),
    ],
  };
}
function claim() {
  return {
    kind: 'schedule',
    revision: 1,
    sourceInvocationId: null,
    seriesRevisionId: id,
    runDate: '2026-10-08',
    timezone: 'America/Los_Angeles',
    draftFingerprint: `sha256:${'a'.repeat(64)}`,
    roots: [root()],
  };
}
describe('accepted schedule claim before work transaction', () => {
  it('retains exact publication closure and selected Milestones without generated IDs', () => {
    expect(AcceptedScheduleClaim.parse(claim())).toEqual(claim());
  });
  it('accepts500 selected nodes and refuses501 across all roots', () => {
    expect(
      AcceptedScheduleClaim.parse({ ...claim(), roots: [root('a', 249), root('b', 249)] }).roots,
    ).toHaveLength(2);
    expect(
      AcceptedScheduleClaim.safeParse({ ...claim(), roots: [root('a', 250), root('b', 249)] })
        .success,
    ).toBe(false);
  });
  it('refuses missing, duplicate or mismatched root publication', () => {
    for (const resolvedManifest of [
      [],
      [root().resolvedManifest[0], root().resolvedManifest[0]],
      [{ path: [], workTypeId: id, versionId: otherId }],
    ])
      expect(
        AcceptedScheduleClaim.safeParse({ ...claim(), roots: [{ ...root(), resolvedManifest }] })
          .success,
      ).toBe(false);
  });
  it('refuses selected path duplicates, orphan paths and kind mismatch', () => {
    for (const selectedPaths of [
      [{ path: [], kind: 'task' }],
      [
        { path: [], kind: 'project' },
        { path: [], kind: 'project' },
      ],
      [
        { path: [], kind: 'project' },
        { path: ['missing', 'child'], kind: 'task' },
      ],
    ])
      expect(
        AcceptedScheduleClaim.safeParse({ ...claim(), roots: [{ ...root(), selectedPaths }] })
          .success,
      ).toBe(false);
  });
  it('refuses a selected Task whose exact publication is missing from the accepted closure', () => {
    const accepted = {
      ...root(),
      selectedPaths: [
        { path: [], kind: 'project' },
        { path: ['book_venue'], kind: 'task' },
      ],
    };
    expect(AcceptedScheduleClaim.safeParse({ ...claim(), roots: [accepted] }).success).toBe(false);
    expect(
      AcceptedScheduleClaim.safeParse({
        ...claim(),
        roots: [
          {
            ...accepted,
            resolvedManifest: [
              ...accepted.resolvedManifest,
              { path: ['book_venue'], workTypeId: otherId, versionId: otherId },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });
  it('refuses duplicate root keys, duplicate choices and physical work IDs', () => {
    expect(AcceptedScheduleClaim.safeParse({ ...claim(), roots: [root(), root()] }).success).toBe(
      false,
    );
    const optionalChoices = [
      { path: ['step_0'], selected: true },
      { path: ['step_0'], selected: false },
    ];
    expect(
      AcceptedScheduleClaim.safeParse({ ...claim(), roots: [{ ...root(), optionalChoices }] })
        .success,
    ).toBe(false);
    expect(
      AcceptedScheduleClaim.safeParse({ ...claim(), roots: [{ ...root(), id }] }).success,
    ).toBe(false);
    expect(
      AcceptedScheduleClaim.safeParse({
        ...claim(),
        roots: [{ ...root(), selectedPaths: [{ path: [], kind: 'project', id }] }],
      }).success,
    ).toBe(false);
  });
  it('refuses invalid context, unbound latest selections and malformed fingerprints', () => {
    for (const patch of [
      { runDate: '2026-02-29' },
      { timezone: 'not/a-zone' },
      { draftFingerprint: 'a'.repeat(64) },
      { sourceInvocationId: undefined },
    ])
      expect(AcceptedScheduleClaim.safeParse({ ...claim(), ...patch }).success).toBe(false);
    expect(
      AcceptedScheduleClaim.safeParse({
        ...claim(),
        roots: [{ ...root(), selection: { kind: 'latest' } }],
      }).success,
    ).toBe(false);
  });
});
