import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectRef } from '../../../src/lib/actions/object';
import { ObjectSurface } from '../../../src/components/objects/object-surface';

const initiative: ObjectRef = {
  kind: 'initiative',
  id: 'initiative-1',
  organizationId: 'org-1',
  title: 'Core infrastructure',
  meta: { parentInitiativeId: 'initiative-0', parentLinkId: 'link-1' },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectSurface', () => {
  it('activates from every non-control part of the surface', async () => {
    const onActivate = vi.fn();
    const onChildClick = vi.fn();
    const onDragStart = vi.fn();
    render(
      <ObjectSurface object={initiative} onActivate={onActivate} onDragStart={onDragStart}>
        <div
          data-testid="activatable-row"
          onClick={(event) => {
            onChildClick(event.defaultPrevented);
          }}
        >
          <span>Summary text</span>
          <button type="button">Open menu</button>
          <a
            href="/other"
            onClick={(event) => {
              event.preventDefault();
            }}
          >
            Related link
          </a>
          <input aria-label="Rename" />
        </div>
      </ObjectSurface>,
    );

    expect(screen.getByTestId('activatable-row')).toHaveAttribute('data-drag-state', 'idle');
    await userEvent.click(screen.getByTestId('activatable-row'));
    await userEvent.click(screen.getByText('Summary text'));
    expect(onChildClick).toHaveBeenNthCalledWith(1, false);
    expect(onChildClick).toHaveBeenNthCalledWith(2, false);
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onActivate).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('link', { name: 'Related link' }));
    await userEvent.click(screen.getByRole('textbox', { name: 'Rename' }));
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('opens from Enter on the surface without stealing a nested control key', async () => {
    const onActivate = vi.fn();
    render(
      <ObjectSurface object={initiative} onActivate={onActivate}>
        <div data-testid="keyboard-row" tabIndex={0}>
          <button type="button">Edit</button>
        </div>
      </ObjectSurface>,
    );

    screen.getByTestId('keyboard-row').focus();
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledOnce();

    within(screen.getByTestId('keyboard-row')).getByRole('button', { name: 'Edit' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('lets an enhanced anchor perform its one native activation', async () => {
    const onActivate = vi.fn();
    const onAnchorClick = vi.fn((event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
    });
    render(
      <ObjectSurface object={initiative} onActivate={onActivate} href="/initiatives/initiative-1">
        <a href="/initiatives/initiative-1" onClick={onAnchorClick}>
          Core infrastructure
        </a>
      </ObjectSurface>,
    );

    await userEvent.click(screen.getByRole('link', { name: 'Core infrastructure' }));
    expect(onAnchorClick).toHaveBeenCalledOnce();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('lets an enhanced native button activate from Enter', async () => {
    const onClick = vi.fn();
    render(
      <ObjectSurface object={initiative}>
        <button type="button" onClick={onClick}>
          Create relationship
        </button>
      </ObjectSurface>,
    );

    screen.getByRole('button', { name: 'Create relationship' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('registers the object body with the shared transport without native draggable state', async () => {
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
    expect(row).not.toHaveAttribute('draggable');
    expect(row).toHaveClass('cursor-grab');
    expect(row).toHaveClass('rounded-xl');
    expect(row.querySelector('[data-drag-handle]')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    expect(onNestedClick).toHaveBeenCalledOnce();
  });

  it('keeps a non-draggable object context-addressable without a grab cursor', () => {
    render(
      <ObjectSurface object={initiative} dragDisabled>
        <div data-testid="read-only-initiative" />
      </ObjectSurface>,
    );

    const row = screen.getByTestId('read-only-initiative');
    expect(row).toHaveAttribute('data-object-kind', 'initiative');
    expect(row).not.toHaveAttribute('draggable');
    expect(row).not.toHaveClass('cursor-grab');
  });

  it('makes every reference surface non-draggable without trusting its caller', () => {
    render(
      <ObjectSurface object={initiative} actionScope="reference">
        <div data-testid="reference-initiative" />
      </ObjectSurface>,
    );

    const row = screen.getByTestId('reference-initiative');
    expect(row).toHaveAttribute('data-object-action-scope', 'reference');
    expect(row).not.toHaveClass('cursor-grab');
  });

  it('lets the object sensor see Alt presses while shielding the spatial parent', () => {
    const parentPointerDown = vi.fn();
    const objectPointerDown = vi.fn();
    const { container } = render(
      <div data-testid="spatial-parent">
        <ObjectSurface object={initiative} associationModifier="alt">
          <div data-testid="spatial-object" />
        </ObjectSurface>
      </div>,
    );
    const parent = screen.getByTestId('spatial-parent');
    const object = screen.getByTestId('spatial-object');
    parent.addEventListener('pointerdown', parentPointerDown);
    object.addEventListener('pointerdown', objectPointerDown);

    fireEvent.pointerDown(object, { pointerType: 'mouse', altKey: true });
    expect(objectPointerDown).toHaveBeenCalledOnce();
    expect(parentPointerDown).not.toHaveBeenCalled();

    fireEvent.pointerDown(object, { pointerType: 'mouse', altKey: false });
    expect(parentPointerDown).toHaveBeenCalledOnce();
    expect(container).toContainElement(object);
  });
});
