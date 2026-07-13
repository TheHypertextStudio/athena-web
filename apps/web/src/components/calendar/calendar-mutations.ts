'use client';

/**
 * Compatibility entrypoint for the layered calendar write hooks.
 *
 * @remarks
 * Keep consumer imports stable while the implementation is grouped by mutation responsibility.
 */
export {
  useCreateCalendarItem,
  useDeleteCalendarItem,
  useRetryCalendarItemWrite,
} from './calendar-item-lifecycle-mutations';
// eslint-disable-next-line @typescript-eslint/no-deprecated -- This barrel intentionally preserves the legacy alias.
export { useCreateNativeBlock } from './calendar-item-lifecycle-mutations';
export { useUpdateCalendarItem, useUpdateCalendarItemById } from './calendar-item-update-mutations';
export type { UpdateCalendarItemByIdVariables } from './calendar-item-update-mutations';
export { useUpdateLayerVisibility } from './calendar-layer-mutations';
export {
  useCreateAndLinkTask,
  useDetachCalendarItemRelation,
  useDetachTaskFromItem,
  useLinkTaskToCalendarItem,
  useLinkTaskToItem,
  useRelateCalendarItems,
} from './calendar-relationship-mutations';
export type {
  CreateAndLinkTaskVariables,
  LinkExistingTaskVariables,
} from './calendar-relationship-mutations';
