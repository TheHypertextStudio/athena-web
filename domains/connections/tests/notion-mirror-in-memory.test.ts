import { assert, describe, expect, it } from 'vitest';

import { MockNotionMirror } from '../src/notion/adapters/in-memory';

const spec = {
  title: 'Tasks',
  parentPageId: 'mock_page_workspace',
  columns: [
    { field: 'title', title: 'Name', kind: 'title' as const },
    { field: 'state', title: 'Status', kind: 'select' as const },
  ],
};

describe('MockNotionMirror — the flow the reconciler depends on', () => {
  it('lists only people, never bots', async () => {
    // The real client filters `type === 'person'` at the provider edge; the mock has to hold the
    // same shape or local runs would never exercise the people surface correctly.
    const people = await new MockNotionMirror().listWorkspaceUsers();
    expect(people.every((person) => person.externalId.startsWith('mock_user_'))).toBe(true);
    expect(people.some((person) => person.email === undefined)).toBe(true);
  });

  it('provisions a database and hands back a property id per column', async () => {
    const mirror = new MockNotionMirror();
    const provisioned = await mirror.provisionDatabase(spec);
    expect(Object.keys(provisioned.propertyIds).sort()).toEqual(['state', 'title']);
    expect(provisioned.externalDataSourceId).not.toBe(provisioned.externalDatabaseId);
  });

  it('keeps a provisioned property id across a schema update', async () => {
    // The invariant the whole property-id design rests on: renaming a column must not re-bind it.
    const mirror = new MockNotionMirror();
    const provisioned = await mirror.provisionDatabase(spec);
    const renamed = await mirror.updateDatabaseSchema(provisioned.externalDataSourceId, {
      ...spec,
      columns: [
        { field: 'title', title: 'Task name', kind: 'title' as const },
        { field: 'state', title: 'Stage', kind: 'select' as const },
      ],
    });
    expect(renamed['title']).toBe(provisioned.propertyIds['title']);
    expect(renamed['state']).toBe(provisioned.propertyIds['state']);
  });

  it('advances last_edited_time on every write, so the echo guard can tell writes apart', async () => {
    const mirror = new MockNotionMirror();
    const ds = (await mirror.provisionDatabase(spec)).externalDataSourceId;
    const created = await mirror.writeRow({ kind: 'create', dataSourceId: ds, properties: {} });
    assert(created);
    const updated = await mirror.writeRow({
      kind: 'update',
      dataSourceId: ds,
      externalPageId: created.externalPageId,
      properties: {},
    });
    expect(Date.parse(updated?.externalUpdatedAt ?? '')).toBeGreaterThan(
      Date.parse(created.externalUpdatedAt),
    );
  });

  it('reports a human edit as newer than our own write', async () => {
    // This is the scenario the echo guard exists for: our write, then somebody else's.
    const mirror = new MockNotionMirror();
    const ds = (await mirror.provisionDatabase(spec)).externalDataSourceId;
    const created = await mirror.writeRow({ kind: 'create', dataSourceId: ds, properties: {} });
    const pageId = created?.externalPageId ?? '';
    mirror.editAsPerson(pageId);

    const changes = await mirror.queryChanges(ds);
    const change = changes.find((c) => c.externalPageId === pageId);
    expect(change?.lastEditedBy).toBe('mock_user_1');
    expect(Date.parse(change?.externalUpdatedAt ?? '')).toBeGreaterThan(
      Date.parse(created?.externalUpdatedAt ?? ''),
    );
  });

  it('honours the since cutoff, so an incremental read returns only what changed', async () => {
    const mirror = new MockNotionMirror();
    const ds = (await mirror.provisionDatabase(spec)).externalDataSourceId;
    const first = await mirror.writeRow({ kind: 'create', dataSourceId: ds, properties: {} });
    const cutoff = new Date(Date.parse(first?.externalUpdatedAt ?? '') + 1).toISOString();
    const second = await mirror.writeRow({ kind: 'create', dataSourceId: ds, properties: {} });

    const changes = await mirror.queryChanges(ds, cutoff);
    expect(changes.map((c) => c.externalPageId)).toEqual([second?.externalPageId]);
  });

  it('surfaces a trashed page rather than omitting it', async () => {
    // Absence and deletion must stay distinguishable, or the reconciler cannot tell "unchanged"
    // from "gone" and would archive live work.
    const mirror = new MockNotionMirror();
    const ds = (await mirror.provisionDatabase(spec)).externalDataSourceId;
    const created = await mirror.writeRow({ kind: 'create', dataSourceId: ds, properties: {} });
    mirror.trashAsPerson(created?.externalPageId ?? '');

    const changes = await mirror.queryChanges(ds);
    expect(changes[0]?.archived).toBe(true);
  });

  it('scopes a read to one data source', async () => {
    const mirror = new MockNotionMirror();
    const a = (await mirror.provisionDatabase(spec)).externalDataSourceId;
    const b = (await mirror.provisionDatabase({ ...spec, title: 'Projects' })).externalDataSourceId;
    await mirror.writeRow({ kind: 'create', dataSourceId: a, properties: {} });

    expect(await mirror.queryChanges(b)).toEqual([]);
    expect(await mirror.queryChanges(a)).toHaveLength(1);
  });

  it('refuses an update with no page id', async () => {
    const mirror = new MockNotionMirror();
    const ds = (await mirror.provisionDatabase(spec)).externalDataSourceId;
    await expect(mirror.writeRow({ kind: 'update', dataSourceId: ds })).rejects.toThrow(
      /no page id/,
    );
  });

  it('narrows the parent-page list by title, case-insensitively', async () => {
    // The picker never filters locally — it trusts the provider to have interpreted the query. A
    // mock that returned its whole fixture regardless would let that contract ship unexercised.
    const mirror = new MockNotionMirror();
    const all = await mirror.listParentPages();
    const matched = await mirror.listParentPages({ query: 'proj' });

    expect(all.items.length).toBeGreaterThan(matched.items.length);
    expect(matched.items.every((page) => page.title.toLowerCase().includes('proj'))).toBe(true);
  });

  it('offers two same-named pages that only their placement and edit time tell apart', async () => {
    // The reason a row carries more than a title: a real workspace has repeats, and the picker's
    // whole job is making them distinguishable without a request per row.
    const projects = (await new MockNotionMirror().listParentPages({ query: 'Projects' })).items;

    expect(projects).toHaveLength(2);
    expect(new Set(projects.map((page) => page.title)).size).toBe(1);
    expect(new Set(projects.map((page) => page.parentKind)).size).toBe(2);
    expect(new Set(projects.map((page) => page.lastEditedTime)).size).toBe(2);
  });

  it('pages through with a cursor and stops by reporting none', async () => {
    const mirror = new MockNotionMirror();
    const first = await mirror.listParentPages({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await mirror.listParentPages({ limit: 2, cursor: first.nextCursor ?? '' });
    expect(second.items.map((page) => page.id)).not.toEqual(first.items.map((page) => page.id));
    expect(second.nextCursor).toBeNull();
  });

  it('describes a page by id, and names an unknown one rather than failing', async () => {
    // Provisioning records the container page's title from this. A miss must degrade to a label,
    // not throw — the databases were still created and the surface still has to render.
    const mirror = new MockNotionMirror();
    expect(await mirror.describePage('mock_page_workspace')).toMatchObject({ title: 'Team wiki' });
    expect(await mirror.describePage('nope')).toEqual({ id: 'nope', title: 'Untitled' });
  });

  it('trashes on delete rather than dropping the page', async () => {
    // Notion has no hard delete over the API, and a sync must never destroy data at either end.
    const mirror = new MockNotionMirror();
    const ds = (await mirror.provisionDatabase(spec)).externalDataSourceId;
    const created = await mirror.writeRow({ kind: 'create', dataSourceId: ds, properties: {} });
    assert(created);
    await mirror.writeRow({
      kind: 'delete',
      dataSourceId: ds,
      externalPageId: created.externalPageId,
    });
    expect(mirror.snapshot()).toHaveLength(1);
    expect(mirror.snapshot()[0]?.inTrash).toBe(true);
  });
});
