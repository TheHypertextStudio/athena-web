import { describe, expect, it } from 'vitest';
import {
  nativeScheduleSnapshotFilter,
  requireNativeScheduleFacts,
  type NativeScheduleFacts,
} from '../../src/lib/recurrence/schedule-native-facts';
import type { TemplateTransaction } from '../../src/lib/templates/persistence';
import type { BlueprintSnapshotRow } from '../../src/lib/work-template-blueprints/snapshot-types';
import { assertNativeInitiatingWork } from '../../src/lib/recurrence/schedule-native-caller';
import { nativeOriginReferences } from '../../src/lib/recurrence/schedule-native-origins';
import type { BlueprintOccurrenceRoot } from '@docket/db';

function row(
  id: string,
  path: string[] = [],
  parentId: string | null = null,
): BlueprintSnapshotRow {
  return {
    work: {
      kind: 'task',
      id,
      row: {
        blueprintStepId: parentId ? 'original-step' : null,
        blueprintSourceVersionId: parentId ? 'original-version' : null,
        blueprintPath: path,
        blueprintParentKind: parentId ? 'task' : null,
        blueprintParentId: parentId,
      },
    },
    parent: parentId ? { kind: 'task', id: parentId } : null,
  } as BlueprintSnapshotRow;
}
describe('native exact occurrence capabilities', () => {
  it('binds nested work to its exact publication scope and does not read unrelated optional source steps', () => {
    const roots = [
      {
        key: 'root',
        kind: 'task',
        id: 'actual-root',
        resolvedManifest: [
          { path: [], versionId: 'root-version', workTypeId: 'root-template' },
          { path: ['vendor'], versionId: 'vendor-version', workTypeId: 'vendor-template' },
        ],
        selectedWork: [
          { kind: 'task', id: 'actual-root', path: [] },
          { kind: 'task', id: 'actual-vendor', path: ['vendor'] },
          { kind: 'task', id: 'actual-deposit', path: ['vendor', 'deposit'] },
        ],
      },
    ] as unknown as BlueprintOccurrenceRoot[];
    expect(nativeOriginReferences(roots)).toEqual([
      { id: 'actual-vendor', kind: 'task', versionId: 'root-version', key: 'vendor' },
      { id: 'actual-deposit', kind: 'task', versionId: 'vendor-version', key: 'deposit' },
    ]);
  });
  it('rejects an unrelated foreground row even when it shares the occurrence workspace or logical path', () => {
    const roots = [
      {
        key: 'root',
        kind: 'task' as const,
        id: 'actual-root',
        selectedWork: [{ kind: 'task' as const, id: 'actual-child', path: ['child'] }],
      },
    ];
    expect(() => {
      assertNativeInitiatingWork(roots, { kind: 'task', id: 'unrelated-child' });
    }).toThrow();
    expect(() => {
      assertNativeInitiatingWork(roots, { kind: 'project', id: 'actual-child' });
    }).toThrow();
    expect(() => {
      assertNativeInitiatingWork(roots, { kind: 'task', id: 'actual-child' });
    }).not.toThrow();
  });
  it('rejects forged and JSON-copied authority on any transaction', () => {
    const authority = { kind: 'native-schedule-occurrence' as const, proof: {} };
    expect(() => requireNativeScheduleFacts({} as TemplateTransaction, authority)).toThrow();
    expect(() =>
      requireNativeScheduleFacts(
        {} as TemplateTransaction,
        JSON.parse(JSON.stringify(authority)) as typeof authority,
      ),
    ).toThrow();
  });
  it('retains the actual selected child while rejecting a replacement at its old path', () => {
    const facts = {
      originKeys: new Map([['original-child', new Set(['original-version:original-step'])]]),
      roots: [
        {
          key: 'root',
          kind: 'task',
          id: 'root',
          selectedWork: [
            { kind: 'task', id: 'root', path: [] },
            { kind: 'task', id: 'original-child', path: ['child'] },
          ],
        },
      ],
    } as unknown as NativeScheduleFacts;
    const accept = nativeScheduleSnapshotFilter(facts);
    expect(accept(row('root'))).toBe(true);
    expect(accept(row('replacement', ['child'], 'root'))).toBe(false);
    expect(accept(row('original-child', ['child'], 'root'))).toBe(true);
  });
  it('rejects a selected identity with changed immutable origin or missing actual containment', () => {
    const facts = {
      originKeys: new Map([['child', new Set(['original-version:original-step'])]]),
      roots: [
        {
          key: 'root',
          kind: 'task',
          id: 'root',
          selectedWork: [{ kind: 'task', id: 'child', path: ['child'] }],
        },
      ],
    } as unknown as NativeScheduleFacts;
    const accept = nativeScheduleSnapshotFilter(facts);
    expect(accept(row('root'))).toBe(true);
    expect(accept(row('child', ['different'], 'root'))).toBe(false);
    expect(accept(row('child', ['child'], 'other-root'))).toBe(false);
    const forged = row('child', ['child'], 'root');
    forged.work.row.blueprintSourceVersionId = 'unrelated-publication';
    expect(accept(forged)).toBe(false);
  });
});
