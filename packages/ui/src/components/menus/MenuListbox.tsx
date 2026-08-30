'use client';

import * as React from 'react';

import { cn } from '../../lib/utils';
import { menuItemClass, menuSupporting } from '../../primitives/menu-styles';

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
  /** Whether this option is the active keyboard target. */
  readonly active?: boolean | undefined;
  /** Whether this option is selected. */
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
  selected = active,
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
  return (
    <li
      role="option"
      aria-selected={selected}
      data-active={active || undefined}
      className={cn(menuItemClass('standard', { selected }), 'cursor-pointer', className)}
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
        <span className="min-w-0 flex-1">
          {children}
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

/** A quiet section label for a listbox menu. */
export function MenuSectionLabel(props: MenuSectionLabelProps): React.JSX.Element {
  if (props.as === 'p') {
    const { as: _as, className, ...paragraphProps } = props;
    return (
      <p
        className={cn('text-label-medium text-on-surface-variant px-4 py-2', className)}
        {...paragraphProps}
      />
    );
  }

  const { as: _as, className, ...itemProps } = props;
  return (
    <li
      role="presentation"
      className={cn('text-label-medium text-on-surface-variant px-4 py-2', className)}
      {...itemProps}
    />
  );
}

/** Props for a divider between related listbox option groups. */
export type MenuDividerProps =
  | (React.ComponentProps<'li'> & { readonly as?: 'li' | undefined })
  | (React.ComponentProps<'div'> & { readonly as: 'div' });

/** Divider between related listbox option groups. */
export function MenuDivider(props: MenuDividerProps): React.JSX.Element {
  if (props.as === 'div') {
    const { as: _as, className, ...dividerProps } = props;
    return <div className={cn('bg-outline-variant mx-1 my-1 h-px', className)} {...dividerProps} />;
  }

  const { as: _as, className, ...itemProps } = props;
  return (
    <li
      role="separator"
      className={cn('bg-outline-variant mx-1 my-1 h-px', className)}
      {...itemProps}
    />
  );
}
