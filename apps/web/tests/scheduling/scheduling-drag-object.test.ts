import { describe, expect, it, vi } from 'vitest';

import {
  readScheduleDragObject,
  SCHEDULE_DRAG_MIME,
  writeScheduleDragObject,
} from '@/components/scheduling';

/** Build the smallest deterministic DataTransfer substitute needed by the drag contract. */
function createTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => {
      values.set(type, value);
    },
  } as DataTransfer;
}

describe('scheduling drag objects', () => {
  it('round-trips closed task and calendar-item objects through DataTransfer', () => {
    const transfer = createTransfer();
    const task = {
      kind: 'task' as const,
      taskId: 'task_1',
      organizationId: 'org_1',
      title: 'Prepare review',
    };

    writeScheduleDragObject(transfer, task);

    expect(transfer.effectAllowed).toBe('link');
    expect(transfer.getData('text/plain')).toBe(task.title);
    expect(readScheduleDragObject(transfer)).toEqual(task);
  });

  it('ignores malformed and unsupported external payloads', () => {
    const transfer = createTransfer();
    const setData = vi.spyOn(transfer, 'setData');
    transfer.setData(SCHEDULE_DRAG_MIME, JSON.stringify({ kind: 'task', taskId: 42 }));

    expect(setData).toHaveBeenCalledOnce();
    expect(readScheduleDragObject(transfer)).toBeNull();

    transfer.setData(SCHEDULE_DRAG_MIME, '{broken');
    expect(readScheduleDragObject(transfer)).toBeNull();
  });
});
