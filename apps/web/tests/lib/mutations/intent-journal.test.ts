import { describe, expect, it, vi } from 'vitest';
import { deferred } from '../../support/deferred';
import {
  createIntentJournal,
  type FieldSnapshot,
  type IntentJournal,
} from '../../../src/lib/mutations';

const key = { scope: 'task:1', field: 'title' } as const;
const snapshot = (
  journal: IntentJournal<string>,
  field: string = key.field,
): FieldSnapshot<string> => journal.getSnapshot(key.scope, field);

describe('IntentJournal', () => {
  it('projects a local value synchronously before delivery resolves', () => {
    const transport = deferred<string>();
    const journal = createIntentJournal<string>();
    journal.setAuthoritative(key.scope, key.field, 'Old');
    const handle = journal.apply({ ...key, value: 'New', deliver: () => transport.promise });

    expect(snapshot(journal)).toMatchObject({
      value: 'New',
      authoritative: 'Old',
      status: 'syncing',
    });
    expect(handle.version).toBe(1);
  });

  it('keeps fields independent and stale settlements cannot clobber newer intent', async () => {
    const titleOne = deferred<string>();
    const titleTwo = deferred<string>();
    const journal = createIntentJournal<string>();
    journal.setAuthoritative(key.scope, 'title', 'Old title');
    journal.setAuthoritative(key.scope, 'status', 'Open');
    const first = journal.apply({ ...key, value: 'First', deliver: () => titleOne.promise });
    const second = journal.apply({ ...key, value: 'Second', deliver: () => titleTwo.promise });
    journal.apply({
      scope: key.scope,
      field: 'status',
      value: 'Done',
      deliver: () => Promise.resolve('Done'),
    });
    titleOne.resolve('First');
    await titleOne.promise;

    expect(snapshot(journal)).toMatchObject({
      value: 'Second',
      status: 'syncing',
      version: second.version,
    });
    expect(snapshot(journal, 'status')).toMatchObject({ value: 'Done', status: 'settled' });
    expect(first.version).toBe(1);
  });

  it('coalesces delivery per field while showing every local patch immediately', async () => {
    const first = deferred<string>();
    const calls: string[] = [];
    const journal = createIntentJournal<string>();
    journal.setAuthoritative(key.scope, key.field, 'Old');
    journal.apply({
      ...key,
      value: 'A',
      deliver: (value) => {
        calls.push(value);
        return first.promise;
      },
    });
    journal.apply({
      ...key,
      value: 'B',
      deliver: (value) => {
        calls.push(value);
        return Promise.resolve(value);
      },
    });
    expect(snapshot(journal).value).toBe('B');
    expect(calls).toEqual(['A']);
    first.resolve('A');
    await first.promise;
    await Promise.resolve();
    expect(calls).toEqual(['A', 'B']);
  });

  it('retains a refused value for retry or discard, and reconciles the base beneath a live overlay', async () => {
    const refusal = deferred<string>();
    const calls: string[] = [];
    const journal = createIntentJournal<string>();
    journal.setAuthoritative(key.scope, key.field, 'Old');
    const handle = journal.apply({
      ...key,
      value: 'Attempt',
      deliver: (value) => {
        calls.push(value);
        return refusal.promise;
      },
    });
    journal.reconcile(key.scope, key.field, 'Fresh from server');
    expect(snapshot(journal)).toMatchObject({
      value: 'Attempt',
      authoritative: 'Fresh from server',
      status: 'syncing',
    });
    refusal.reject(new Error('refused'));
    await expect(refusal.promise).rejects.toThrow();
    await Promise.resolve();
    expect(snapshot(journal)).toMatchObject({ value: 'Attempt', status: 'needs_attention' });
    const retry = handle.retry();
    expect(snapshot(journal)).toMatchObject({
      value: 'Attempt',
      status: 'syncing',
      version: retry.version,
    });
    expect(calls).toEqual(['Attempt', 'Attempt']);
    retry.discard();
    expect(snapshot(journal)).toMatchObject({ value: 'Fresh from server', status: 'settled' });
  });

  it('notifies subscribers without retaining settled entries', async () => {
    const listener = vi.fn();
    const journal = createIntentJournal<string>();
    journal.subscribe(listener);
    journal.setAuthoritative(key.scope, key.field, 'Old');
    journal.apply({ ...key, value: 'New', deliver: () => Promise.resolve('New') });
    await Promise.resolve();
    await Promise.resolve();
    expect(listener).toHaveBeenCalled();
    expect(journal.size).toBe(0);
  });

  it('does not let an older response replace a newer authoritative value', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const journal = createIntentJournal<string>();
    journal.setAuthoritative(key.scope, key.field, 'Old');
    journal.apply({ ...key, value: 'A', deliver: () => first.promise });
    const newer = journal.apply({ ...key, value: 'B', deliver: () => second.promise });
    first.resolve('Server A');
    await first.promise;
    second.resolve('Server B');
    await second.promise;
    await Promise.resolve();
    expect(newer.version).toBe(2);
    expect(journal.getSnapshot(key.scope, key.field).authoritative).toBe('Server B');
  });

  it('keeps a fresh authoritative refresh above the in-flight response it supersedes', async () => {
    const response = deferred<string>();
    const journal = createIntentJournal<string>();
    journal.setAuthoritative(key.scope, key.field, 'Old');
    journal.apply({ ...key, value: 'Local', deliver: () => response.promise });
    journal.reconcile(key.scope, key.field, 'Fresh');
    response.resolve('Stale response');
    await response.promise;
    await Promise.resolve();
    expect(journal.getSnapshot(key.scope, key.field).authoritative).toBe('Fresh');
  });

  it('ignores manual settlement for a queued version', () => {
    const hold = deferred<string>();
    const journal = createIntentJournal<string>();
    journal.setAuthoritative(key.scope, key.field, 'Old');
    journal.apply({ ...key, value: 'A', deliver: () => hold.promise });
    const queued = journal.apply({ ...key, value: 'B', deliver: () => Promise.resolve('B') });
    queued.settleSuccess('wrong');
    expect(snapshot(journal)).toMatchObject({ value: 'B', status: 'syncing' });
    hold.resolve('A');
  });
});
