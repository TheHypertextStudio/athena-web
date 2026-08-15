'use client';

/**
 * A zero-wrapper binding that makes any rendered core object behave like that object everywhere.
 *
 * @remarks
 * Containers supply layout through the child element. This component supplies identity,
 * right-click targeting, and handle-free whole-body dragging by composing the existing global
 * object and drag contracts onto that element. Nested links and buttons remain ordinary nested
 * controls; there is no permanent drag affordance to compete with them.
 */
import { cn } from '@docket/ui/lib/utils';
import {
  cloneElement,
  type DragEvent as ReactDragEvent,
  type HTMLAttributes,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  useRef,
} from 'react';

import { useDraggable } from '@/components/dnd/use-draggable';
import { objectTargetProps, type ObjectRef } from '@/lib/actions/object';

/** The root props an {@link ObjectSurface} can safely compose. */
type ObjectSurfaceChildProps = HTMLAttributes<HTMLElement>;

/** Props for {@link ObjectSurface}. */
export interface ObjectSurfaceProps {
  /** The canonical identity and action context for the rendered object. */
  readonly object: ObjectRef;
  /** Suppress movement while retaining object identity and right-click actions. */
  readonly dragDisabled?: boolean | undefined;
  /** The selection/list surface recorded as the drag origin. */
  readonly surfaceId?: string | undefined;
  /** Called after a body drag begins. */
  readonly onDragStart?: (() => void) | undefined;
  /** Called when a body drag ends or is cancelled. */
  readonly onDragEnd?: (() => void) | undefined;
  /** A single element that already owns the surface's layout. No wrapper is rendered. */
  readonly children: ReactElement<ObjectSurfaceChildProps>;
}

/**
 * Apply the standard object interaction contract to one existing element without adding DOM.
 *
 * @param props - Object identity, drag policy, and the element to enhance.
 * @returns The cloned child with global object and drag bindings.
 */
export function ObjectSurface({
  object,
  dragDisabled = false,
  surfaceId,
  onDragStart,
  onDragEnd,
  children,
}: ObjectSurfaceProps): JSX.Element {
  const drag = useDraggable({ object, disabled: dragDisabled, surfaceId, onDragStart, onDragEnd });
  const childProps = children.props;
  const dragBlockedRef = useRef(false);

  return cloneElement(children, {
    ...objectTargetProps(object),
    draggable: drag.draggable,
    className: cn(childProps.className, drag.className),
    onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => {
      childProps.onPointerDownCapture?.(event);
      dragBlockedRef.current =
        (event.target as HTMLElement).closest(
          'a, button, input, textarea, select, [contenteditable="true"], [role="button"]',
        ) !== null;
    },
    onDragStart: (event: ReactDragEvent<HTMLElement>) => {
      childProps.onDragStart?.(event);
      if (dragBlockedRef.current) {
        event.preventDefault();
        dragBlockedRef.current = false;
        return;
      }
      if (!event.defaultPrevented) drag.onDragStart(event);
    },
    onDragEnd: (event: ReactDragEvent<HTMLElement>) => {
      childProps.onDragEnd?.(event);
      dragBlockedRef.current = false;
      drag.onDragEnd(event);
    },
  });
}
