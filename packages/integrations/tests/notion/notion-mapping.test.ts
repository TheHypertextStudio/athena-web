import { describe, expect, it } from 'vitest';

import {
  completionProperty,
  mapNotionPage,
  notionPageUrl,
  notionPushProperties,
  readNotionAssignees,
  readNotionCompleted,
  readNotionDescription,
  readNotionDueDate,
  readNotionPriority,
  readNotionSchema,
  readNotionTitle,
} from '../../src/notion-mapping';
import {
  MY_TASKS_DATA_SOURCE,
  MY_TASKS_PROPERTIES,
  TASKS_TRACKER_DATA_SOURCE,
  TASKS_TRACKER_PROPERTIES,
  tasksTrackerPage,
} from './notion-fixtures';

const IMPORTED_AT = '2026-08-02T00:00:00.000Z';

const trackerSchema = readNotionSchema(
  TASKS_TRACKER_DATA_SOURCE,
  'Tasks Tracker',
  TASKS_TRACKER_PROPERTIES,
);
const myTasksSchema = readNotionSchema(MY_TASKS_DATA_SOURCE, 'My Tasks', MY_TASKS_PROPERTIES);

describe('readNotionSchema', () => {
  it('derives every Docket role from the real Tasks Tracker schema', () => {
    expect(trackerSchema.titleProperty).toBe('Task name');
    expect(trackerSchema.statusProperty).toBe('Status');
    expect(trackerSchema.dueDateProperty).toBe('Due date');
    expect(trackerSchema.descriptionProperty).toBe('Description');
    expect(trackerSchema.priorityProperty).toBe('Priority');
    expect(trackerSchema.assigneeProperty).toBe('Assignee');
  });

  it('reads completion from Notion’s status GROUPS, not from option names', () => {
    expect(trackerSchema.statusGroups).toEqual({
      todo: ['Not started'],
      inProgress: ['In progress'],
      complete: ['Done'],
    });
  });

  it('resolves the same roles on a differently-named custom database', () => {
    // "Due", not "Due date" — proof the mapping resolves by type + name preference rather than
    // by a hard-coded property name.
    expect(myTasksSchema.titleProperty).toBe('Task name');
    expect(myTasksSchema.dueDateProperty).toBe('Due');
    expect(myTasksSchema.statusProperty).toBe('Status');
    expect(myTasksSchema.statusGroups.complete).toEqual(['Done']);
  });

  it('names every property it cannot carry instead of dropping it silently', () => {
    const unmapped = trackerSchema.unmappedProperties.map((p) => `${p.name}:${p.type}`).sort();
    expect(unmapped).toEqual([
      'Effort level:select',
      'Parent Task:relation',
      'Project:relation',
      'Subtasks:relation',
      'Updated at:last_edited_time',
    ]);
    // The rollup on Notion's own task database has no Docket destination either — and says so.
    expect(myTasksSchema.unmappedProperties).toEqual([{ name: 'Source', type: 'rollup' }]);
  });

  it('prefers a status property over a checkbox for completion', () => {
    expect(completionProperty(trackerSchema)).toEqual({
      kind: 'status',
      name: 'Status',
      groups: trackerSchema.statusGroups,
    });
  });

  it('falls back to a checkbox when the database has no status property', () => {
    const schema = readNotionSchema('ds', 'Simple', {
      Name: { type: 'title', title: {} },
      Done: { type: 'checkbox', checkbox: {} },
    });
    expect(completionProperty(schema)).toEqual({ kind: 'checkbox', name: 'Done' });
  });

  it('reports no completion property when the database expresses none', () => {
    const schema = readNotionSchema('ds', 'Notes', { Name: { type: 'title', title: {} } });
    expect(completionProperty(schema)).toEqual({ kind: 'none' });
  });

  it('supports the keyed group shape the Notion MCP surface returns', () => {
    const schema = readNotionSchema('ds', 'Keyed', {
      Name: { type: 'title', title: {} },
      Status: {
        type: 'status',
        status: {
          groups: {
            to_do: [{ name: 'In backlog' }, { name: 'Conceptualizing' }],
            in_progress: [{ name: 'Blocked' }],
            complete: [{ name: 'Substantially complete' }, { name: 'Complete' }],
          },
        },
      },
    });
    expect(schema.statusGroups.complete).toEqual(['Substantially complete', 'Complete']);
    expect(schema.statusGroups.todo).toEqual(['In backlog', 'Conceptualizing']);
  });
});

describe('reading a Notion page', () => {
  it('reads the title, description, priority, due date and assignees', () => {
    const page = tasksTrackerPage({
      title: 'Appoint a Treasurer',
      description: 'Board must ratify at the next meeting.',
      priority: 'High',
      due: '2026-09-01',
      assignees: ['37fd872b-594c-8199-925c-0002ca607d47'],
    });
    expect(readNotionTitle(page, trackerSchema)).toBe('Appoint a Treasurer');
    expect(readNotionDescription(page, trackerSchema)).toBe(
      'Board must ratify at the next meeting.',
    );
    expect(readNotionPriority(page, trackerSchema)).toBe('High');
    expect(readNotionDueDate(page, trackerSchema)).toBe('2026-09-01');
    expect(readNotionAssignees(page, trackerSchema)).toEqual([
      '37fd872b-594c-8199-925c-0002ca607d47',
    ]);
  });

  it('is complete only for an option in the complete GROUP', () => {
    expect(readNotionCompleted(tasksTrackerPage({ status: 'Done' }), trackerSchema)).toBe(true);
    expect(readNotionCompleted(tasksTrackerPage({ status: 'In progress' }), trackerSchema)).toBe(
      false,
    );
    expect(readNotionCompleted(tasksTrackerPage({ status: 'Not started' }), trackerSchema)).toBe(
      false,
    );
    expect(readNotionCompleted(tasksTrackerPage({ status: null }), trackerSchema)).toBe(false);
  });

  it('reports unknown (not "incomplete") when the database has no completion property', () => {
    const schema = readNotionSchema('ds', 'Notes', { Name: { type: 'title', title: {} } });
    expect(readNotionCompleted(tasksTrackerPage(), schema)).toBeUndefined();
  });

  it('distinguishes a cleared due date (null) from an absent property (undefined)', () => {
    expect(readNotionDueDate(tasksTrackerPage({ due: null }), trackerSchema)).toBeNull();
    const schema = readNotionSchema('ds', 'Undated', { Name: { type: 'title', title: {} } });
    expect(readNotionDueDate(tasksTrackerPage(), schema)).toBeUndefined();
  });
});

describe('mapNotionPage', () => {
  it('maps a live page to an ImportedItem carrying the sync anchors', () => {
    const page = tasksTrackerPage({
      id: '386c7791-208f-80f4-9baf-d7eb1d60de23',
      title: 'Appoint a Treasurer',
      description: 'Board must ratify.',
      due: '2026-09-01',
      status: 'In progress',
      lastEditedTime: '2026-07-14T21:57:00.000Z',
    });
    expect(mapNotionPage(page, trackerSchema, IMPORTED_AT)).toEqual({
      id: '386c7791-208f-80f4-9baf-d7eb1d60de23',
      kind: 'issue',
      title: 'Appoint a Treasurer',
      body: 'Board must ratify.',
      completed: false,
      dueDate: '2026-09-01',
      provenance: {
        provider: 'notion',
        externalId: '386c7791-208f-80f4-9baf-d7eb1d60de23',
        externalUrl: 'https://www.notion.so/386c7791208f80f49bafd7eb1d60de23',
        importedAt: IMPORTED_AT,
        // The last-write-wins anchor + echo guard the reconciler compares against.
        externalUpdatedAt: '2026-07-14T21:57:00.000Z',
        // The data source the write-back must address.
        externalListId: TASKS_TRACKER_DATA_SOURCE,
      },
    });
  });

  it('turns a trashed page into a tombstone so a Notion delete propagates as data', () => {
    const item = mapNotionPage(tasksTrackerPage({ inTrash: true }), trackerSchema, IMPORTED_AT);
    expect(item?.removed).toBe(true);
  });

  it('gives an untitled Notion page a non-blank title (Docket’s title is NOT NULL)', () => {
    const item = mapNotionPage(tasksTrackerPage({ title: '' }), trackerSchema, IMPORTED_AT);
    expect(item?.title).toBe('Untitled');
  });

  it('returns undefined rather than a half-built item when the payload has no id', () => {
    expect(mapNotionPage({ object: 'page' }, trackerSchema, IMPORTED_AT)).toBeUndefined();
  });

  it('derives the canonical page URL from an id alone', () => {
    expect(notionPageUrl('386c7791-208f-80e6-a74e-da40db98177e')).toBe(
      'https://www.notion.so/386c7791208f80e6a74eda40db98177e',
    );
  });
});

describe('notionPushProperties — the outbound half of two-way sync', () => {
  it('writes title, notes, due date and completion onto the real Tasks Tracker schema', () => {
    expect(
      notionPushProperties(
        {
          kind: 'update',
          listId: TASKS_TRACKER_DATA_SOURCE,
          externalId: 'p1',
          title: 'Docket’s title',
          notes: 'Docket’s notes',
          dueDate: '2026-10-05',
          completed: true,
        },
        trackerSchema,
      ),
    ).toEqual({
      'Task name': { title: [{ type: 'text', text: { content: 'Docket’s title' } }] },
      Description: { rich_text: [{ type: 'text', text: { content: 'Docket’s notes' } }] },
      'Due date': { date: { start: '2026-10-05' } },
      Status: { status: { name: 'Done' } },
    });
  });

  it('clears a date with an explicit null and clears notes with an empty rich text', () => {
    expect(
      notionPushProperties(
        {
          kind: 'update',
          listId: TASKS_TRACKER_DATA_SOURCE,
          externalId: 'p1',
          dueDate: null,
          notes: null,
        },
        trackerSchema,
      ),
    ).toEqual({ 'Due date': { date: null }, Description: { rich_text: [] } });
  });

  it('re-opening picks the workspace’s own to-do option, never a literal "Not started"', () => {
    const schema = readNotionSchema('ds', 'Custom', {
      Name: { type: 'title', title: {} },
      Stage: {
        type: 'status',
        status: {
          options: [
            { id: 'a', name: 'Icebox' },
            { id: 'b', name: 'Shipped' },
          ],
          groups: [
            { id: 'g1', name: 'To-do', option_ids: ['a'] },
            { id: 'g2', name: 'Complete', option_ids: ['b'] },
          ],
        },
      },
    });
    expect(
      notionPushProperties(
        { kind: 'update', listId: 'ds', externalId: 'p', completed: true },
        schema,
      ),
    ).toEqual({ Stage: { status: { name: 'Shipped' } } });
    expect(
      notionPushProperties(
        { kind: 'update', listId: 'ds', externalId: 'p', completed: false },
        schema,
      ),
    ).toEqual({ Stage: { status: { name: 'Icebox' } } });
  });

  it('never invents a property the target database does not have', () => {
    // Notion rejects an unknown property with a 400, so a field the schema cannot hold must be
    // omitted rather than guessed at.
    const schema = readNotionSchema('ds', 'Bare', { Name: { type: 'title', title: {} } });
    expect(
      notionPushProperties(
        {
          kind: 'update',
          listId: 'ds',
          externalId: 'p',
          title: 'Kept',
          notes: 'Dropped — no rich_text property',
          dueDate: '2026-01-01',
          completed: true,
        },
        schema,
      ),
    ).toEqual({ Name: { title: [{ type: 'text', text: { content: 'Kept' } }] } });
  });

  it('writes a checkbox database’s completion as a checkbox', () => {
    const schema = readNotionSchema('ds', 'Simple', {
      Name: { type: 'title', title: {} },
      Done: { type: 'checkbox', checkbox: {} },
    });
    expect(
      notionPushProperties(
        { kind: 'update', listId: 'ds', externalId: 'p', completed: true },
        schema,
      ),
    ).toEqual({ Done: { checkbox: true } });
  });
});
