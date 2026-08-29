'use client';

import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Minimal viewport rectangle needed to relate a portaled dialog to its virtual anchor. */
export interface DialogRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Explicit local rectangle owned by the shared hosted-dialog presentation. */
export interface HostedDialogPosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly maxHeight: number;
}

interface AnchorPlacementOptions {
  readonly gap?: number;
  readonly inset?: number;
  readonly titleOffset?: number;
}

interface DialogAnchorRef {
  readonly current: { readonly getBoundingClientRect: () => DOMRect } | null;
}

function preserveEqualPoint(current: Point, next: Point): Point {
  return current.x === next.x && current.y === next.y ? current : next;
}

/** Keep a panel wholly inside its shell-owned host with a small breathing-space inset. */
export function clampDialogPoint(
  point: Point,
  host: { readonly width: number; readonly height: number },
  dialog: { readonly width: number; readonly height: number },
  inset = 16,
): Point {
  return {
    x: Math.min(Math.max(point.x, inset), Math.max(inset, host.width - dialog.width - inset)),
    y: Math.min(Math.max(point.y, inset), Math.max(inset, host.height - dialog.height - inset)),
  };
}

/** Default quick-create placement: hug the Agenda edge and follow the selected region. */
export function defaultDialogPoint(
  host: { readonly width: number; readonly height: number },
  dialog: { readonly width: number; readonly height: number },
  preferredTop: number,
  inset = 16,
): Point {
  return clampDialogPoint(
    { x: host.width - dialog.width - inset, y: preferredTop },
    host,
    dialog,
    inset,
  );
}

/** Place a portaled dialog beside its virtual anchor, then resolve shell collisions. */
export function anchoredDialogPoint(
  host: DialogRect,
  dialog: { readonly width: number; readonly height: number },
  anchor: DialogRect,
  { gap = 12, inset = 16, titleOffset = 72 }: AnchorPlacementOptions = {},
): Point {
  const minX = inset;
  const maxX = Math.max(inset, host.width - dialog.width - inset);
  const left = anchor.left - host.left - dialog.width - gap;
  const right = anchor.left + anchor.width - host.left + gap;
  const fits = (x: number): boolean => x >= minX && x <= maxX;
  const clampX = (x: number): number => Math.min(Math.max(x, minX), maxX);
  const preferredX = fits(left)
    ? left
    : fits(right)
      ? right
      : Math.abs(left - clampX(left)) <= Math.abs(right - clampX(right))
        ? left
        : right;

  return clampDialogPoint(
    { x: preferredX, y: anchor.top - host.top - titleOffset },
    host,
    dialog,
    inset,
  );
}

/** Position and drag a dialog within the primary shell column, never across the Agenda boundary. */
export function useClampedDialogPosition({
  open,
  host,
  anchorRef,
  anchorKey,
  preferredTop = 48,
}: {
  readonly open: boolean;
  readonly host: HTMLElement | null;
  readonly anchorRef?: DialogAnchorRef | undefined;
  readonly anchorKey?: string | null | undefined;
  readonly preferredTop?: number | undefined;
}): {
  readonly dialogRef: React.RefObject<HTMLDivElement | null>;
  readonly presentation: HostedDialogPosition;
  readonly handlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
} {
  const dialogRef = useRef<HTMLDivElement>(null);
  const manuallyPositionedRef = useRef(false);
  const [point, setPoint] = useState<Point>({ x: 16, y: preferredTop });

  const clamp = useCallback(
    (next: Point): Point => {
      const dialog = dialogRef.current;
      if (!host || !dialog) return next;
      return clampDialogPoint(next, host.getBoundingClientRect(), dialog.getBoundingClientRect());
    },
    [host],
  );

  useEffect(() => {
    if (!open || !host) {
      manuallyPositionedRef.current = false;
      return;
    }
    const place = (): void => {
      const dialog = dialogRef.current;
      if (!dialog || manuallyPositionedRef.current) return;
      const hostRect = host.getBoundingClientRect();
      const dialogRect = dialog.getBoundingClientRect();
      const anchorRect = anchorRef?.current?.getBoundingClientRect();
      setPoint((current) =>
        preserveEqualPoint(
          current,
          anchorRect
            ? anchoredDialogPoint(hostRect, dialogRect, anchorRect)
            : defaultDialogPoint(hostRect, dialogRect, preferredTop),
        ),
      );
    };
    const frame = window.requestAnimationFrame(place);
    const observer = new ResizeObserver(() => {
      if (manuallyPositionedRef.current) {
        setPoint((current) => preserveEqualPoint(current, clamp(current)));
      } else {
        place();
      }
    });
    observer.observe(host);
    if (dialogRef.current) observer.observe(dialogRef.current);
    const anchor = anchorRef?.current;
    if (anchor instanceof Element) observer.observe(anchor);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [anchorKey, anchorRef, clamp, host, open, preferredTop]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      manuallyPositionedRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      const origin = { x: event.clientX, y: event.clientY };
      const initial = point;
      const target = event.currentTarget;
      const move = (moveEvent: PointerEvent): void => {
        setPoint((current) =>
          preserveEqualPoint(
            current,
            clamp({
              x: initial.x + moveEvent.clientX - origin.x,
              y: initial.y + moveEvent.clientY - origin.y,
            }),
          ),
        );
      };
      const stop = (): void => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', stop);
        target.removeEventListener('pointercancel', stop);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', stop);
      target.addEventListener('pointercancel', stop);
    },
    [clamp, point],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      const delta = event.shiftKey ? 24 : 8;
      const offset =
        event.key === 'ArrowLeft'
          ? { x: -delta, y: 0 }
          : event.key === 'ArrowRight'
            ? { x: delta, y: 0 }
            : event.key === 'ArrowUp'
              ? { x: 0, y: -delta }
              : event.key === 'ArrowDown'
                ? { x: 0, y: delta }
                : null;
      if (!offset) return;
      event.preventDefault();
      manuallyPositionedRef.current = true;
      setPoint((current) =>
        preserveEqualPoint(current, clamp({ x: current.x + offset.x, y: current.y + offset.y })),
      );
    },
    [clamp],
  );

  return {
    dialogRef,
    presentation: {
      left: point.x,
      top: point.y,
      width: host ? Math.min(544, Math.max(0, host.clientWidth - 32)) : 544,
      maxHeight: host ? Math.max(0, host.clientHeight - 32) : 768,
    },
    handlePointerDown,
    handleKeyDown,
  };
}
