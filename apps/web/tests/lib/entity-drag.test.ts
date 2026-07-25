import { describe, expect, it, vi } from 'vitest';

import { INITIATIVE_DRAG_MIME } from '@/components/initiatives/hierarchy-dnd';
import { SCHEDULE_DRAG_MIME } from '@/components/scheduling/scheduling-drag-object';
import {
  ENTITY_DRAG_MIME,
  type EntityDragItem,
  entityDragSource,
  readEntityDragObject,
  writeEntityDragObject,
} from '@/lib/entity-drag';

/** A minimal in-memory stand-in for the browser's `DataTransfer`. */
function fakeTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    effectAllowed: 'uninitialized',
    setData: (format: string, value: string) => {
      store.set(format, value);
    },
    getData: (format: string) => store.get(format) ?? '',
  } as unknown as DataTransfer;
}

const PROJECT: EntityDragItem = {
  kind: 'project',
  id: 'proj_1',
  organizationId: 'org_1',
  title: 'Billing revamp',
};

describe('entity drag payload', () => {
  it('round-trips every core object kind', () => {
    const kinds = ['program', 'project', 'task', 'cycle', 'team'] as const;
    for (const kind of kinds) {
      const transfer = fakeTransfer();
      const item = { kind, id: `${kind}_1`, organizationId: 'org_1', title: 'Thing' };
      writeEntityDragObject(transfer, item);
      expect(readEntityDragObject(transfer)).toEqual(item);
    }
  });

  it('round-trips an initiative with its parent edge', () => {
    const transfer = fakeTransfer();
    const item: EntityDragItem = {
      kind: 'initiative',
      id: 'init_2',
      organizationId: 'org_1',
      title: 'Platform',
      parentInitiativeId: 'init_1',
      parentLinkId: 'link_9',
    };
    writeEntityDragObject(transfer, item);
    expect(readEntityDragObject(transfer)).toEqual(item);
  });

  it('reads a root-level initiative back with null parent fields', () => {
    const transfer = fakeTransfer();
    writeEntityDragObject(transfer, {
      kind: 'initiative',
      id: 'init_1',
      organizationId: 'org_1',
      title: 'Root',
      parentInitiativeId: null,
      parentLinkId: null,
    });
    const read = readEntityDragObject(transfer);
    expect(read).toMatchObject({ parentInitiativeId: null, parentLinkId: null });
  });

  it('writes the plain-text label so the drag is meaningful outside the app', () => {
    const transfer = fakeTransfer();
    writeEntityDragObject(transfer, PROJECT);
    expect(transfer.getData('text/plain')).toBe('Billing revamp');
  });

  it('permits every drop effect so each target can narrow it', () => {
    const transfer = fakeTransfer();
    writeEntityDragObject(transfer, PROJECT);
    expect(transfer.effectAllowed).toBe('all');
  });

  describe('legacy compatibility', () => {
    it('mirrors the scheduling payload for tasks so the calendar keeps working', () => {
      const transfer = fakeTransfer();
      writeEntityDragObject(transfer, {
        kind: 'task',
        id: 'task_1',
        organizationId: 'org_1',
        title: 'Ship it',
      });
      expect(JSON.parse(transfer.getData(SCHEDULE_DRAG_MIME))).toEqual({
        kind: 'task',
        taskId: 'task_1',
        organizationId: 'org_1',
        title: 'Ship it',
      });
    });

    it('mirrors the initiative payload so the hierarchy treegrid keeps re-parenting', () => {
      const transfer = fakeTransfer();
      writeEntityDragObject(transfer, {
        kind: 'initiative',
        id: 'init_2',
        organizationId: 'org_1',
        title: 'Platform',
        parentInitiativeId: 'init_1',
        parentLinkId: 'link_9',
      });
      expect(JSON.parse(transfer.getData(INITIATIVE_DRAG_MIME))).toEqual({
        id: 'init_2',
        parentInitiativeId: 'init_1',
        parentLinkId: 'link_9',
      });
    });

    it('does not mirror a schedule payload for kinds the calendar cannot accept', () => {
      const transfer = fakeTransfer();
      writeEntityDragObject(transfer, PROJECT);
      expect(transfer.getData(SCHEDULE_DRAG_MIME)).toBe('');
    });
  });

  describe('reading foreign or malformed drags', () => {
    it('ignores a drag carrying no Docket object', () => {
      expect(readEntityDragObject(fakeTransfer())).toBeNull();
    });

    it('ignores malformed JSON rather than throwing into a dragover handler', () => {
      const transfer = fakeTransfer();
      transfer.setData(ENTITY_DRAG_MIME, '{not json');
      expect(readEntityDragObject(transfer)).toBeNull();
    });

    it('rejects an unknown kind', () => {
      const transfer = fakeTransfer();
      transfer.setData(
        ENTITY_DRAG_MIME,
        JSON.stringify({ kind: 'invoice', id: 'x', organizationId: 'o', title: 't' }),
      );
      expect(readEntityDragObject(transfer)).toBeNull();
    });

    it('rejects a payload missing required fields', () => {
      const transfer = fakeTransfer();
      transfer.setData(ENTITY_DRAG_MIME, JSON.stringify({ kind: 'task', id: 'x' }));
      expect(readEntityDragObject(transfer)).toBeNull();
    });
  });

  describe('entityDragSource', () => {
    it('writes the payload and notifies the row when the gesture starts', () => {
      const onDragStart = vi.fn();
      const source = entityDragSource(PROJECT, { onDragStart });
      const transfer = fakeTransfer();
      source.onDragStart({ dataTransfer: transfer } as unknown as React.DragEvent);
      expect(readEntityDragObject(transfer)).toEqual(PROJECT);
      expect(onDragStart).toHaveBeenCalledOnce();
    });

    it('is enabled by default and disablable for rows the viewer cannot move', () => {
      expect(entityDragSource(PROJECT).enabled).toBe(true);
      expect(entityDragSource(PROJECT, { enabled: false }).enabled).toBe(false);
    });
  });
});
