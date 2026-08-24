import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fitView, onRelayout, flowState } = vi.hoisted(() => ({
  fitView: vi.fn(),
  onRelayout: vi.fn(),
  flowState: { nodes: [] as { id: string; selected: boolean }[] },
}));

vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: ReactNode }) => <>{children}</>,
  useReactFlow: () => ({
    fitView,
    getNodes: () => flowState.nodes,
  }),
  useStore: (selector: (state: typeof flowState) => unknown) => selector(flowState),
}));

import CanvasViewportToolbar from '../../../src/components/canvas/canvas-viewport-toolbar';

describe('CanvasViewportToolbar', () => {
  beforeEach(() => {
    flowState.nodes = [{ id: 'project-a', selected: true }];
    fitView.mockReset();
    onRelayout.mockReset();
  });

  it('exposes fit selection and deterministic re-layout without a context menu', () => {
    render(<CanvasViewportToolbar onRelayout={onRelayout} />);

    fireEvent.click(screen.getByRole('button', { name: 'Fit selection' }));
    expect(fitView).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [{ id: 'project-a', selected: true }], maxZoom: 1 }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Re-layout' }));
    expect(onRelayout).toHaveBeenCalledOnce();
  });

  it('updates Fit selection when the controlled flow store changes selection', () => {
    flowState.nodes = [];
    const { rerender } = render(<CanvasViewportToolbar onRelayout={onRelayout} />);
    expect(screen.getByRole('button', { name: 'Fit selection' })).toBeDisabled();

    flowState.nodes = [{ id: 'project-a', selected: true }];
    rerender(<CanvasViewportToolbar onRelayout={onRelayout} />);

    expect(screen.getByRole('button', { name: 'Fit selection' })).toBeEnabled();
  });
});
