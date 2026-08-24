import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { focusCanvasNode } from '../../../src/components/canvas/focus-canvas-node';

describe('focusCanvasNode', () => {
  it('focuses a duplicate node id only inside the invoking canvas', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    render(
      <>
        <div data-selection-surface="canvas-a">
          <div className="react-flow__node" data-id="shared-node">
            <button type="button" role="treeitem" data-object-id="shared-node">
              First canvas node
            </button>
          </div>
        </div>
        <div data-selection-surface="canvas-b">
          <div className="react-flow__node" data-id="shared-node">
            <button type="button" role="treeitem" data-object-id="shared-node">
              Second canvas node
            </button>
          </div>
        </div>
      </>,
    );

    focusCanvasNode('canvas-b', 'shared-node');

    expect(document.activeElement).toBe(
      screen.getByRole('treeitem', { name: 'Second canvas node' }),
    );
  });
});
