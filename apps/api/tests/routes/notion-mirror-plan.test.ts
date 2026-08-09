import { describe, expect, it } from 'vitest';

import {
  contentChanged,
  isLocallyDirty,
  isRemoteEdited,
  planMirrorRow,
  type MirrorLocalRow,
  type MirrorRemoteRow,
} from '../../src/routes/notion-mirror-plan';

const T0 = new Date('2026-08-08T10:00:00.000Z');
const T1 = new Date('2026-08-08T11:00:00.000Z');
const T2 = new Date('2026-08-08T12:00:00.000Z');

function local(over: Partial<MirrorLocalRow> = {}): MirrorLocalRow {
  return {
    entityId: 'task_1',
    externalPageId: 'page_1',
    updatedAt: T0,
    externalUpdatedAt: T0,
    lastPushedAt: T0,
    contentHash: 'hash_a',
    archived: false,
    ...over,
  };
}

function remote(over: Partial<MirrorRemoteRow> = {}): MirrorRemoteRow {
  return {
    externalPageId: 'page_1',
    externalUpdatedAt: T0.toISOString(),
    archived: false,
    ...over,
  };
}

describe('isLocallyDirty', () => {
  it('treats a never-pushed row as dirty', () => {
    // There is nothing in Notion for it to be up to date with.
    expect(isLocallyDirty(local({ lastPushedAt: null }))).toBe(true);
  });

  it('is clean when the entity has not changed since the push', () => {
    expect(isLocallyDirty(local({ updatedAt: T0, lastPushedAt: T0 }))).toBe(false);
  });

  it('is dirty when the entity changed after the push', () => {
    expect(isLocallyDirty(local({ updatedAt: T1, lastPushedAt: T0 }))).toBe(true);
  });
});

describe('isRemoteEdited', () => {
  it('does not treat our own write as a remote edit', () => {
    // THE echo guard. Docket's push bumps `last_edited_time`; comparing against the anchor rather
    // than against our own write would make every push look like a remote change and loop
    // forever: push, observe "remote newer", pull, push again.
    expect(
      isRemoteEdited(local({ lastPushedAt: T1 }), remote({ externalUpdatedAt: T1.toISOString() })),
    ).toBe(false);
  });

  it('sees an edit made after our write', () => {
    expect(
      isRemoteEdited(local({ lastPushedAt: T0 }), remote({ externalUpdatedAt: T1.toISOString() })),
    ).toBe(true);
  });

  it('ignores an edit older than our write', () => {
    expect(
      isRemoteEdited(local({ lastPushedAt: T1 }), remote({ externalUpdatedAt: T0.toISOString() })),
    ).toBe(false);
  });

  it('falls back to the anchor when the row was never pushed', () => {
    expect(
      isRemoteEdited(
        local({ lastPushedAt: null, externalUpdatedAt: T0 }),
        remote({ externalUpdatedAt: T1.toISOString() }),
      ),
    ).toBe(true);
    expect(
      isRemoteEdited(
        local({ lastPushedAt: null, externalUpdatedAt: T1 }),
        remote({ externalUpdatedAt: T0.toISOString() }),
      ),
    ).toBe(false);
  });

  it('treats an unparseable timestamp as no edit rather than as a change', () => {
    // Guessing "edited" on a malformed value would pull garbage over good local data.
    expect(isRemoteEdited(local(), remote({ externalUpdatedAt: 'not a date' }))).toBe(false);
  });
});

describe('planMirrorRow — the two-way matrix', () => {
  it('does nothing when neither side changed', () => {
    expect(planMirrorRow(local(), remote(), 'two_way')).toEqual({ kind: 'noop' });
  });

  it('pulls a one-sided remote change without calling it a conflict', () => {
    // Docket winning contested edits must not stop Docket from learning uncontested ones.
    expect(
      planMirrorRow(
        local({ updatedAt: T0, lastPushedAt: T0 }),
        remote({ externalUpdatedAt: T1.toISOString() }),
        'two_way',
      ),
    ).toEqual({ kind: 'pull' });
  });

  it('pushes a one-sided local change', () => {
    expect(planMirrorRow(local({ updatedAt: T1, lastPushedAt: T0 }), remote(), 'two_way')).toEqual({
      kind: 'push',
    });
  });

  it('pushes and records a conflict when both sides changed', () => {
    const action = planMirrorRow(
      local({ updatedAt: T1, lastPushedAt: T0 }),
      remote({ externalUpdatedAt: T2.toISOString() }),
      'two_way',
    );
    expect(action.kind).toBe('push');
    expect(action.kind === 'push' ? action.conflict?.reason : null).toBe('contested_edit');
  });

  it('lets Docket win even when the remote edit is strictly newer', () => {
    // The whole point. Last-write-wins here would mean the tool Docket is replacing can still
    // overwrite it, which is not a replacement.
    const action = planMirrorRow(
      local({ updatedAt: T1, lastPushedAt: T0 }),
      remote({ externalUpdatedAt: T2.toISOString() }),
      'two_way',
    );
    expect(action.kind).toBe('push');
  });
});

describe('planMirrorRow — projection-only entities', () => {
  it('records drift rather than reverting it silently', () => {
    // A revert the user cannot see is indistinguishable from data loss.
    const action = planMirrorRow(
      local({ updatedAt: T0, lastPushedAt: T0 }),
      remote({ externalUpdatedAt: T1.toISOString() }),
      'push',
    );
    expect(action.kind).toBe('push');
    expect(action.kind === 'push' ? action.conflict?.reason : null).toBe('push_only_drift');
  });

  it('stays quiet when nobody touched the page', () => {
    expect(planMirrorRow(local(), remote(), 'push')).toEqual({ kind: 'noop' });
  });

  it('never adopts a row created in Notion', () => {
    // A projection is Docket's to write; a row somebody added there is not Docket's to claim.
    expect(planMirrorRow(undefined, remote(), 'push')).toEqual({ kind: 'noop' });
  });

  it('re-creates a page somebody trashed', () => {
    expect(planMirrorRow(local(), remote({ archived: true }), 'push')).toEqual({ kind: 'create' });
  });
});

describe('planMirrorRow — deletions', () => {
  it('trashes the page when the Docket entity is archived', () => {
    expect(planMirrorRow(local({ archived: true }), remote(), 'two_way')).toEqual({
      kind: 'trash',
    });
  });

  it('does nothing when both sides are already gone', () => {
    expect(planMirrorRow(local({ archived: true }), remote({ archived: true }), 'two_way')).toEqual(
      { kind: 'noop' },
    );
  });

  it('adopts a remote tombstone on a two-way entity', () => {
    // A trashed page cannot be revived by pushing values at it.
    expect(planMirrorRow(local(), remote({ archived: true }), 'two_way')).toEqual({
      kind: 'archiveLocal',
    });
  });

  it('adopts a row created in Notion on a two-way entity', () => {
    expect(planMirrorRow(undefined, remote(), 'two_way')).toEqual({ kind: 'adopt' });
  });

  it('ignores a page that was created and trashed between reads', () => {
    expect(planMirrorRow(undefined, remote({ archived: true }), 'two_way')).toEqual({
      kind: 'noop',
    });
  });
});

describe('planMirrorRow — absence', () => {
  it('treats a row missing from an incremental read as unchanged, never as deleted', () => {
    // An incremental query returns only what changed. Reading absence as deletion would archive
    // the entire workspace on the first quiet sync.
    expect(planMirrorRow(local(), undefined, 'two_way')).toEqual({ kind: 'noop' });
    expect(planMirrorRow(local(), undefined, 'push')).toEqual({ kind: 'noop' });
  });

  it('still pushes an unpushed local change when the row was not read', () => {
    expect(planMirrorRow(local({ updatedAt: T1, lastPushedAt: T0 }), undefined, 'two_way')).toEqual(
      { kind: 'push' },
    );
  });

  it('does nothing when there is neither a local row nor a remote page', () => {
    expect(planMirrorRow(undefined, undefined, 'two_way')).toEqual({ kind: 'noop' });
  });
});

describe('contentChanged', () => {
  it('skips a write whose values are identical', () => {
    // Notion allows ~3 requests a second. A redundant write is budget taken from a row that
    // genuinely changed, not merely a wasted millisecond.
    expect(contentChanged(local({ contentHash: 'hash_a' }), 'hash_a')).toBe(false);
  });

  it('writes when the values differ', () => {
    expect(contentChanged(local({ contentHash: 'hash_a' }), 'hash_b')).toBe(true);
  });

  it('writes when nothing has ever been projected', () => {
    expect(contentChanged(local({ contentHash: null }), 'hash_a')).toBe(true);
  });
});
