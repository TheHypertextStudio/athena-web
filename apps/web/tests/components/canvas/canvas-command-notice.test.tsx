import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { commands } = vi.hoisted(() => ({
  commands: {
    selectedObjects: [],
    notice: {
      title: 'Project moved to trash',
      detail: 'Project with Tasks can be restored',
      offerUndo: true,
      tone: 'status' as const,
    },
    canUndo: true,
    undo: vi.fn(),
    clearNotice: vi.fn(),
  },
}));

vi.mock('../../../src/components/canvas/canvas-command-context', () => ({
  useCanvasCommandContext: () => commands,
}));

import CanvasCommandNotice from '../../../src/components/canvas/canvas-command-notice';

describe('CanvasCommandNotice', () => {
  it('keeps trash Undo available after the command prunes the selection', () => {
    render(<CanvasCommandNotice />);

    expect(screen.getByRole('status')).toHaveTextContent('Project moved to trash');
    expect(screen.getByRole('status')).toHaveTextContent('Project with Tasks can be restored');
    expect(screen.getByRole('status')).not.toHaveTextContent('applied');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(commands.undo).toHaveBeenCalledOnce();
  });
});
