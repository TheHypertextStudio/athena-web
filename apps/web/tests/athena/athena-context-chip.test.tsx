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
});
