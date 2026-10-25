import { describe, expect, it } from 'vitest';
import { BlueprintError } from '@docket/work/blueprints';
import {
  applyScheduleRootClears,
  validateSchedulePlacement,
} from '../../src/lib/recurrence/schedule-placement';
import { scheduleFailureCode } from '../../src/lib/recurrence/schedule-runtime';
import {
  AuthError,
  CapabilityError,
  ConflictError,
  NotFoundError,
  RateLimitedError,
} from '../../src/error';
import type { TemplateTransaction } from '../../src/lib/templates/persistence';
import type { OrdinaryWorkCommand, PreparedOrdinaryWork } from '../../src/lib/work-creation/types';

/** Stored destination rows returned, in order, by each `select … limit` lookup. */
type LookupRows = Record<string, unknown>[];

interface PlacementShape {
  readonly kind?: 'task' | 'project';
  readonly body?: Record<string, unknown>;
  readonly owner?: string | null;
  readonly scheduled?: boolean;
}

function lookups(results: LookupRows[]): { tx: TemplateTransaction; reads: () => number } {
  let reads = 0;
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => {
      reads++;
      return Promise.resolve(results.shift() ?? []);
    },
  };
  return { tx: { select: () => chain } as unknown as TemplateTransaction, reads: () => reads };
}

function command({
  kind = 'task',
  body = {},
  owner = 'program-a',
  scheduled = true,
}: PlacementShape = {}): OrdinaryWorkCommand {
  return {
    kind,
    caller: { orgId: 'org', actorId: 'actor' },
    body,
    invocation: {
      placement: owner ? { programId: owner } : undefined,
      scheduleContext: scheduled ? { runDate: '2026-10-08' } : undefined,
    },
  } as unknown as OrdinaryWorkCommand;
}

describe('schedule destination placement', () => {
  it('skips stored lookups for unscheduled, unowned, or Project creation', async () => {
    for (const shape of [{ scheduled: false }, { owner: null }, { kind: 'project' as const }]) {
      const { tx, reads } = lookups([]);
      await expect(
        validateSchedulePlacement(tx, command({ ...shape, body: { projectId: 'p' } })),
      ).resolves.toBeUndefined();
      expect(reads()).toBe(0);
    }
  });

  it('accepts a destination Project inside the owning Program', async () => {
    const { tx, reads } = lookups([[{ programId: 'program-a' }]]);
    await expect(
      validateSchedulePlacement(tx, command({ body: { projectId: 'p' } })),
    ).resolves.toBeUndefined();
    expect(reads()).toBe(1);
  });

  it('refuses a destination Project in another Program or no longer live', async () => {
    await expect(
      validateSchedulePlacement(
        lookups([[{ programId: 'program-b' }]]).tx,
        command({ body: { projectId: 'p' } }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      validateSchedulePlacement(lookups([[]]).tx, command({ body: { projectId: 'p' } })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('accepts a parent Task owned directly or through its Project', async () => {
    await expect(
      validateSchedulePlacement(
        lookups([[{ programId: 'program-a', projectId: null }]]).tx,
        command({ body: { parentTaskId: 't' } }),
      ),
    ).resolves.toBeUndefined();
    const nested = lookups([[{ programId: null, projectId: 'p' }], [{ programId: 'program-a' }]]);
    await expect(
      validateSchedulePlacement(nested.tx, command({ body: { parentTaskId: 't' } })),
    ).resolves.toBeUndefined();
    expect(nested.reads()).toBe(2);
  });

  it('refuses a missing, unowned, or differently placed parent Task', async () => {
    await expect(
      validateSchedulePlacement(lookups([[]]).tx, command({ body: { parentTaskId: 't' } })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      validateSchedulePlacement(
        lookups([[{ programId: null, projectId: null }]]).tx,
        command({ body: { parentTaskId: 't' } }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      validateSchedulePlacement(
        lookups([[{ programId: 'program-a' }], [{ programId: 'program-a', projectId: 'q' }]]).tx,
        command({ body: { projectId: 'p', parentTaskId: 't' } }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('schedule root clears', () => {
  function prepared(kind: string): PreparedOrdinaryWork {
    return { insert: { kind, values: { summary: 'kept' } } } as unknown as PreparedOrdinaryWork;
  }
  function cleared(summary: string | null | undefined, hasDraft = true): OrdinaryWorkCommand {
    return {
      invocation: {
        scheduleContext: hasDraft ? { draft: { root: { fields: { summary } } } } : {},
      },
    } as unknown as OrdinaryWorkCommand;
  }
  function summaryOf(root: PreparedOrdinaryWork): unknown {
    return (root.insert.values as { summary?: unknown }).summary;
  }

  it('applies an explicit null summary to Task and Project roots', () => {
    const root = prepared('task');
    applyScheduleRootClears(cleared(null), root);
    expect(summaryOf(root)).toBeNull();
  });

  it('keeps the prepared summary when the draft omits it, has no draft, or targets a Milestone', () => {
    for (const [command, root] of [
      [cleared(undefined), prepared('project')],
      [cleared(null, false), prepared('project')],
      [cleared(null), prepared('milestone')],
    ] as const) {
      applyScheduleRootClears(command, root);
      expect(summaryOf(root)).toBe('kept');
    }
  });
});

describe('schedule failure classification', () => {
  it('maps owned errors to stable run failure codes', () => {
    expect(scheduleFailureCode(new BlueprintError('blueprint_limit', 'limit'))).toBe(
      'schedule_limit',
    );
    expect(scheduleFailureCode(new BlueprintError('blueprint_invalid', 'invalid'))).toBe(
      'schedule_invalid',
    );
    expect(scheduleFailureCode(new CapabilityError())).toBe('schedule_permission_changed');
    expect(scheduleFailureCode(new AuthError())).toBe('schedule_permission_changed');
    expect(scheduleFailureCode(new NotFoundError('gone'))).toBe('schedule_unavailable');
    expect(scheduleFailureCode(new ConflictError('changed'))).toBe('schedule_invalid');
    expect(scheduleFailureCode(new RateLimitedError(30))).toBe('schedule_invalid');
    expect(scheduleFailureCode(new Error('provider'))).toBe('schedule_execution_failed');
  });
});
