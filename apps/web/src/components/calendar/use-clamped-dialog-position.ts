'use client';

import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Point {
  readonly x: number;
  readonly y: number;
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

/** Position and drag a dialog within the primary shell column, never across the Agenda boundary. */
export function useClampedDialogPosition({
  open,
  host,
  preferredTop = 48,
}: {
  readonly open: boolean;
  readonly host: HTMLElement | null;
  readonly preferredTop?: number;
}): {
  readonly dialogRef: React.RefObject<HTMLDivElement | null>;
  readonly style: CSSProperties;
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
      setPoint((current) =>
        preserveEqualPoint(
          current,
          clampDialogPoint(
            { x: (hostRect.width - dialogRect.width) / 2, y: preferredTop },
            hostRect,
            dialogRect,
          ),
        ),
      );
    };
    const frame = window.requestAnimationFrame(place);
    const observer = new ResizeObserver(() => {
      setPoint((current) => preserveEqualPoint(current, clamp(current)));
    });
    observer.observe(host);
    if (dialogRef.current) observer.observe(dialogRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [clamp, host, open, preferredTop]);

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
      setPoint((current) =>
        preserveEqualPoint(current, clamp({ x: current.x + offset.x, y: current.y + offset.y })),
      );
    },
    [clamp],
  );

  return {
    dialogRef,
    style: { left: point.x, top: point.y, transform: 'none' },
    handlePointerDown,
    handleKeyDown,
  };
}
