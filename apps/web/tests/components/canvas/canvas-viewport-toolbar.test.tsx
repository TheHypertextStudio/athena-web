import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fitView, zoomIn, zoomOut, onRelayout, flowState } = vi.hoisted(() => ({
  fitView: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  onRelayout: vi.fn(),
  flowState: { nodes: [] as { id: string; selected: boolean }[] },
}));

vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: ReactNode }) => <>{children}</>,
  useReactFlow: () => ({
    fitView,
    zoomIn,
    zoomOut,
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
    render(
      <CanvasViewportToolbar
        onRelayout={onRelayout}
        fitPadding={{ top: '24px', right: '24px', bottom: '24px', left: '24px' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fit selection' }));
    expect(fitView).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: [{ id: 'project-a', selected: true }],
        maxZoom: 1,
        padding: { top: '24px', right: '24px', bottom: '24px', left: '24px' },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Re-layout' }));
    expect(onRelayout).toHaveBeenCalledOnce();
  });

  it('zooms and fits the whole view from the same row', () => {
    render(<CanvasViewportToolbar onRelayout={onRelayout} fitPadding={0.2} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoomIn).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(zoomOut).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Fit to view' }));
    expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ padding: 0.2, maxZoom: 1 }));
    expect(fitView.mock.calls[0]?.[0]).not.toHaveProperty('nodes');
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
