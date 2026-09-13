import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AthenaContextChip,
  contextChipLabel,
} from '../../src/components/athena/athena-context-chip';

afterEach(cleanup);

const projectContext = {
  workspaceId: 'ws_1',
  workspaceName: 'Harbor Health',
  source: { type: 'project' as const, id: 'project_1', label: 'Fall fundraiser launch' },
};

describe('contextChipLabel', () => {
  it('names the source when it has a label', () => {
    expect(contextChipLabel(projectContext)).toBe('Fall fundraiser launch');
  });

  it('falls back to the workspace name', () => {
    expect(contextChipLabel({ workspaceId: 'ws_1', workspaceName: 'Harbor Health' })).toBe(
      'Harbor Health',
    );
  });

  it('returns null with nothing to show', () => {
    expect(contextChipLabel({ workspaceId: 'ws_1' })).toBeNull();
  });
});

describe('AthenaContextChip', () => {
  it('renders nothing without a context', () => {
    const { container } = render(
      <AthenaContextChip context={null} attached onDetach={vi.fn()} onAttach={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers to detach an attached page', () => {
    const onDetach = vi.fn();
    render(
      <AthenaContextChip
        context={projectContext}
        attached
        onDetach={onDetach}
        onAttach={vi.fn()}
      />,
    );
    const chip = screen.getByRole('group', { name: /Fall fundraiser launch/ });
    expect(chip).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Detach/ }));
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it('offers to reattach a detached page', () => {
    const onAttach = vi.fn();
    render(
      <AthenaContextChip
        context={projectContext}
        attached={false}
        onDetach={vi.fn()}
        onAttach={onAttach}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Fall fundraiser launch/ }));
    expect(onAttach).toHaveBeenCalledTimes(1);
  });

  it('keeps a long label inside its container', () => {
    const longLabel = 'x'.repeat(200);
    const longContext = {
      workspaceId: 'ws_1',
      workspaceName: 'Harbor Health',
      source: { type: 'task' as const, id: 'task_1', label: longLabel },
    };
    const { container } = render(
      <div style={{ width: '240px' }}>
        <AthenaContextChip context={longContext} attached onDetach={vi.fn()} onAttach={vi.fn()} />
      </div>,
    );

    // The Chip primitive's outer element (the one carrying its merged `className`) is the one
    // marked `data-chip-variant="input"`. It must be allowed to shrink below its content size and
    // must not carry the primitive's default `shrink-0`, or a long label pushes the composer wide.
    // The primitive also sets an unrelated `[&_svg]:shrink-0` variant on its icon, so these match
    // "shrink"/"shrink-0" as whole class tokens rather than as a plain substring.
    const chip = container.querySelector('[data-chip-variant="input"]');
    expect(chip).not.toBeNull();
    expect(chip?.className).toMatch(/(?:^|\s)shrink(?:\s|$)/);
    expect(chip?.className).not.toMatch(/(?:^|\s)shrink-0(?:\s|$)/);
    expect(chip?.className).toMatch(/(?:^|\s)min-w-0(?:\s|$)/);

    const labelSpan = container.querySelector('span.truncate:not(.min-w-0)');
    expect(labelSpan).not.toBeNull();
    expect(labelSpan?.className).toMatch(/truncate/);
  });
});
