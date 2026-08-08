import { describe, expect, it } from 'vitest';

import { normalizeSunsamaTask, type SunsamaTask } from '../../src/sunsama';
import { SUNSAMA_FIXTURE_TASKS } from '../../src/sunsama-fixtures';
import type { SunsamaWorkspaceRouting } from '../../src/sunsama-mapping';
import {
  SUNSAMA_PROVENANCE_PROVIDER,
  groupSunsamaImportedItemsByWorkspace,
  sunsamaAccountToImportedItems,
  sunsamaTaskToImportedItem,
} from '../../src/sunsama-connector';

/** Every fixture task, normalized. */
const TASKS: SunsamaTask[] = SUNSAMA_FIXTURE_TASKS.map((raw) => {
  const task = normalizeSunsamaTask(raw);
  if (task === null) throw new Error('fixture task failed to normalize');
  return task;
});

const ROUTING: SunsamaWorkspaceRouting = {
  label: 'Sunsama fixture account',
  routes: [
    { streamId: 'str-transit', workspace: 'Las Vegans for Better Transit' },
    { streamId: 'str-newsletter', workspace: 'The Willie Diaries' },
    { streamId: 'str-personal', workspace: 'Personal Life' },
    { streamId: 'str-docket', workspace: 'Hypertext Studio' },
  ],
  fallbackWorkspace: 'Personal Life',
  expectedFallbackTaskCount: 1,
};

const IMPORTED_AT = '2026-08-02T00:00:00.000Z';

function task(id: string): SunsamaTask {
  const found = TASKS.find((t) => t.id === id);
  if (found === undefined) throw new Error(`fixture task ${id} missing`);
  return found;
}

describe('sunsamaTaskToImportedItem', () => {
  it('produces the connector-port item reconcileTasks writes, stamped with real provenance', () => {
    const result = sunsamaTaskToImportedItem(task('su-001'), ROUTING, IMPORTED_AT);
    expect(result.workspace).toBe('Las Vegans for Better Transit');
    expect(result.item).toEqual({
      id: 'su-001',
      kind: 'issue',
      title: 'Send the contractor agreement',
      body: 'Legal wants it this week. Attach the signed W-9.',
      completed: false,
      dueDate: '2026-08-08',
      // su-001 is a backlog item: explicitly no planned day, and a real 45-minute estimate.
      startDate: null,
      estimateMinutes: 45,
      provenance: {
        provider: SUNSAMA_PROVENANCE_PROVIDER,
        externalId: 'su-001',
        importedAt: IMPORTED_AT,
        externalUpdatedAt: '2026-07-30T09:12:00.000Z',
      },
    });
  });

  it('carries the planned day as startDate and the estimate as estimateMinutes on the item itself', () => {
    const planned = sunsamaTaskToImportedItem(task('su-004'), ROUTING, IMPORTED_AT);
    expect(planned.item.startDate).toBe('2026-08-03');
    expect(planned.item.estimateMinutes).toBe(90);
  });

  it('stamps the provenance provider as "sunsama" — never a real ConnectorProviderId', () => {
    expect(SUNSAMA_PROVENANCE_PROVIDER).toBe('sunsama');
  });

  it('omits `body` (never writes an empty string) when Sunsama notes are blank', () => {
    const result = sunsamaTaskToImportedItem(task('su-003'), ROUTING, IMPORTED_AT);
    expect(result.item.body).toBeUndefined();
  });

  it('omits externalUrl when the source integration string is not a real URL', () => {
    // su-005's integration string is `github:hypertext-studio/athena-web#412` — NOT an
    // absolute http(s) URL — so it must not appear as externalUrl (mapSunsamaTask already
    // keeps it as preserved metadata instead; see sunsama-mapping.test.ts).
    const notAUrl = sunsamaTaskToImportedItem(task('su-005'), ROUTING, IMPORTED_AT);
    expect(notAUrl.item.provenance.externalUrl).toBeUndefined();
  });

  it('carries externalUrl when the source integration string IS a real URL', () => {
    const raw = normalizeSunsamaTask({
      id: 'su-url',
      title: 'Follow up on the RFP',
      integration: 'https://github.com/hypertext-studio/athena-web/issues/9',
      updatedAt: '2026-07-31T00:00:00.000Z',
    });
    if (raw === null) throw new Error('fixture task failed to normalize');
    const withUrl = sunsamaTaskToImportedItem(raw, ROUTING, IMPORTED_AT);
    expect(withUrl.item.provenance.externalUrl).toBe(
      'https://github.com/hypertext-studio/athena-web/issues/9',
    );
  });

  it('omits externalUpdatedAt when Sunsama never reported a modification time', () => {
    const raw = normalizeSunsamaTask({ id: 'su-noupdate', title: 'Untimed task' });
    if (raw === null) throw new Error('fixture task failed to normalize');
    const result = sunsamaTaskToImportedItem(raw, ROUTING, IMPORTED_AT);
    expect(result.item.provenance.externalUpdatedAt).toBeUndefined();
  });

  it('turns each subtask into its own child item, linked to the parent and keeping its completion', () => {
    const result = sunsamaTaskToImportedItem(task('su-001'), ROUTING, IMPORTED_AT);
    expect(result.childItems).toEqual([
      {
        id: 'sub-001a',
        kind: 'issue',
        title: 'Attach the W-9',
        completed: true,
        parentExternalId: 'su-001',
        provenance: {
          provider: SUNSAMA_PROVENANCE_PROVIDER,
          externalId: 'sub-001a',
          importedAt: IMPORTED_AT,
          externalUpdatedAt: '2026-07-30T09:12:00.000Z',
        },
      },
      {
        id: 'sub-001b',
        kind: 'issue',
        title: 'Send for signature',
        completed: false,
        parentExternalId: 'su-001',
        provenance: {
          provider: SUNSAMA_PROVENANCE_PROVIDER,
          externalId: 'sub-001b',
          importedAt: IMPORTED_AT,
          externalUpdatedAt: '2026-07-30T09:12:00.000Z',
        },
      },
    ]);
  });

  it('synthesizes a stable child id when Sunsama supplied none, so a re-run still matches', () => {
    const raw = normalizeSunsamaTask({
      id: 'su-anon',
      title: 'Parent with an id-less subtask',
      subtasks: [{ title: 'The subtask', completed: false }],
    });
    if (raw === null) throw new Error('fixture task failed to normalize');
    const result = sunsamaTaskToImportedItem(raw, ROUTING, IMPORTED_AT);
    expect(result.childItems.map((c) => c.provenance.externalId)).toEqual(['su-anon/subtask-1']);
    expect(result.childItems[0]?.parentExternalId).toBe('su-anon');
  });

  it('produces no child items for a task with no subtasks', () => {
    const bare = sunsamaTaskToImportedItem(task('su-002'), ROUTING, IMPORTED_AT);
    expect(bare.childItems).toEqual([]);
  });
});

describe('sunsamaAccountToImportedItems', () => {
  it('maps every active task in the account, in order', () => {
    const mapped = sunsamaAccountToImportedItems(TASKS, ROUTING, IMPORTED_AT);
    expect(mapped).toHaveLength(TASKS.length);
    expect(mapped.map((m) => m.item.provenance.externalId)).toEqual(TASKS.map((t) => t.id));
  });
});

describe('groupSunsamaImportedItemsByWorkspace', () => {
  it('groups mapped tasks by destination workspace, with each child row in its parent’s bucket', () => {
    const mapped = sunsamaAccountToImportedItems(TASKS, ROUTING, IMPORTED_AT);
    const groups = groupSunsamaImportedItemsByWorkspace(mapped);

    const counts: Record<string, number> = {};
    for (const [workspace, items] of groups) counts[workspace] = items.length;

    // Parent counts match the routing report (3/2/1/1); the transit bucket additionally carries
    // su-001's two subtasks and su-004's one as child items.
    expect(counts).toEqual({
      'Las Vegans for Better Transit': 6,
      'The Willie Diaries': 2,
      'Hypertext Studio': 1,
      'Personal Life': 1,
    });
  });

  it('puts every child immediately after its parent, so one reconcile pass can link them', () => {
    const mapped = sunsamaAccountToImportedItems(TASKS, ROUTING, IMPORTED_AT);
    const groups = groupSunsamaImportedItemsByWorkspace(mapped);
    const transit = groups.get('Las Vegans for Better Transit') ?? [];
    for (const item of transit) {
      if (typeof item.parentExternalId !== 'string') continue;
      const parentIndex = transit.findIndex(
        (candidate) => candidate.provenance.externalId === item.parentExternalId,
      );
      expect(parentIndex).toBeGreaterThanOrEqual(0);
      expect(parentIndex).toBeLessThan(transit.indexOf(item));
    }
  });

  it('returns an empty map for an empty input, never a map with an empty-array entry', () => {
    expect(groupSunsamaImportedItemsByWorkspace([]).size).toBe(0);
  });
});
