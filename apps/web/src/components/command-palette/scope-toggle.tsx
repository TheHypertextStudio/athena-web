'use client';

import { Building, Globe } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

import type { PaletteScope } from './types';

interface ScopeToggleProps {
  scope: PaletteScope;
  orgBound: boolean;
  orgLabel: string;
  onChange: (next: PaletteScope) => void;
}

/** ScopeToggle renders the command palette UI control for its parent workflow. */
export function ScopeToggle({
  scope,
  orgBound,
  orgLabel,
  onChange,
}: ScopeToggleProps): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Search scope"
      className="border-outline-variant flex shrink-0 items-center gap-0.5 rounded-md border p-0.5"
    >
      <button
        type="button"
        role="radio"
        aria-checked={scope === 'hub'}
        onClick={() => {
          onChange('hub');
        }}
        className={cn(
          'focus-visible:ring-ring flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-1 focus-visible:outline-none',
          scope === 'hub'
            ? 'bg-secondary text-secondary-foreground'
            : 'text-on-surface-variant hover:text-on-surface',
        )}
      >
        <Globe aria-hidden="true" className="size-3.5" />
        Hub
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={scope === 'org'}
        disabled={!orgBound}
        onClick={() => {
          onChange('org');
        }}
        title={orgBound ? undefined : 'Open an organization to search just it'}
        className={cn(
          'focus-visible:ring-ring flex max-w-[8rem] items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-1 focus-visible:outline-none disabled:opacity-40',
          scope === 'org'
            ? 'bg-secondary text-secondary-foreground'
            : 'text-on-surface-variant hover:text-on-surface',
        )}
      >
        <Building aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{orgBound ? orgLabel : 'This org'}</span>
      </button>
    </div>
  );
}
