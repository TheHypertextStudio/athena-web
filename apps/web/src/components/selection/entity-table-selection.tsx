'use client';

import type { EntityTableProps, EntityTableSelectionCommand } from '@docket/ui/components';
import { useCallback, useMemo } from 'react';

import { objectKey, type ObjectRef } from '@/lib/actions/object';

import { useSelection } from './selection-context';
import type { SelectionIntent } from './selection-model';

/** The EntityTable props owned by the application selection bridge. */
export type EntityTableSelectionBinding<T> = Pick<
  EntityTableProps<T>,
  'getRowSelectionKey' | 'onSelectionCommand' | 'selected' | 'selectionAnchorKey'
>;

/**
 * Translate one table-owned command into the pure application selection model.
 *
 * @param command - The command emitted against the table's flattened eligible order.
 * @returns The matching pure intent, or `null` when the active entry is not selectable.
 */
export function entityTableSelectionIntent(
  command: EntityTableSelectionCommand,
): SelectionIntent | null {
  if (command.command === 'select-all' || command.command === 'clear') {
    return { type: command.command };
  }
  if (command.targetSelectionKey === null) return null;
  return { type: command.command, key: command.targetSelectionKey };
}

/**
 * Bind EntityTable commands to the enclosing keyed SelectionProvider without adding focus props.
 *
 * @param objectForRow - Resolve an eligible provider object, or `null` for context/foreign rows.
 * @returns The controlled selection props that EntityTable owns and emits.
 */
export function useEntityTableSelection<T>(
  objectForRow: (row: T) => ObjectRef | null,
): EntityTableSelectionBinding<T> {
  const selection = useSelection();
  const getRowSelectionKey = useCallback(
    (row: T): string | undefined => {
      const object = objectForRow(row);
      return object === null ? undefined : objectKey(object);
    },
    [objectForRow],
  );
  const onSelectionCommand = useCallback(
    (command: EntityTableSelectionCommand): void => {
      const intent = entityTableSelectionIntent(command);
      if (intent === null) return;
      selection.dispatchInOrder(intent, command.orderedSelectionKeys);
    },
    [selection],
  );

  return useMemo(
    () => ({
      selected: selection.selectedKeys,
      getRowSelectionKey,
      selectionAnchorKey: selection.anchorKey,
      onSelectionCommand,
    }),
    [getRowSelectionKey, onSelectionCommand, selection.anchorKey, selection.selectedKeys],
  );
}
