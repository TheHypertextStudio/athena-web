'use client';

/**
 * `components/context-menu/object-more-button` — the visible way into an object's action menu.
 *
 * @remarks
 * The object menu opens on right-click, Shift+F10, or the Menu key, and a phone has none of them.
 * This button raises the same menu through {@link useObjectContextMenu}'s `openFor`, anchored to
 * the button, so the two entry points always offer the same actions for the same object (or the
 * current selection, when the row is part of it). It must sit inside an element that carries
 * `objectTargetProps`, which is how `openFor` finds the object.
 *
 * It is always visible on a touch screen. With a mouse it appears while the row is hovered or the
 * button has keyboard focus, since right-click already covers that pointer. A list that gives it a
 * column of its own drops that column for a mouse ({@link OBJECT_MORE_COLUMN_CLASSNAME}), so rows
 * do not end in a reserved blank.
 */
import { MoreHorizontal } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { useObjectContextMenu } from './object-context-menu';

/**
 * The class for a list's ⋯ column: shown for touch, where it is the way into the menu, and dropped
 * for a mouse, which right-clicks the row instead of reaching past the row's last value.
 */
export const OBJECT_MORE_COLUMN_CLASSNAME = 'pointer-fine:hidden';

/** Props for {@link ObjectMoreButton}. */
export interface ObjectMoreButtonProps {
  /** The object's name, used in the button's accessible label. */
  readonly title: string;
}

/**
 * Render the ⋯ button that opens the enclosing object's action menu.
 *
 * @param props - See {@link ObjectMoreButtonProps}.
 * @returns the button, or `null` outside the object menu provider.
 */
export function ObjectMoreButton({ title }: ObjectMoreButtonProps): JSX.Element | null {
  const menu = useObjectContextMenu();
  if (menu === null) return null;
  return (
    <Button
      variant="ghost"
      iconOnly
      controlSize="sm"
      aria-label={`More actions for ${title}`}
      aria-haspopup="menu"
      className="text-on-surface-variant opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
      onClick={(event) => {
        // The row is itself a link target and a selection surface; the button claims the tap.
        event.preventDefault();
        event.stopPropagation();
        menu.openFor(event.currentTarget);
      }}
    >
      <MoreHorizontal aria-hidden="true" />
    </Button>
  );
}
