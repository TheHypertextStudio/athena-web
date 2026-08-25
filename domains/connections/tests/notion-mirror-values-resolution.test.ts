import type { NotionColumnBinding, NotionMirrorEntity } from '../src/notion/mirror-contract';
import { describe, expect, it } from 'vitest';

import {
  projectRow,
  resolveMirrorValues,
  type MirrorReferences,
  type MirrorSourceValue,
} from '../src/notion/mirror-values';

const bind = (over: Partial<NotionColumnBinding> = {}): NotionColumnBinding => ({
  field: 'title',
  title: 'Name',
  kind: 'title',
  order: 0,
  propertyId: 'pid_title',
  ...over,
});

describe('resolveMirrorValues', () => {
  /** Build a reference context with the given per-entity pages. */
  const context = (
    over: Partial<{
      notionUserByActor: Map<string, string>;
      pages: [NotionMirrorEntity, { pageByEntityId: Map<string, string>; settled: boolean }][];
    }> = {},
  ): MirrorReferences => ({
    notionUserByActor: over.notionUserByActor ?? new Map(),
    pages: new Map(over.pages ?? []),
  });

  /** Nothing projected yet: every entity present but empty, so a miss is "not written yet". */
  const NOBODY: MirrorReferences = context({
    pages: [['person', { pageByEntityId: new Map(), settled: false }]],
  });
  const KNOWN: MirrorReferences = context({
    notionUserByActor: new Map([['act_1', 'notion-user-1']]),
    pages: [['person', { pageByEntityId: new Map([['act_1', 'people-page-1']]), settled: false }]],
  });
  const assignee = (over: Partial<NotionColumnBinding> = {}): NotionColumnBinding =>
    bind({ field: 'assignee', title: 'Assignee', kind: 'rich_text', propertyId: 'pid_a', ...over });
  const ref = (actorId: string | null, displayName: string | null): MirrorSourceValue => ({
    kind: 'actor',
    actorId,
    displayName,
  });

  it('renders a person as a name when the column is plain text', () => {
    const binding = assignee({ representation: 'text' });
    const out = resolveMirrorValues([binding], { assignee: ref('act_1', 'Sam S') }, KNOWN);
    expect(out.values['assignee']).toEqual({ kind: 'text', value: 'Sam S' });
    expect(out.unresolved).toEqual([]);
  });

  it('renders a matched person as the native Notion user', () => {
    const binding = assignee({ kind: 'people', representation: undefined });
    const out = resolveMirrorValues([binding], { assignee: ref('act_1', 'Sam S') }, KNOWN);
    expect(out.values['assignee']).toEqual({ kind: 'people', externalIds: ['notion-user-1'] });
  });

  it('writes an unmatched person as an honest empty, and says it will never resolve', () => {
    // The column's documented meaning is "the matched subset", and the name sits in the column
    // beside it — so empty is the truth here, and retrying would not change it.
    const binding = assignee({ kind: 'people', representation: undefined });
    const out = resolveMirrorValues([binding], { assignee: ref('act_2', 'No Notion') }, KNOWN);
    expect(out.values['assignee']).toEqual({ kind: 'people', externalIds: [] });
    expect(out.unresolved).toEqual([
      { field: 'assignee', targetId: 'act_2', reason: 'no_notion_account', retryable: false },
    ]);
  });

  it('renders a person as a relation to their row in the People database', () => {
    const binding = assignee({ kind: 'relation', representation: 'docket_people_table' });
    const out = resolveMirrorValues([binding], { assignee: ref('act_1', 'Sam S') }, KNOWN);
    expect(out.values['assignee']).toEqual({
      kind: 'relation',
      externalPageIds: ['people-page-1'],
    });
  });

  it('OMITS a relation whose People row is not written yet, rather than clearing it', () => {
    // The distinction the whole resolver turns on. An empty relation CLEARS the Notion property,
    // which for "I don't know yet" would confidently erase a cell somebody may have filled in.
    const binding = assignee({ kind: 'relation', representation: 'docket_people_table' });
    const out = resolveMirrorValues([binding], { assignee: ref('act_1', 'Sam S') }, NOBODY);
    expect(out.values['assignee']).toBeUndefined();
    expect(out.unresolved).toEqual([
      { field: 'assignee', targetId: 'act_1', reason: 'person_page_missing', retryable: true },
    ]);
  });

  it('clears the property when there genuinely is no assignee', () => {
    // The other side of that distinction: nobody assigned is a KNOWN empty, and must clear.
    for (const [kind, representation, expected] of [
      ['rich_text', 'text', { kind: 'text', value: null }],
      ['people', undefined, { kind: 'people', externalIds: [] }],
      ['relation', 'docket_people_table', { kind: 'relation', externalPageIds: [] }],
    ] as const) {
      const binding = assignee({ kind, representation });
      const out = resolveMirrorValues([binding], { assignee: ref(null, null) }, NOBODY);
      expect(out.values['assignee']).toEqual(expected);
      expect(out.unresolved).toEqual([]);
    }
  });

  it('passes non-person values through untouched', () => {
    const out = resolveMirrorValues(
      [bind()],
      { title: { kind: 'text', value: 'Ship it' } },
      NOBODY,
    );
    expect(out.values['title']).toEqual({ kind: 'text', value: 'Ship it' });
  });

  const labels = (over: Partial<NotionColumnBinding> = {}): NotionColumnBinding =>
    bind({ field: 'labels', title: 'Labels', kind: 'relation', propertyId: 'pid_l', ...over });
  const related = (entity: NotionMirrorEntity, ids: readonly string[]): MirrorSourceValue => ({
    kind: 'reference',
    entity,
    entityIds: ids,
  });
  const pagesFor = (
    entity: NotionMirrorEntity,
    entries: readonly [string, string][],
    settled: boolean,
  ): MirrorReferences =>
    context({ pages: [[entity, { pageByEntityId: new Map(entries), settled }]] });

  it('renders a relation as the target rows page ids', () => {
    const out = resolveMirrorValues(
      [labels()],
      { labels: related('label', ['lab_1', 'lab_2']) },
      pagesFor(
        'label',
        [
          ['lab_1', 'page-1'],
          ['lab_2', 'page-2'],
        ],
        true,
      ),
    );
    expect(out.values['labels']).toEqual({
      kind: 'relation',
      externalPageIds: ['page-1', 'page-2'],
    });
    expect(out.unresolved).toEqual([]);
  });

  it('clears a relation with nothing on the other end', () => {
    // A known empty, so it must CLEAR: the labels really were removed.
    const out = resolveMirrorValues([labels()], { labels: related('label', []) }, NOBODY);
    expect(out.values['labels']).toEqual({ kind: 'relation', externalPageIds: [] });
    expect(out.unresolved).toEqual([]);
  });

  it('omits a to-one relation whose target is not written yet', () => {
    const out = resolveMirrorValues(
      [labels()],
      { labels: related('label', ['lab_1']) },
      pagesFor('label', [], false),
    );
    expect(out.values['labels']).toBeUndefined();
    expect(out.unresolved).toEqual([
      { field: 'labels', targetId: 'lab_1', reason: 'related_page_missing', retryable: true },
    ]);
  });

  it('omits a PARTIALLY resolvable set rather than silently dropping the rest', () => {
    // Writing just the resolvable half would look complete in Notion while quietly losing a
    // label. Deferring the whole cell costs one pass and loses nothing.
    const out = resolveMirrorValues(
      [labels()],
      { labels: related('label', ['lab_1', 'lab_2']) },
      pagesFor('label', [['lab_1', 'page-1']], false),
    );
    expect(out.values['labels']).toBeUndefined();
    expect(out.unresolved).toEqual([
      { field: 'labels', targetId: 'lab_2', reason: 'related_page_missing', retryable: true },
    ]);
  });

  it('writes what it can once the target is settled, and stops retrying the rest', () => {
    // The counterpart: a settled target means the missing ids are ones it never projects — an
    // agent on a team, an archived record. Deferring forever would keep the pass incomplete for
    // good, so the resolvable remainder is written and the rest reported as final.
    const out = resolveMirrorValues(
      [labels()],
      { labels: related('label', ['lab_1', 'gone']) },
      pagesFor('label', [['lab_1', 'page-1']], true),
    );
    expect(out.values['labels']).toEqual({ kind: 'relation', externalPageIds: ['page-1'] });
    expect(out.unresolved).toEqual([
      { field: 'labels', targetId: 'gone', reason: 'related_page_impossible', retryable: false },
    ]);
  });

  it('treats a target database that is not projected at all as final, never pending', () => {
    // No entry for the entity means its database is disabled or unprovisioned. Nothing will ever
    // create those pages, so retrying is pointless — and saying otherwise would wedge the sweep.
    const out = resolveMirrorValues([labels()], { labels: related('label', ['lab_1']) }, context());
    expect(out.values['labels']).toEqual({ kind: 'relation', externalPageIds: [] });
    expect(out.unresolved).toEqual([
      { field: 'labels', targetId: 'lab_1', reason: 'related_page_impossible', retryable: false },
    ]);
  });

  it('clears a person relation once People is settled, rather than deferring for ever', () => {
    // An assignee who is an agent actor has no People row and never will. Before `settled` this
    // was reported retryable, which would have kept the pass incomplete on every future sweep.
    const binding = assignee({ kind: 'relation', representation: 'docket_people_table' });
    const out = resolveMirrorValues(
      [binding],
      { assignee: ref('act_agent', 'Athena') },
      pagesFor('person', [], true),
    );
    expect(out.values['assignee']).toEqual({ kind: 'relation', externalPageIds: [] });
    expect(out.unresolved).toEqual([
      {
        field: 'assignee',
        targetId: 'act_agent',
        reason: 'related_page_impossible',
        retryable: false,
      },
    ]);
  });

  it('drops a reference with no column to render it into', () => {
    const out = resolveMirrorValues([], { labels: related('label', ['lab_1']) }, NOBODY);
    expect(out.values['labels']).toBeUndefined();
    expect(out.unresolved).toEqual([]);
  });

  it('drops an actor with no column to render it into', () => {
    const out = resolveMirrorValues([], { assignee: ref('act_1', 'Sam S') }, KNOWN);
    expect(out.values['assignee']).toBeUndefined();
    expect(out.unresolved).toEqual([]);
  });

  it('an omitted reference leaves the content hash free to change when it resolves', () => {
    // This is what proves omission CONVERGES rather than stalls: the unresolved pass writes a row
    // without the property and hashes it that way, so the pass that resolves it sees a different
    // hash and issues exactly one update.
    const binding = assignee({ kind: 'relation', representation: 'docket_people_table' });
    const source = { assignee: ref('act_1', 'Sam S') };

    const pending = projectRow([binding], resolveMirrorValues([binding], source, NOBODY).values);
    const filled = projectRow([binding], resolveMirrorValues([binding], source, KNOWN).values);

    expect(pending.properties).not.toHaveProperty('pid_a');
    expect(filled.properties).toHaveProperty('pid_a');
    expect(pending.contentHash).not.toBe(filled.contentHash);
  });
});
