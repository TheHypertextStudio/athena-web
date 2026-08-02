/**
 * `@docket/types` — the task slice's data-integrity guarantees at the DTO boundary.
 *
 * @remarks
 * The bar these tests hold is the author's: "There shouldn't be such a thing as an invalid date.
 * Any data stored by Docket should have strong constraints." A date is invalid here if it is
 * malformed, names a day that does not exist, falls outside a range anyone could mean, or closes
 * a window that never opened. Every one of those must be a rejection at the API boundary, not a
 * row someone has to clean up later.
 *
 * Also covers the two exported helpers the surfaces tier consumes: {@link taskOriginLabel} (the
 * decision that "Native" is removed rather than renamed) and {@link taskCreationEntryId}.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  SubtaskCreate,
  TASK_DATE_MAX,
  TASK_DATE_MIN,
  TaskCreate,
  TaskUpdate,
  taskCreationEntryId,
  taskOriginLabel,
} from '../../src/task';

/** A minimal valid create body; individual tests override the field under examination. */
const BASE_CREATE = { title: 'Write the brief', teamId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' } as const;

/** Pull the field paths a failed parse complained about. */
function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('task dates — a stored date always names a possible day', () => {
  it.each([
    ['a day that does not exist in a 30-day month', '2026-04-31'],
    ['February 30th', '2026-02-30'],
    ['February 29th of a non-leap year', '2025-02-29'],
    ['a month past December', '2026-13-01'],
    ['an unpadded day', '2026-9-5'],
    ['a full timestamp where a calendar day is meant', '2026-09-15T00:00:00.000Z'],
    ['free text', 'next tuesday'],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(TaskCreate.safeParse({ ...BASE_CREATE, dueDate: value }).success).toBe(false);
    expect(TaskUpdate.safeParse({ dueDate: value }).success).toBe(false);
    expect(SubtaskCreate.safeParse({ title: 'x', dueDate: value }).success).toBe(false);
  });

  it('accepts a real leap day, and the exact range boundaries', () => {
    for (const day of ['2024-02-29', TASK_DATE_MIN, TASK_DATE_MAX]) {
      expect(TaskUpdate.safeParse({ dueDate: day }).success).toBe(true);
    }
  });

  it('rejects a year no one could have meant, naming the field that carried it', () => {
    // The realistic origin of these is a typo (`0226` for `2026`) or a paste of a sentinel value.
    // They parse as timestamps and then sort to one end of every list forever.
    const early = TaskUpdate.safeParse({ startDate: '0226-05-01' });
    expect(early.success).toBe(false);
    expect(issuePaths(early)).toEqual(['startDate']);

    const late = TaskCreate.safeParse({ ...BASE_CREATE, dueDate: '9999-12-31' });
    expect(late.success).toBe(false);
    expect(issuePaths(late)).toEqual(['dueDate']);
  });

  it('rejects a window that closes before it opens, blaming the due date', () => {
    const result = TaskCreate.safeParse({
      ...BASE_CREATE,
      startDate: '2026-09-10',
      dueDate: '2026-09-01',
    });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(['dueDate']);
  });

  it('accepts a task due on the very day it starts', () => {
    expect(
      TaskCreate.safeParse({ ...BASE_CREATE, startDate: '2026-09-10', dueDate: '2026-09-10' })
        .success,
    ).toBe(true);
  });

  it('leaves a single-sided edit alone, because the other day is not in the request', () => {
    // Judging this one would mean reading the stored row from inside a schema. The route compares
    // against its pre-image instead (`assertTaskWindowOrdered`), and the DTO stays a pure function
    // of its input.
    expect(TaskUpdate.safeParse({ dueDate: '2026-01-01' }).success).toBe(true);
    expect(TaskUpdate.safeParse({ startDate: '2026-12-31' }).success).toBe(true);
  });

  it('treats clearing either day as valid, since a cleared window cannot be backwards', () => {
    expect(TaskUpdate.safeParse({ startDate: null, dueDate: null }).success).toBe(true);
    expect(TaskUpdate.safeParse({ startDate: null, dueDate: '2026-01-01' }).success).toBe(true);
  });
});

describe('anticipated start date', () => {
  it('is a first-class field on every task write body, separate from the due date', () => {
    const created = TaskCreate.safeParse({
      ...BASE_CREATE,
      startDate: '2026-09-10',
      dueDate: '2026-09-30',
    });
    expect(created.success).toBe(true);
    expect(created.data).toMatchObject({ startDate: '2026-09-10', dueDate: '2026-09-30' });

    // …including on a subtask and on an update, and it can be cleared independently.
    expect(SubtaskCreate.safeParse({ title: 'x', startDate: '2026-09-10' }).success).toBe(true);
    const cleared = TaskUpdate.safeParse({ startDate: null });
    expect(cleared.success).toBe(true);
    expect(cleared.data).toEqual({ startDate: null });
  });

  it('is described to API consumers in the product’s own words, as a date-only field', () => {
    // ENT-20 is about a concept, not a column: whatever the schema calls it, the published API
    // must offer "an anticipated start date" so a reader looking for one finds it. Asserting on
    // the emitted JSON Schema also proves the cross-field refinement did not cost the field its
    // `format: date` in the OpenAPI document.
    const emitted = z.toJSONSchema(TaskCreate, { io: 'input' }) as {
      properties: Record<string, { description?: string; format?: string }>;
    };
    expect(emitted.properties['startDate']?.description).toMatch(/anticipated start date/i);
    expect(emitted.properties['startDate']?.format).toBe('date');
    expect(emitted.properties['dueDate']?.format).toBe('date');
  });
});

describe('taskOriginLabel — the "Native" decision', () => {
  it('has nothing to say about a task that originated in Docket', () => {
    // The recorded decision: "Native" is REMOVED, not renamed. A null label is what makes
    // "render no row" the obvious branch for a surface.
    expect(taskOriginLabel({ source: 'native' }, null)).toBeNull();
    expect(taskOriginLabel({ source: 'native' }, 'GitHub')).toBeNull();
  });

  it('names the tool a linked task was copied from', () => {
    expect(taskOriginLabel({ source: 'linked' }, 'GitHub')).toBe('Linked from GitHub');
    expect(taskOriginLabel({ source: 'linked' }, 'Linear')).toBe('Linked from Linear');
  });

  it('stays plain-language when the integration cannot be resolved', () => {
    // A disconnected or deleted integration must not degrade into a blank row or a raw id.
    expect(taskOriginLabel({ source: 'linked' }, null)).toBe('Linked from another tool');
    expect(taskOriginLabel({ source: 'linked' }, '')).toBe('Linked from another tool');
  });

  it('never returns the word the author objected to', () => {
    const rendered = [
      taskOriginLabel({ source: 'native' }, 'GitHub'),
      taskOriginLabel({ source: 'linked' }, 'GitHub'),
      taskOriginLabel({ source: 'linked' }, null),
    ];
    for (const label of rendered) expect(label ?? '').not.toMatch(/native/i);
  });
});

describe('taskCreationEntryId', () => {
  it('produces a stable key that cannot collide with a ULID', () => {
    expect(taskCreationEntryId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(
      'created:01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
    // A ULID is 26 uppercase Crockford-base32 characters and contains no colon, so the prefix
    // keeps the projected entry distinguishable from every stored one.
    expect(taskCreationEntryId('x')).toContain(':');
  });
});
