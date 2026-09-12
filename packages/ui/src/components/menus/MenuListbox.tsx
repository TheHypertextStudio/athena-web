'use client';

import * as React from 'react';

import { useInputModality } from '../../hooks/use-input-modality';
import { cn } from '../../lib/utils';
import {
  menuActiveDescendantLayer,
  menuActiveDescendantRing,
  menuItemClass,
  menuSupporting,
} from '../../primitives/menu-styles';

/** Props for a listbox that keeps focus on its associated text input. */
export interface MenuListboxProps extends React.ComponentProps<'ul'> {
  /** Accessible name for the option collection. */
  readonly ariaLabel: string;
}

/** Shared listbox semantics for mention, command, and searchable picker menus. */
export function MenuListbox({
  className,
  ariaLabel,
  ...props
}: MenuListboxProps): React.JSX.Element {
  return (
    <ul role="listbox" aria-label={ariaLabel} className={cn('contents', className)} {...props} />
  );
}

/** Props for one non-focus-stealing listbox option. */
export interface MenuOptionProps extends Omit<React.ComponentProps<'li'>, 'onSelect'> {
  /**
   * Whether this option is the row `aria-activedescendant` names.
   *
   * @remarks
   * Where the highlight is, not what the value is. It takes the 10% focus state layer and, when
   * the keyboard put it there, the focus ring — never the selected container. Conflating the two
   * paints a merely navigated row in the full `tertiary-container` treatment, which tells the
   * reader they have already chosen something they have only arrowed past.
   */
  readonly active?: boolean | undefined;
  /** Whether this option is the committed value — the persistent selected container. */
  readonly selected?: boolean | undefined;
  /** Leading visual slot. */
  readonly leading?: React.ReactNode | undefined;
  /** Supporting text under the primary label. */
  readonly supporting?: React.ReactNode | undefined;
  /** Secondary text that shares the option row with the primary label. */
  readonly secondary?: React.ReactNode | undefined;
  /** Optional trailing badge. */
  readonly badge?: React.ReactNode | undefined;
  /** Optional trailing value or shortcut. */
  readonly trailing?: React.ReactNode | undefined;
  /** Preview this option without moving input focus. */
  readonly onActiveChange?: (() => void) | undefined;
  /** Activate this option without moving input focus. */
  readonly onSelect?: (() => void) | undefined;
}

/** One MD3 option row for a listbox-driven temporary menu. */
export function MenuOption({
  active = false,
  selected = false,
  leading,
  supporting,
  secondary,
  badge,
  trailing,
  children,
  className,
  onActiveChange,
  onSelect,
  onMouseEnter,
  onMouseDown,
  onPointerDown,
  ...props
}: MenuOptionProps): React.JSX.Element {
  const pointerSelected = React.useRef(false);
  const modality = useInputModality();
  return (
    <li
      role="option"
      aria-selected={selected}
      data-active={active || undefined}
      data-nav={active ? modality : undefined}
      className={cn(
        menuItemClass('standard', { selected }),
        menuActiveDescendantRing,
        // A selected row already mixes the layer into `tertiary-container` through
        // `menuItemClass`, so it only needs adding on an unselected one.
        { [menuActiveDescendantLayer]: active && !selected },
        'cursor-pointer',
        className,
      )}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        onActiveChange?.();
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (event.defaultPrevented) return;
        // The associated editor or search field owns focus through aria-activedescendant.
        event.preventDefault();
        pointerSelected.current = true;
        onSelect?.();
      }}
      onMouseDown={(event) => {
        onMouseDown?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (pointerSelected.current) return;
        pointerSelected.current = true;
        onSelect?.();
      }}
      onClick={() => {
        if (pointerSelected.current) {
          pointerSelected.current = false;
          return;
        }
        onSelect?.();
      }}
      {...props}
    >
      {leading ? (
        <span className="flex size-5 shrink-0 items-center justify-center">{leading}</span>
      ) : null}
      {secondary ? (
        <>
          <span className="min-w-0 flex-[3] truncate">{children}</span>
          <span className="text-on-surface-variant hidden min-w-0 flex-1 truncate sm:inline">
            {secondary}
          </span>
        </>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{children}</span>
          {supporting ? <span className={menuSupporting('standard')}>{supporting}</span> : null}
        </span>
      )}
      {badge ? <span className="shrink-0">{badge}</span> : null}
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </li>
  );
}

/** Props for a quiet listbox section label. */
export type MenuSectionLabelProps =
  | (React.ComponentProps<'li'> & { readonly as?: 'li' | undefined })
  | (React.ComponentProps<'p'> & { readonly as: 'p' });

/**
 * The row's own horizontal axis and vertical rhythm, for the text in a menu that is not a row.
 *
 * @remarks
 * 16dp matches `MENU_METRICS.paddingX`. Stated once so a section label and a note cannot drift
 * apart the way the hand-written 8dp, 12dp, and 16dp insides of the `@` menu did.
 */
const MENU_TEXT_AXIS = 'px-4 py-2' as const;

/** A quiet section label for a listbox menu. */
export function MenuSectionLabel(props: MenuSectionLabelProps): React.JSX.Element {
  if (props.as === 'p') {
    const { as: _as, className, ...paragraphProps } = props;
    return (
      <p
        className={cn('text-label-medium text-on-surface-variant', MENU_TEXT_AXIS, className)}
        {...paragraphProps}
      />
    );
  }

  const { as: _as, className, ...itemProps } = props;
  return (
    <li
      role="presentation"
      className={cn('text-label-medium text-on-surface-variant', MENU_TEXT_AXIS, className)}
      {...itemProps}
    />
  );
}

/**
 * Quiet prose inside a menu that is not a row — an empty state, a "+3 more" tail, a
 * "search is unavailable" line.
 *
 * @remarks
 * Shares {@link MENU_TEXT_AXIS} with the section label, so a footer cannot start left of the
 * heading above it. Written by hand these came out at 8dp, 12dp, and 16dp inside one menu.
 */
export function MenuNote({ className, ...props }: React.ComponentProps<'p'>): React.JSX.Element {
  return (
    <p
      className={cn('text-on-surface-variant text-body-small', MENU_TEXT_AXIS, className)}
      {...props}
    />
  );
}

/** Props for a divider between related listbox option groups. */
export type MenuDividerProps =
  | (React.ComponentProps<'li'> & { readonly as?: 'li' | undefined })
  | (React.ComponentProps<'div'> & { readonly as: 'div' });

/**
 * Divider between related listbox option groups.
 *
 * @remarks
 * `menuSeparator`'s geometry, so a listbox menu's seam matches a Radix menu's: 6px either side,
 * which with the container's own 2dp row gap is the spec's 8dp of divider padding. It is
 * symmetric on purpose — call sites that added a `mb-2` on top gave the rule 4dp above and 8dp
 * below, and a seam that sits closer to the section it ends than the one it begins reads as
 * belonging to the wrong group.
 */
export function MenuDivider(props: MenuDividerProps): React.JSX.Element {
  if (props.as === 'div') {
    const { as: _as, className, ...dividerProps } = props;
    return (
      <div className={cn('bg-outline-variant mx-1 my-1.5 h-px', className)} {...dividerProps} />
    );
  }

  const { as: _as, className, ...itemProps } = props;
  return (
    <li
      role="separator"
      className={cn('bg-outline-variant mx-1 my-1.5 h-px', className)}
      {...itemProps}
    />
  );
}
