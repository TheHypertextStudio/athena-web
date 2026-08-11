import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  anchoredDialogPoint,
  clampDialogPoint,
  defaultDialogPoint,
  useClampedDialogPosition,
} from '../../src/components/calendar/use-clamped-dialog-position';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clampDialogPoint', () => {
  it('keeps every dialog edge inside the primary shell host', () => {
    expect(
      clampDialogPoint(
        { x: 900, y: 700 },
        { width: 800, height: 600 },
        { width: 420, height: 360 },
      ),
    ).toEqual({ x: 364, y: 224 });
    expect(
      clampDialogPoint(
        { x: -100, y: -40 },
        { width: 800, height: 600 },
        { width: 420, height: 360 },
      ),
    ).toEqual({ x: 16, y: 16 });
  });

  it('pins an oversized dialog to the inset instead of crossing the host boundary', () => {
    expect(
      clampDialogPoint({ x: 80, y: 80 }, { width: 320, height: 240 }, { width: 420, height: 360 }),
    ).toEqual({ x: 16, y: 16 });
  });

  it('hugs the Agenda boundary while following the selected region vertically', () => {
    expect(
      defaultDialogPoint({ width: 1_000, height: 800 }, { width: 420, height: 500 }, 180),
    ).toEqual({ x: 564, y: 180 });
  });

  it('converts the selected draft viewport rectangle into host-local portal coordinates', () => {
    expect(
      anchoredDialogPoint(
        { left: 256, top: 8, width: 840, height: 884 },
        { width: 544, height: 366 },
        { left: 1142, top: 173, width: 230, height: 24 },
      ),
    ).toEqual({ x: 280, y: 93 });
  });

  it('flips beside a left-edge draft before applying collision correction', () => {
    expect(
      anchoredDialogPoint(
        { left: 400, top: 0, width: 900, height: 700 },
        { width: 420, height: 360 },
        { left: 420, top: 30, width: 80, height: 40 },
      ),
    ).toEqual({ x: 112, y: 16 });
  });

  it('chooses the side requiring less correction when neither side fits', () => {
    expect(
      anchoredDialogPoint(
        { left: 0, top: 0, width: 500, height: 600 },
        { width: 420, height: 360 },
        { left: 100, top: 580, width: 20, height: 20 },
      ),
    ).toEqual({ x: 64, y: 224 });
  });

  it('resolves a committed virtual anchor and preserves keyboard-moved ownership', () => {
    const frames: FrameRequestCallback[] = [];
    const resizeCallbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe(): void {
          return undefined;
        }
        disconnect(): void {
          return undefined;
        }
      },
    );

    const host = document.createElement('div');
    host.getBoundingClientRect = () => ({ left: 256, top: 8, width: 840, height: 884 }) as DOMRect;
    const dialog = document.createElement('div');
    dialog.getBoundingClientRect = () => ({ width: 544, height: 366 }) as DOMRect;
    let anchorTop = 173;
    const anchorRef = {
      current: {
        getBoundingClientRect: () =>
          ({ left: 1142, top: anchorTop, width: 230, height: 24 }) as DOMRect,
      },
    };

    const { result } = renderHook(() =>
      useClampedDialogPosition({
        open: true,
        host,
        anchorRef,
        anchorKey: 'timed:2026-08-10T17:00:00Z',
      }),
    );
    result.current.dialogRef.current = dialog;
    act(() => {
      frames.shift()?.(0);
    });
    expect(result.current.style).toMatchObject({ left: 280, top: 93 });

    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowLeft',
        shiftKey: false,
        preventDefault: vi.fn(),
      } as never);
    });
    expect(result.current.style).toMatchObject({ left: 272, top: 93 });

    anchorTop = 400;
    act(() => {
      resizeCallbacks[0]?.([], {} as ResizeObserver);
    });
    expect(result.current.style).toMatchObject({ left: 272, top: 93 });
  });
});
