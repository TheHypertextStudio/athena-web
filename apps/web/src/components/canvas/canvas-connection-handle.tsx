'use client';

import { cn } from '@docket/ui/lib/utils';
import { Handle, type HandleProps, Position } from '@xyflow/react';
import type { KeyboardEvent } from 'react';

/**
 * Props for {@link CanvasConnectionHandle}.
 */
export interface CanvasConnectionHandleProps extends Omit<
  HandleProps,
  'aria-label' | 'children' | 'className' | 'onKeyDown' | 'role' | 'tabIndex'
> {
  /** The object name and connection direction announced to assistive technology. */
  label: string;
}

/** Props for the incoming and outgoing handles on one canvas node. */
export interface CanvasConnectionHandlesProps {
  /** Whether this canvas permits dependency changes. */
  isConnectable: boolean;
  /** The Project or Task name included in each control's accessible name. */
  label: string;
}

/**
 * Render a 12px connection marker inside a 32px pointer and keyboard target.
 *
 * @param props - The xyflow handle placement and presentation props.
 * @returns A named connection control that supports drag, click, Enter, and Space operation.
 */
export function CanvasConnectionHandle({
  isConnectable = true,
  label,
  ...props
}: CanvasConnectionHandleProps): React.JSX.Element {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!isConnectable || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.click();
  };

  return (
    <Handle
      {...props}
      isConnectable={isConnectable}
      isConnectableStart={isConnectable}
      isConnectableEnd={isConnectable}
      role={isConnectable ? 'button' : undefined}
      aria-label={isConnectable ? label : undefined}
      aria-hidden={isConnectable ? undefined : true}
      tabIndex={isConnectable ? 0 : -1}
      onKeyDown={handleKeyDown}
      className={cn(
        'group/connection !flex !size-8 !items-center !justify-center !border-0 !bg-transparent !outline-none [@media(pointer:coarse)]:!size-10',
        !isConnectable && '!pointer-events-none',
      )}
    >
      <span
        aria-hidden="true"
        data-canvas-handle-marker
        className={cn(
          'bg-outline pointer-events-none size-3 rounded-full',
          'transition-[width,height,background-color,box-shadow] duration-150',
          'group-hover/connection:bg-primary group-hover/connection:size-4',
          'group-focus-visible/connection:bg-primary group-focus-visible/connection:size-4',
          'group-focus-visible/connection:ring-primary/30 group-focus-visible/connection:ring-4',
          'group-[.clickconnecting]/connection:bg-primary group-[.clickconnecting]/connection:size-4',
          'group-[.connectingfrom]/connection:bg-primary group-[.connectingfrom]/connection:size-4',
          'group-[.valid]/connection:bg-primary group-[.valid]/connection:size-4',
        )}
      />
    </Handle>
  );
}

/** Render the incoming and outgoing connection controls for one horizontal-flow node. */
export function CanvasConnectionHandles({
  isConnectable,
  label,
}: CanvasConnectionHandlesProps): React.JSX.Element {
  return (
    <>
      <CanvasConnectionHandle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        label={`Connect into ${label}`}
      />
      <CanvasConnectionHandle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        label={`Connect from ${label}`}
      />
    </>
  );
}
