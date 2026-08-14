import { describe, expect, it } from 'vitest';

import { normalizeSunsamaTask, type SunsamaTask } from '../../src/sunsama';
import { SUNSAMA_FIXTURE_TASKS } from '../../src/sunsama-fixtures';
import {
  DOCKET_WORKSPACE_NAMES,
  SUNSAMA_FIELD_MAPPING,
  type SunsamaWorkspaceRouting,
  mapSunsamaTask,
  routeSunsamaTask,
  validateSunsamaRouting,
  verifySunsamaRouting,
} from '../../src/sunsama-mapping';
import { assertDefined } from '@docket/test-utils';

/** Every fixture task, normalized. */
const TASKS: SunsamaTask[] = SUNSAMA_FIXTURE_TASKS.map((raw) => {
  const task = normalizeSunsamaTask(raw);
  if (task === null) throw new Error('fixture task failed to normalize');
  return task;
});

/** The routing declaration the fixture account is migrated under. */
const ROUTING: SunsamaWorkspaceRouting = {
  label: 'Sunsama fixture account',
  routes: [
    { streamId: 'str-transit', workspace: 'Las Vegans for Better Transit' },
    { streamId: 'str-newsletter', workspace: 'The Willie Diaries' },
    { streamId: 'str-personal', workspace: 'Personal Life' },
    { streamId: 'str-docket', workspace: 'Hypertext Studio' },
  ],
  fallbackWorkspace: 'Personal Life',
  // Declared BEFORE the run: exactly one fixture task ("Renew the PO box") carries no stream.
  expectedFallbackTaskCount: 1,
};

describe('SUNSAMA_FIELD_MAPPING', () => {
  it('accounts for every field the normalizer produces — no silent drops', () => {
    const probe = normalizeSunsamaTask({ id: 'x', title: 'y' });
    if (probe === null) throw new Error('probe failed');
    const sourceFields = new Set(SUNSAMA_FIELD_MAPPING.map((entry) => entry.source));
    for (const key of Object.keys(probe)) {
      expect(sourceFields.has(key as keyof SunsamaTask)).toBe(true);
    }
  });

  it('gives every unmappable field a written reason rather than an empty cell', () => {
    for (const entry of SUNSAMA_FIELD_MAPPING) {
      if (entry.destination !== null) continue;
      expect(entry.note).toMatch(/UNMAPPED/);
      expect(entry.note.length).toBeGreaterThan(40);
    }
  });

  it('has at least one documented unmappable field (the list is not vacuously satisfied)', () => {
    expect(SUNSAMA_FIELD_MAPPING.filter((e) => e.destination === null).length).toBeGreaterThan(0);
  });
});

describe('workspace routing', () => {
  it('accepts a declaration that names only the eight real workspaces', () => {
    expect(validateSunsamaRouting(ROUTING)).toEqual([]);
  });

  it('rejects a destination that is not one of the eight', () => {
    expect(
      validateSunsamaRouting({
        ...ROUTING,
        routes: [...ROUTING.routes, { streamId: 'str-x', workspace: 'Ninth Workspace' as never }],
      }),
    ).toContainEqual({ code: 'unknown-workspace', subject: 'Ninth Workspace' });
  });

  it('rejects two routes for the same stream', () => {
    expect(
      validateSunsamaRouting({
        ...ROUTING,
        routes: [...ROUTING.routes, { streamId: 'str-transit', workspace: 'Project Oasis' }],
      }),
    ).toContainEqual({ code: 'duplicate-route', subject: 'str-transit' });
  });

  it('rejects a declaration whose fallback workspace is not one of the eight', () => {
    expect(
      validateSunsamaRouting({ ...ROUTING, fallbackWorkspace: 'Made Up Workspace' as never }),
    ).toContainEqual({ code: 'unknown-workspace', subject: 'Made Up Workspace' });
  });

  it('rejects a route that names neither a stream id nor a stream name', () => {
    expect(
      validateSunsamaRouting({
        ...ROUTING,
        routes: [...ROUTING.routes, { workspace: 'Project Oasis' }],
      }),
    ).toContainEqual({ code: 'empty-route', subject: '(no stream id or name)' });
  });

  it('routes by stream id, and by name when the id is unknown', () => {
    const byName: SunsamaWorkspaceRouting = {
      ...ROUTING,
      routes: [{ streamName: 'Weekly newsletter', workspace: 'The Willie Diaries' }],
    };
    const task: SunsamaTask = {
      ...assertDefined(TASKS[0]),
      streamIds: ['unknown-id'],
      streamNames: ['weekly NEWSLETTER'],
    };
    expect(routeSunsamaTask(task, byName)).toEqual({
      workspace: 'The Willie Diaries',
      usedFallback: false,
    });
  });

  it('falls back to the declared workspace when neither a stream id nor a stream name matches', () => {
    const task: SunsamaTask = {
      ...assertDefined(TASKS[0]),
      streamIds: ['completely-unknown-id'],
      streamNames: ['Not A Real Stream Name'],
    };
    expect(routeSunsamaTask(task, ROUTING)).toEqual({
      workspace: ROUTING.fallbackWorkspace,
      usedFallback: true,
    });
  });

  it('lands every task in a real workspace — none is ever unrouted', () => {
    const report = verifySunsamaRouting(TASKS, ROUTING);
    expect(report.unroutedCount).toBe(0);
    const total = Object.values(report.perWorkspace).reduce((s, n) => s + n, 0);
    expect(total).toBe(TASKS.length);
  });

  it('matches the fallback count the declaration promised BEFORE the run', () => {
    const report = verifySunsamaRouting(TASKS, ROUTING);
    expect(report.fallbackCount).toBe(1);
    expect(report.matchesDeclaration).toBe(true);
  });

  it('fails the declaration check when reality disagrees with the promise', () => {
    const report = verifySunsamaRouting(TASKS, { ...ROUTING, expectedFallbackTaskCount: 0 });
    expect(report.matchesDeclaration).toBe(false);
    expect(report.fallbackCount).toBe(1);
  });

  it('spreads the fixture account across the workspaces its streams name', () => {
    const report = verifySunsamaRouting(TASKS, ROUTING);
    expect(report.perWorkspace).toEqual({
      'Las Vegans for Better Transit': 3,
      'The Willie Diaries': 2,
      'Hypertext Studio': 1,
      // The one stream-less task took the declared fallback.
      'Personal Life': 1,
    });
  });

  it('names the eight workspaces character-for-character', () => {
    expect(DOCKET_WORKSPACE_NAMES).toEqual([
      'Personal Life',
      'The Willie Diaries',
      'Las Vegans for Better Transit',
      'Reasonable Tech Company',
      'Hypertext Studio',
      'Rebuilding America Project',
      'Project Oasis',
      'Willie Enterprises (dba Vibe Code Cleanup Company)',
    ]);
  });
});

describe('mapSunsamaTask', () => {
  it('maps the planned day to startDate and the due date to dueDate — never conflated', () => {
    const planned = TASKS.find((t) => t.id === 'su-004');
    if (planned === undefined) throw new Error('fixture missing');
    const mapped = mapSunsamaTask(planned, ROUTING);
    expect(mapped.startDate).toBe('2026-08-03');
    expect(mapped.dueDate).toBe('2026-08-05');
    expect(mapped.estimateMinutes).toBe(90);
    expect(mapped.workspace).toBe('Las Vegans for Better Transit');
  });

  it('turns each subtask into a child task keeping its own id and completion', () => {
    const withSubtasks = TASKS.find((t) => t.id === 'su-001');
    if (withSubtasks === undefined) throw new Error('fixture missing');
    expect(mapSunsamaTask(withSubtasks, ROUTING).children).toEqual([
      { id: 'sub-001a', title: 'Attach the W-9', completed: true },
      { id: 'sub-001b', title: 'Send for signature', completed: false },
    ]);
  });

  it('never produces a blank child title — a child row faces the same not-blank CHECK', () => {
    const blankChild: SunsamaTask = {
      ...assertDefined(TASKS[0]),
      subtasks: [{ id: 'sub-blank', title: '   ', completed: false }],
    };
    expect(mapSunsamaTask(blankChild, ROUTING).children).toEqual([
      { id: 'sub-blank', title: 'Untitled task', completed: false },
    ]);
  });

  it('preserves every unmappable field on the record instead of dropping it', () => {
    const recurring = TASKS.find((t) => t.id === 'su-006');
    if (recurring === undefined) throw new Error('fixture missing');
    const mapped = mapSunsamaTask(recurring, ROUTING);
    expect(mapped.preserved).toMatchObject({
      recurringDefinitionId: 'rec-newsletter-monday',
      sunsamaCreatedAt: '2026-05-01T09:00:00.000Z',
      sunsamaStreamIds: ['str-newsletter'],
    });
  });

  it('keeps a non-URL integration string as preserved metadata, not as an externalUrl', () => {
    const integrated = TASKS.find((t) => t.id === 'su-005');
    if (integrated === undefined) throw new Error('fixture missing');
    const mapped = mapSunsamaTask(integrated, ROUTING);
    expect(mapped.externalUrl).toBeNull();
    expect(mapped.preserved['sunsamaSourceIntegration']).toBe(
      'github:hypertext-studio/athena-web#412',
    );
  });

  it('carries the Sunsama id and modification time as the sync anchors', () => {
    const mapped = mapSunsamaTask(assertDefined(TASKS[0]), ROUTING);
    expect(mapped.externalId).toBe('su-001');
    expect(mapped.externalUpdatedAt).toBe('2026-07-30T09:12:00.000Z');
  });

  it('never produces a blank title (Docket’s task title is NOT NULL and not-blank)', () => {
    const blank: SunsamaTask = { ...assertDefined(TASKS[0]), title: '   ' };
    expect(mapSunsamaTask(blank, ROUTING).title).toBe('Untitled task');
  });
});
