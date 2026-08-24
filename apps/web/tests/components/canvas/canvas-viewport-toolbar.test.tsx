import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { fitView, onRelayout } = vi.hoisted(() => ({
  fitView: vi.fn(),
  onRelayout: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: ReactNode }) => <>{children}</>,
  useReactFlow: () => ({
    fitView,
    getNodes: () => [{ id: 'project-a', selected: true }],
  }),
  useOnSelectionChange: () => undefined,
}));

import CanvasViewportToolbar from '../../../src/components/canvas/canvas-viewport-toolbar';

describe('CanvasViewportToolbar', () => {
  it('exposes fit selection and deterministic re-layout without a context menu', () => {
    render(<CanvasViewportToolbar onRelayout={onRelayout} />);

    fireEvent.click(screen.getByRole('button', { name: 'Fit selection' }));
    expect(fitView).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [{ id: 'project-a', selected: true }], maxZoom: 1 }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Re-layout' }));
    expect(onRelayout).toHaveBeenCalledOnce();
  });
});
