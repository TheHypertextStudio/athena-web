'use client';

/**
 * Object System Context Providers
 *
 * Exports all context providers and a combined provider for the object system.
 */

import type { ReactNode } from 'react';

// Export individual contexts
export {
  ObjectRegistryProvider,
  useObjectRegistry,
  useObjectSearch,
} from './ObjectRegistryContext';

export {
  SelectionProvider,
  useSelection,
  useIsSelected,
  useSelectionHandlers,
} from './SelectionContext';

export {
  DragDropProvider,
  useDragDrop,
  useIsDragged,
  useIsDragging,
  useDraggedType,
  useDropAcceptTypes,
} from './DragDropContext';

export { ActionProvider, useActions, useSelectionActions, useObjectActions } from './ActionContext';

// Import for combined provider
import { ObjectRegistryProvider } from './ObjectRegistryContext';
import { SelectionProvider } from './SelectionContext';
import { DragDropProvider } from './DragDropContext';
import { ActionProvider } from './ActionContext';

// =============================================================================
// Combined Provider
// =============================================================================

interface ObjectSystemProviderProps {
  children: ReactNode;
}

/**
 * Combined provider that sets up the complete object system context.
 * Use this at the app root to enable all object system features.
 *
 * Context hierarchy:
 * - ObjectRegistry: Global object awareness
 * - Selection: Selection state
 * - DragDrop: Unified drag/drop
 * - Action: Action dispatch
 */
export function ObjectSystemProvider({ children }: ObjectSystemProviderProps) {
  return (
    <ObjectRegistryProvider>
      <SelectionProvider>
        <DragDropProvider>
          <ActionProvider>{children}</ActionProvider>
        </DragDropProvider>
      </SelectionProvider>
    </ObjectRegistryProvider>
  );
}
