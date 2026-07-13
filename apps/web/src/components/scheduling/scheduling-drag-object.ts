import type { ScheduleDragObject } from './scheduling-types';

/** Private data-transfer type shared by task rows and scheduling items. */
export const SCHEDULE_DRAG_MIME = 'application/x-docket-schedule-object';

/** Put a typed scheduling object onto a native drag event. */
export function writeScheduleDragObject(transfer: DataTransfer, object: ScheduleDragObject): void {
  transfer.effectAllowed = 'link';
  transfer.setData(SCHEDULE_DRAG_MIME, JSON.stringify(object));
  transfer.setData('text/plain', object.title);
}

/** Parse only the two closed scheduling-object variants; malformed external data is ignored. */
export function readScheduleDragObject(transfer: DataTransfer): ScheduleDragObject | null {
  const raw = transfer.getData(SCHEDULE_DRAG_MIME);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value['kind'] === 'task' &&
      typeof value['taskId'] === 'string' &&
      typeof value['organizationId'] === 'string' &&
      typeof value['title'] === 'string'
    ) {
      return {
        kind: 'task',
        taskId: value['taskId'],
        organizationId: value['organizationId'],
        title: value['title'],
      };
    }
    if (
      value['kind'] === 'calendar_item' &&
      typeof value['itemId'] === 'string' &&
      typeof value['title'] === 'string'
    ) {
      return { kind: 'calendar_item', itemId: value['itemId'], title: value['title'] };
    }
  } catch {
    return null;
  }
  return null;
}
