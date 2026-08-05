/**
 * The reconciler's rules, exercised with no database at all.
 *
 * @remarks
 * These run against an in-memory {@link MentionStorage}, which is the point of the ports: the
 * domain rules — which links become edges, which are refused, how positions are numbered — are
 * decisions this module makes, not facts about Postgres. Testing them here means a rule change
 * fails in milliseconds against a fake instead of minutes against a migrated database, and the
 * companion suite over the real adapter is left to prove the SQL.
 */
import { describe, expect, it } from 'vitest';

import { formatMentionLink, type MentionEntityKind, type MentionSubjectType } from '@docket/types';

import { createMentionReconciler } from '../../src/content/reconcile-mentions';
import type {
  MentionDraft,
  MentionStorage,
  MentionSubject,
  MentionSubjectRow,
  ResourceDraft,
  StoredResource,
} from '../../src/content/mention-ports';

/** What a fake run recorded, so assertions read against intent rather than rows. */
interface FakeState {
  /** The edges most recently written, by `subjectType:subjectId`. */
  readonly written: Map<string, readonly MentionDraft[]>;
  /** Every resource created, by canonical key. */
  readonly resources: Map<string, ResourceDraft>;
  /** Subjects whose edges were dropped wholesale. */
  readonly deleted: string[];
}

/** Build storage that lives entirely in memory. */
function fakeStorage(input: {
  prose?: MentionSubjectRow;
  existingEntities?: ReadonlySet<string>;
}): { storage: MentionStorage; state: FakeState } {
  const state: FakeState = { written: new Map(), resources: new Map(), deleted: [] };
  const key = (subject: MentionSubject) => `${subject.subjectType}:${subject.subjectId}`;

  const storage: MentionStorage = {
    mentions: {
      listForSubject: (subject) =>
        Promise.resolve(
          (state.written.get(key(subject)) ?? []).map((draft, index) => ({
            id: `m_${String(index)}`,
            field: draft.field,
            position: draft.position,
            label: draft.label,
            targetKind: draft.ref.kind,
            targetEntityKind: draft.ref.kind === 'entity' ? draft.ref.entityKind : null,
            targetEntityId: draft.ref.kind === 'entity' ? draft.ref.entityId : null,
            externalResourceId: draft.externalResourceId ?? null,
          })),
        ),
      replaceForSubject: (subject, _createdBy, desired) => {
        state.written.set(key(subject), desired);
        return Promise.resolve();
      },
      deleteForSubject: (subjectType: MentionSubjectType, subjectId: string) => {
        state.deleted.push(`${subjectType}:${subjectId}`);
        return Promise.resolve();
      },
    },
    resources: {
      findOrCreate: (draft) => {
        state.resources.set(draft.canonicalKey, draft);
        return Promise.resolve(`res_${draft.canonicalKey}`);
      },
      findByIds: (): Promise<readonly StoredResource[]> => Promise.resolve([]),
      findByKeys: (): Promise<readonly StoredResource[]> => Promise.resolve([]),
    },
    subjects: {
      read: () => Promise.resolve(input.prose),
      entityExists: (_orgId, entityKind: MentionEntityKind, entityId: string) =>
        Promise.resolve(input.existingEntities?.has(`${entityKind}:${entityId}`) ?? false),
    },
  };
  return { storage, state };
}

/** The edges written for the one project these tests use. */
function edgesFor(state: FakeState): readonly MentionDraft[] {
  return state.written.get('project:p1') ?? [];
}

async function reconcileProse(
  description: string,
  existingEntities?: ReadonlySet<string>,
): Promise<FakeState> {
  const { storage, state } = fakeStorage({
    prose: { createdBy: 'actor_1', prose: { description } },
    ...(existingEntities === undefined ? {} : { existingEntities }),
  });
  await createMentionReconciler(storage).reconcile('org_1', 'project', 'p1');
  return state;
}

describe('the reconciler, with no database', () => {
  it('writes nothing for prose with no links', async () => {
    expect(edgesFor(await reconcileProse('Just words.'))).toEqual([]);
  });

  it('turns a marked external link into an edge and creates its resource', async () => {
    const url = 'https://www.notion.so/Plan-1f2e3d4c5b6a7988990a1b2c3d4e5f60';
    const state = await reconcileProse(
      `See ${formatMentionLink('The plan', url, { kind: 'external', url })}.`,
    );

    expect(edgesFor(state)).toHaveLength(1);
    expect(edgesFor(state)[0]?.label).toBe('The plan');
    // Keyed by the source's own id, so the same page linked another way is one resource.
    expect([...state.resources.keys()]).toEqual(['notion:1f2e3d4c5b6a7988990a1b2c3d4e5f60']);
    expect(state.resources.get('notion:1f2e3d4c5b6a7988990a1b2c3d4e5f60')?.provider).toBe('notion');
  });

  it('keeps a plainly pasted URL, so a bare link still carries metadata', async () => {
    const state = await reconcileProse('Background: https://example.com/handbook');
    expect(edgesFor(state)).toHaveLength(1);
    expect(state.resources.get('web:https://example.com/handbook')?.provider).toBe('web');
  });

  it('numbers edges by their order within the field', async () => {
    const a = 'https://example.com/a';
    const b = 'https://example.com/b';
    const state = await reconcileProse(
      [
        formatMentionLink('A', a, { kind: 'external', url: a }),
        formatMentionLink('B', b, { kind: 'external', url: b }),
      ].join('\n\n'),
    );
    expect(edgesFor(state).map((edge) => [edge.position, edge.label])).toEqual([
      [0, 'A'],
      [1, 'B'],
    ]);
  });

  it('keeps an entity reference whose target exists in this organization', async () => {
    const ref = { kind: 'entity', entityKind: 'task', entityId: 't1' } as const;
    const state = await reconcileProse(
      formatMentionLink('Ship it', '/orgs/org_1/tasks/t1', ref),
      new Set(['task:t1']),
    );
    expect(edgesFor(state)).toHaveLength(1);
    expect(edgesFor(state)[0]?.ref).toEqual(ref);
  });

  it('refuses an entity reference whose target is not in this organization', async () => {
    const ref = { kind: 'entity', entityKind: 'task', entityId: 'foreign' } as const;
    // The storage reports no such entity here, which is what a cross-tenant id looks like.
    const state = await reconcileProse(
      formatMentionLink('Secret', '/orgs/other/tasks/foreign', ref),
      new Set(),
    );
    expect(edgesFor(state)).toEqual([]);
  });

  it('ignores a link inside a fenced code block', async () => {
    const state = await reconcileProse(
      ['```md', '[example](https://example.com/nope)', '```'].join('\n'),
    );
    expect(edgesFor(state)).toEqual([]);
  });

  it('refuses to make a script-bearing href into a reference', async () => {
    const state = await reconcileProse('[Click](javascript:alert(1) "docket:v1:external")');
    expect(edgesFor(state)).toEqual([]);
  });

  it('writes an empty set when the author removes every link', async () => {
    const state = await reconcileProse('Nothing here now.');
    // Replace-with-empty, not "skip the write": the store must end up matching the prose.
    expect(state.written.has('project:p1')).toBe(true);
    expect(edgesFor(state)).toEqual([]);
  });

  it('drops every edge when the subject row is gone', async () => {
    const { storage, state } = fakeStorage({});
    await createMentionReconciler(storage).reconcile('org_1', 'project', 'p1');
    expect(state.deleted).toEqual(['project:p1']);
  });

  it('does nothing at all for a table that carries no prose', async () => {
    const { storage, state } = fakeStorage({
      prose: { createdBy: null, prose: { description: 'x' } },
    });
    await createMentionReconciler(storage).reconcile('org_1', 'label', 'l1');
    expect(state.written.size).toBe(0);
    expect(state.deleted).toEqual([]);
  });

  it('deletes edges for a removed subject without reading its prose', async () => {
    const { storage, state } = fakeStorage({});
    await createMentionReconciler(storage).deleteForSubject('project', 'p1');
    expect(state.deleted).toEqual(['project:p1']);
  });
});
