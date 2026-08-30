'use client';

/** Shared compact-shell top bar for the application and standalone work surfaces. */
import * as React from 'react';

import { cn } from '../../lib/utils';
import { Surface } from '../../primitives/surface';

/** Props for {@link ShellTopBar}. */
export interface ShellTopBarProps {
  /** Leading navigation control. */
  readonly navigation: React.ReactNode;
  /** The compact route or workspace title. */
  readonly title: React.ReactNode;
  /** Trailing route controls. */
  readonly actions?: React.ReactNode | undefined;
  /** Structural classes only. The component owns its visual presentation. */
  readonly className?: string | undefined;
}

/**
 * Render the app's compact top bar.
 *
 * The bar owns the safe-area inset, 48px control row, page-tone surface, divider, and one-line
 * layout. Routes supply controls and labels but cannot recreate a second mobile app-bar geometry.
 */
export function ShellTopBar({
  navigation,
  title,
  actions,
  className,
}: ShellTopBarProps): React.JSX.Element {
  return (
    <Surface
      as="header"
      tone="page"
      shape="none"
      data-slot="shell-top-bar"
      className={cn(
        'border-outline-variant flex min-h-12 shrink-0 items-center gap-2 border-b px-2 pt-[env(safe-area-inset-top)]',
        className,
      )}
    >
      <div className="flex size-10 shrink-0 items-center justify-center">{navigation}</div>
      <div className="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap">
        {title}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">{actions}</div>
      ) : null}
    </Surface>
  );
}
