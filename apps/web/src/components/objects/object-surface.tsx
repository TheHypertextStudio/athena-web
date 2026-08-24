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
  type HTMLAttributes,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type Ref,
  useEffect,
  useRef,
} from 'react';

import { useDraggable } from '@/components/dnd/use-draggable';
import { objectTargetProps, type ObjectRef } from '@/lib/actions/object';

/** The root props an {@link ObjectSurface} can safely compose. */
type ObjectSurfaceChildProps = HTMLAttributes<HTMLElement> & {
  readonly ref?: Ref<HTMLElement>;
  readonly 'data-drag-state'?: 'idle' | 'dragging';
  readonly 'data-association-modifier'?: 'alt';
};

/** Assign one element to an object or callback ref. */
function assignRef(ref: Ref<HTMLElement> | undefined, element: HTMLElement | null): void {
  if (typeof ref === 'function') ref(element);
  else if (ref) ref.current = element;
}

/** Return whether the event started from a nested control that owns its activation. */
function isInteractiveTarget(target: EventTarget, surface: EventTarget): boolean {
  const control = (target as HTMLElement).closest(
    'a, button, input, textarea, select, [contenteditable="true"], [role="button"]',
  );
  return control !== null && control !== surface;
}

/** Return whether the enhanced root already provides native anchor activation. */
function isNativeAnchor(surface: EventTarget): boolean {
  return surface instanceof HTMLAnchorElement && surface.hasAttribute('href');
}

/** Open a row destination with ordinary anchor modifier semantics. */
function activateHref(href: string, newTab: boolean): void {
  const anchor = document.createElement('a');
  anchor.setAttribute('href', href);
  if (newTab) {
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }
  anchor.click();
}

/** Props for {@link ObjectSurface}. */
export interface ObjectSurfaceProps {
  /** The canonical identity and action context for the rendered object. */
  readonly object: ObjectRef;
  /** Suppress movement while retaining object identity and right-click actions. */
  readonly dragDisabled?: boolean | undefined;
  /** The selection/list surface recorded as the drag origin. */
  readonly surfaceId?: string | undefined;
  /** Require Option/Alt for mouse or pen association drags on a spatially movable object. */
  readonly associationModifier?: 'alt' | undefined;
  /** Native detail destination used when no explicit activation callback is supplied. */
  readonly href?: string | undefined;
  /** Activate the object when a non-control part of the surface is clicked. */
  readonly onActivate?:
    | ((event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>) => void)
    | undefined;
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
  associationModifier,
  href,
  onActivate,
  onDragStart,
  onDragEnd,
  children,
}: ObjectSurfaceProps): JSX.Element {
  const suppressActivationRef = useRef(false);
  const surfaceElementRef = useRef<HTMLElement | null>(null);
  const drag = useDraggable({
    object,
    disabled: dragDisabled,
    surfaceId,
    onDragStart: () => {
      suppressActivationRef.current = true;
      onDragStart?.();
    },
    onDragEnd,
  });
  const childProps = children.props;

  useEffect(() => {
    const surfaceElement = surfaceElementRef.current;
    if (surfaceElement === null || associationModifier !== 'alt') return;
    const stopSpatialGesture = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch' && event.altKey) event.stopPropagation();
    };
    surfaceElement.addEventListener('pointerdown', stopSpatialGesture);
    return () => {
      surfaceElement.removeEventListener('pointerdown', stopSpatialGesture);
    };
  }, [associationModifier]);

  return cloneElement(children, {
    ...objectTargetProps(object),
    ref: (element: HTMLElement | null) => {
      drag.ref(element);
      assignRef(childProps.ref, element);
      surfaceElementRef.current = element;
    },
    'data-drag-state': drag['data-drag-state'],
    ...(associationModifier === undefined
      ? {}
      : { 'data-association-modifier': associationModifier }),
    onPointerDownCapture: (event) => {
      childProps.onPointerDownCapture?.(event);
    },
    className: cn(childProps.className, drag.className),
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      childProps.onClick?.(event);
      if (event.defaultPrevented) return;
      if (suppressActivationRef.current) {
        suppressActivationRef.current = false;
        return;
      }
      if (isNativeAnchor(event.currentTarget)) return;
      if (isInteractiveTarget(event.target, event.currentTarget)) return;
      if (onActivate) onActivate(event);
      else if (href)
        activateHref(href, event.button === 1 || event.metaKey || event.ctrlKey || event.shiftKey);
    },
    onAuxClick: (event: ReactMouseEvent<HTMLElement>) => {
      childProps.onAuxClick?.(event);
      if (
        event.defaultPrevented ||
        event.button !== 1 ||
        isInteractiveTarget(event.target, event.currentTarget)
      )
        return;
      if (suppressActivationRef.current) {
        suppressActivationRef.current = false;
        return;
      }
      if (isNativeAnchor(event.currentTarget)) return;
      if (onActivate) onActivate(event);
      else if (href) activateHref(href, true);
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      childProps.onKeyDown?.(event);
      if (
        event.defaultPrevented ||
        event.key !== 'Enter' ||
        isNativeAnchor(event.currentTarget) ||
        isInteractiveTarget(event.target, event.currentTarget)
      )
        return;
      event.preventDefault();
      if (onActivate) onActivate(event);
      else if (href) activateHref(href, false);
    },
  });
}
