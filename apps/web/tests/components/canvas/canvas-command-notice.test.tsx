import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { commands } = vi.hoisted(() => ({
  commands: {
    selectedObjects: [],
    notice: { copy: 'Moved Project to trash.', offerUndo: true, tone: 'status' as const },
    canUndo: true,
    undo: vi.fn(),
    clearNotice: vi.fn(),
  },
}));

vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../src/components/canvas/canvas-command-context', () => ({
  useCanvasCommandContext: () => commands,
}));

import CanvasCommandNotice from '../../../src/components/canvas/canvas-command-notice';

describe('CanvasCommandNotice', () => {
  it('keeps trash Undo available after the command prunes the selection', () => {
    render(<CanvasCommandNotice />);

    expect(screen.getByRole('status')).toHaveTextContent('Moved Project to trash.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(commands.undo).toHaveBeenCalledOnce();
  });
});
