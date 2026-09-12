import { MarkerType } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { DEPENDENCY_MARKER_SIZE, dependencyMarkerEnd } from '@/components/canvas/dependency-marker';

describe('dependencyMarkerEnd', () => {
  it('is a closed arrow of one size, coloured only when asked', () => {
    expect(dependencyMarkerEnd()).toEqual({
      type: MarkerType.ArrowClosed,
      width: DEPENDENCY_MARKER_SIZE,
      height: DEPENDENCY_MARKER_SIZE,
    });
    expect(dependencyMarkerEnd('var(--color-primary)')).toMatchObject({
      color: 'var(--color-primary)',
    });
  });
});
