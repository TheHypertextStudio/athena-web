import { NotionMirrorEntity, type VocabularySkin } from '@docket/types';
import { describe, expect, it } from 'vitest';

import {
  MIRROR_ENTITY_ORDER,
  MIRROR_ENTITY_SPECS,
  MIRROR_PROJECTION_ORDER,
  defaultColumnTitle,
  defaultDatabaseTitle,
  defaultPropertyMap,
  fieldsByPropertyId,
  mirrorField,
  orderedColumns,
  personCompanionKey,
  provisionedKind,
  writableFields,
} from '../../src/notion-mirror-schema';

const NONPROFIT: VocabularySkin = { preset: 'nonprofit' };
const OVERRIDDEN: VocabularySkin = {
  preset: 'startup',
  overrides: { task: { singular: 'Ticket', plural: 'Tickets' } },
};

describe('mirror entity catalog', () => {
  it('covers every entity kind the database enum accepts', () => {
    // The designer renders one page per entity from this catalog; a kind present in the enum but
    // missing here would be a database row nothing can ever design.
    expect(Object.keys(MIRROR_ENTITY_SPECS).sort()).toEqual([...NotionMirrorEntity.options].sort());
  });

  it('gives every entity exactly one required title field', () => {
    // Notion requires exactly one title property per database. Zero would make provisioning fail
    // at the API; more than one would make it ambiguous which column carries the record name.
    for (const entity of NotionMirrorEntity.options) {
      const titles = MIRROR_ENTITY_SPECS[entity].fields.filter((f) => f.kind === 'title');
      expect(titles, `${entity} title fields`).toHaveLength(1);
      expect(titles[0]?.required, `${entity} title is required`).toBe(true);
    }
  });

  it('only lists default columns that exist in the field catalog', () => {
    // A default column with no catalog entry would provision a property the sync cannot fill.
    for (const entity of NotionMirrorEntity.options) {
      const spec = MIRROR_ENTITY_SPECS[entity];
      for (const field of spec.defaultColumns) {
        expect(mirrorField(entity, field), `${entity}.${field}`).toBeDefined();
      }
    }
  });

  it('always includes the required title among the default columns', () => {
    for (const entity of NotionMirrorEntity.options) {
      const spec = MIRROR_ENTITY_SPECS[entity];
      const title = spec.fields.find((f) => f.kind === 'title');
      expect(spec.defaultColumns, entity).toContain(title?.field);
    }
  });

  it('points every relation at an entity that is itself projectable', () => {
    // A relation can only be provisioned once its target data source exists, so a target outside
    // the projected set would be a column that can never be created.
    for (const entity of NotionMirrorEntity.options) {
      for (const field of MIRROR_ENTITY_SPECS[entity].fields) {
        if (field.kind !== 'relation') continue;
        expect(field.relationEntity, `${entity}.${field.field}`).toBeDefined();
        expect(NotionMirrorEntity.options).toContain(field.relationEntity);
      }
    }
  });

  it('marks writable fields only on two-way entities', () => {
    // On a push-only entity every Notion edit is drift by definition; a writable field there
    // would be a promise the reconciler does not keep.
    for (const entity of NotionMirrorEntity.options) {
      const spec = MIRROR_ENTITY_SPECS[entity];
      if (spec.direction === 'two_way') continue;
      expect(writableFields(entity), entity).toEqual([]);
    }
  });

  it('carries tasks and projects two-way, and nothing else', () => {
    const twoWay = NotionMirrorEntity.options.filter(
      (e) => MIRROR_ENTITY_SPECS[e].direction === 'two_way',
    );
    expect(twoWay.sort()).toEqual(['project', 'task']);
  });

  it('never marks the Docket back-link writable', () => {
    // It is a link into Docket; letting Notion redefine it would point the mirror at itself.
    for (const entity of NotionMirrorEntity.options) {
      expect(writableFields(entity)).not.toContain('docketUrl');
    }
  });
});

describe('vocabulary-derived titles', () => {
  it('titles a database with the org term, not a hardcoded English word', () => {
    expect(defaultDatabaseTitle('initiative', null)).toBe('Initiatives');
    expect(defaultDatabaseTitle('initiative', NONPROFIT)).toBe('Campaigns');
    expect(defaultDatabaseTitle('cycle', NONPROFIT)).toBe('Seasons');
  });

  it('honours a per-key override ahead of the preset', () => {
    expect(defaultDatabaseTitle('task', OVERRIDDEN)).toBe('Tickets');
  });

  it('falls back to the static title for entities with no vocabulary term', () => {
    // Milestones, labels and people are not part of the vocabulary skin, so they keep their own
    // names rather than silently borrowing an unrelated term.
    expect(defaultDatabaseTitle('milestone', NONPROFIT)).toBe('Milestones');
    expect(defaultDatabaseTitle('person', NONPROFIT)).toBe('People');
  });

  it('titles a relation column with the org term for the entity it points at', () => {
    expect(defaultColumnTitle('task', 'project', null)).toBe('Project');
    expect(defaultColumnTitle('task', 'cycle', NONPROFIT)).toBe('Season');
    expect(defaultColumnTitle('project', 'initiatives', NONPROFIT)).toBe('Campaigns');
  });

  it('leaves non-relation columns on their static label', () => {
    expect(defaultColumnTitle('task', 'dueDate', NONPROFIT)).toBe('Due');
  });

  it('returns undefined for a field the entity does not expose', () => {
    expect(defaultColumnTitle('label', 'assignee', null)).toBeUndefined();
  });
});

describe('default property map', () => {
  it('keys bindings by Docket field and carries no property id yet', () => {
    // Nothing is provisioned at design time, so a `propertyId` here would be a claim that a
    // Notion property exists when none does.
    const map = defaultPropertyMap('task', null);
    expect(Object.keys(map).sort()).toEqual([...MIRROR_ENTITY_SPECS.task.defaultColumns].sort());
    for (const binding of Object.values(map)) {
      expect(binding.propertyId).toBeUndefined();
    }
  });

  it('defaults person-valued columns to plain text', () => {
    // Plain text is the only representation that holds every human, including those with no
    // Notion account — so it is what an untouched design starts from.
    expect(defaultPropertyMap('task', null)['assignee']?.representation).toBe('text');
    expect(defaultPropertyMap('project', null)['lead']?.representation).toBe('text');
  });

  it('leaves non-person columns with no representation at all', () => {
    expect(defaultPropertyMap('task', null)['dueDate']?.representation).toBeUndefined();
  });

  it('applies the org vocabulary to column titles', () => {
    expect(defaultPropertyMap('task', OVERRIDDEN)['title']?.title).toBe('Name');
    expect(defaultPropertyMap('project', NONPROFIT)['program']?.title).toBe('Program');
  });
});

describe('provisionedKind', () => {
  it('resolves each person representation to the Notion type it actually creates', () => {
    const base = { field: 'assignee', title: 'Assignee', kind: 'rich_text', order: 0 } as const;
    expect(provisionedKind({ ...base, representation: 'text' })).toBe('rich_text');
    // `notion_person` stays rich text. The native people property is provisioned as a separate
    // companion column BESIDE this one — substituting it here would delete the only column able
    // to hold a person with no Notion account, which is the population the choice protects.
    expect(provisionedKind({ ...base, representation: 'notion_person' })).toBe('rich_text');
    expect(provisionedKind({ ...base, representation: 'docket_people_table' })).toBe('relation');
    expect(provisionedKind({ ...base, representation: 'existing_table' })).toBe('relation');
  });

  it('never derives a people property from a representation — only from a column kind', () => {
    const representations = ['text', 'notion_person', 'docket_people_table', 'existing_table'];
    for (const representation of representations) {
      expect(
        provisionedKind({
          field: 'assignee',
          title: 'Assignee',
          kind: 'rich_text',
          order: 0,
          representation: representation as 'text',
        }),
      ).not.toBe('people');
    }
    expect(
      provisionedKind({ field: 'notionUser', title: 'Notion account', kind: 'people', order: 0 }),
    ).toBe('people');
  });

  it('derives a native-Notion companion for every person-valued field', () => {
    // Generated rather than hand-written, so a person-valued field added later cannot ship without
    // one — and a companion is never a default column, since it exists only when chosen.
    for (const spec of Object.values(MIRROR_ENTITY_SPECS)) {
      for (const field of spec.fields.filter((f) => f.personValued === true)) {
        const companion = spec.fields.find((f) => f.field === personCompanionKey(field.field));
        expect(companion).toMatchObject({ kind: 'people', personCompanionOf: field.field });
        expect(spec.defaultColumns).not.toContain(companion?.field);
      }
    }
  });

  it('projects People before anything that can relate to it', () => {
    // Load-bearing: a relation can only carry a page id that already exists.
    expect(MIRROR_PROJECTION_ORDER[0]).toBe('person');
    expect([...MIRROR_PROJECTION_ORDER].sort()).toEqual([...MIRROR_ENTITY_ORDER].sort());
  });

  it('falls through to the declared kind when there is no representation', () => {
    expect(provisionedKind({ field: 'dueDate', title: 'Due', kind: 'date', order: 0 })).toBe(
      'date',
    );
  });
});

describe('fieldsByPropertyId', () => {
  it('inverts the map so a pull can go from Notion property to Docket field', () => {
    const byId = fieldsByPropertyId({
      title: { field: 'title', title: 'Name', kind: 'title', order: 0, propertyId: 'abc%3A' },
      state: { field: 'state', title: 'Status', kind: 'select', order: 1, propertyId: 'xyz' },
    });
    expect(byId.get('abc%3A')).toBe('title');
    expect(byId.get('xyz')).toBe('state');
  });

  it('skips bindings that have not been provisioned', () => {
    // An unprovisioned binding has no Notion property to key on; including it would map
    // `undefined` and let an unrelated payload key collide with it.
    const byId = fieldsByPropertyId({
      title: { field: 'title', title: 'Name', kind: 'title', order: 0 },
    });
    expect(byId.size).toBe(0);
  });

  it('survives a column title change on either side', () => {
    // The whole reason bindings address a property by id: renaming in Docket or in Notion must
    // not move the binding. Same id, different titles, same resolved field.
    const renamedInDocket = fieldsByPropertyId({
      assignee: {
        field: 'assignee',
        title: 'Owner',
        kind: 'rich_text',
        order: 0,
        propertyId: 'pid1',
      },
    });
    const renamedInNotion = fieldsByPropertyId({
      assignee: {
        field: 'assignee',
        title: 'DRI',
        kind: 'rich_text',
        order: 0,
        propertyId: 'pid1',
      },
    });
    expect(renamedInDocket.get('pid1')).toBe('assignee');
    expect(renamedInNotion.get('pid1')).toBe('assignee');
  });
});

describe('orderedColumns', () => {
  it('sorts by the explicit order, not by object key order', () => {
    // PostgreSQL normalizes jsonb object keys by length then bytes, so the order the columns were
    // written in is GONE by the first read back. This is the guard against the columns silently
    // rearranging themselves between saving a design and looking at it again.
    const scrambled = {
      state: { field: 'state', title: 'Status', kind: 'select' as const, order: 1 },
      title: { field: 'title', title: 'Name', kind: 'title' as const, order: 0 },
      priority: { field: 'priority', title: 'Priority', kind: 'select' as const, order: 2 },
    };
    expect(orderedColumns(scrambled).map((c) => c.field)).toEqual(['title', 'state', 'priority']);
  });
});

describe('designer ordering', () => {
  it('lists every entity exactly once', () => {
    expect([...MIRROR_ENTITY_ORDER].sort()).toEqual([...NotionMirrorEntity.options].sort());
  });

  it('leads with the two-way entities, which are the ones people actually work in', () => {
    expect(MIRROR_ENTITY_ORDER.slice(0, 2)).toEqual(['task', 'project']);
  });
});
