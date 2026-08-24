import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let handlers: { readonly onDragStart?: () => void; readonly onDragEnd?: () => void } = {};

vi.mock('../../../src/components/dnd/use-draggable', () => ({
  useDraggable: (options: typeof handlers) => {
    handlers = options;
    return {
      ref: () => undefined,
      className: 'cursor-grab',
      'data-drag-state': 'idle' as const,
    };
  },
}));

const { ObjectSurface } = await import('../../../src/components/objects/object-surface');

afterEach(() => {
  cleanup();
  handlers = {};
});

describe('ObjectSurface drag activation suppression', () => {
  it('consumes the trailing click after a completed or cancelled drag', () => {
    const onActivate = vi.fn();
    render(
      <ObjectSurface
        object={{
          kind: 'project',
          id: 'project-1',
          organizationId: 'org-1',
          title: 'Launch',
        }}
        onActivate={onActivate}
      >
        <div data-testid="row">Launch</div>
      </ObjectSurface>,
    );

    act(() => {
      handlers.onDragStart?.();
      handlers.onDragEnd?.();
    });
    fireEvent.click(screen.getByTestId('row'));
    expect(onActivate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('row'));
    expect(onActivate).toHaveBeenCalledOnce();
  });
});
