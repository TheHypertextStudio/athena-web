import { describe, expect, it } from 'vitest';

import { clampDialogPoint } from '../../src/components/calendar/use-clamped-dialog-position';

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
});
