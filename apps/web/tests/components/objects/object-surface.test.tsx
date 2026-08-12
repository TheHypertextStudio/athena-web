import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectRef } from '../../../src/lib/actions/object';
import { readObjectPayload } from '../../../src/components/dnd/drag-payload';
import { ObjectSurface } from '../../../src/components/objects/object-surface';
import { fakeDataTransfer } from '../../interactivity/harness';

const initiative: ObjectRef = {
  kind: 'initiative',
  id: 'initiative-1',
  organizationId: 'org-1',
  title: 'Core infrastructure',
  meta: { parentInitiativeId: 'initiative-0', parentLinkId: 'link-1' },
};

afterEach(() => {
  cleanup();
});

describe('ObjectSurface', () => {
  it('makes the object body draggable and context-addressable without swallowing nested controls', async () => {
    const onNestedClick = vi.fn();
    render(
      <ObjectSurface object={initiative} surfaceId="initiative-list">
        <div data-testid="initiative-row" className="rounded-xl">
          <button type="button" onClick={onNestedClick}>
            Edit title
          </button>
        </div>
      </ObjectSurface>,
    );

    const row = screen.getByTestId('initiative-row');
    expect(row).toHaveAttribute('data-object-kind', 'initiative');
    expect(row).toHaveAttribute('data-object-id', 'initiative-1');
    expect(row).toHaveAttribute('data-object-org', 'org-1');
    expect(row).toHaveAttribute('draggable', 'true');
    expect(row).toHaveClass('cursor-grab');
    expect(row).toHaveClass('rounded-xl');
    expect(row.querySelector('[data-drag-handle]')).toBeNull();

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(row, { dataTransfer });
    expect(readObjectPayload(dataTransfer)).toEqual(initiative);

    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    expect(onNestedClick).toHaveBeenCalledOnce();

    const nestedTransfer = fakeDataTransfer();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Edit title' }));
    const blockedDrag = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(blockedDrag, 'dataTransfer', { value: nestedTransfer });
    fireEvent(row, blockedDrag);
    expect(blockedDrag.defaultPrevented).toBe(true);
    expect(readObjectPayload(nestedTransfer)).toBeNull();
  });

  it('keeps a non-draggable object context-addressable without a grab cursor', () => {
    render(
      <ObjectSurface object={initiative} dragDisabled>
        <div data-testid="read-only-initiative" />
      </ObjectSurface>,
    );

    const row = screen.getByTestId('read-only-initiative');
    expect(row).toHaveAttribute('data-object-kind', 'initiative');
    expect(row).toHaveAttribute('draggable', 'false');
    expect(row).not.toHaveClass('cursor-grab');
  });
});
