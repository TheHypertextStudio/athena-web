'use client';

import { CornerDownLeft, type LucideIcon } from '@docket/ui/icons';
import { MenuOption } from '@docket/ui/components';
import { isValidElement, type JSX } from 'react';

import { OrgChip } from '@/components/org-chip';

import type { PaletteItem } from './types';

/**
 * Render a row's leading glyph.
 *
 * @remarks
 * `PaletteItem.icon` is either a `LucideIcon` component reference (every search hit, static
 * command, and org switch) or an already-rendered node (the `#` label mode's own color swatch).
 * `typeof icon === 'function'` cannot tell these apart on its own: the icon components this app
 * re-exports (`@docket/ui/icons`, backed by `@mui/icons-material`) are `forwardRef`/`memo`-wrapped,
 * so they are `object`s at runtime, not bare functions — and passing that wrapper object straight
 * to React as a child (instead of instantiating it) throws "Objects are not valid as a React
 * child". `isValidElement` is the reliable discriminant instead: a wrapped icon component is not a
 * React element (it is a component *type*), while the swatch already is one.
 */
function paletteIcon(icon: PaletteItem['icon']): JSX.Element {
  if (icon != null && !isValidElement(icon)) {
    const Icon = icon as LucideIcon;
    return <Icon aria-hidden="true" className="shrink-0" />;
  }
  return (
    <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
      {icon}
    </span>
  );
}

/** Props for {@link PaletteRow}. */
export interface PaletteRowProps {
  /** The command this row represents. */
  item: PaletteItem;
  /** Whether this row is the keyboard-active row (highlighted; shows the return hint). */
  active: boolean;
  /** Stable element id, so the input's `aria-activedescendant` can point at the active row. */
  rowId: string;
  /** Select this row (mouse click). */
  onSelect: () => void;
  /** Mark this row active on hover, so mouse + keyboard share one active row. */
  onHover: () => void;
}

/**
 * A single selectable row in the command palette list.
 *
 * @remarks
 * Rendered as an ARIA `option` (the list is a `listbox`), so the palette input can own focus
 * while `aria-activedescendant` tracks the active row for screen readers. Carries the
 * command's glyph + label, one secondary context line, and a return-key affordance when active.
 * Hover and keyboard share a single active row, so the highlight never desyncs.
 */
export function PaletteRow({
  item,
  active,
  rowId,
  onSelect,
  onHover,
}: PaletteRowProps): JSX.Element {
  return (
    <MenuOption
      id={rowId}
      active={active}
      leading={paletteIcon(item.icon)}
      onSelect={onSelect}
      onActiveChange={onHover}
      trailing={
        active ? (
          <CornerDownLeft aria-hidden="true" className="text-on-surface-variant shrink-0" />
        ) : null
      }
    >
      <span className="flex min-w-0 flex-1 flex-col items-start py-0.5">
        <span className="w-full truncate">{item.label}</span>
        {(item.breadcrumb && item.breadcrumb.length > 0) || item.hint || item.org || item.source ? (
          <span
            data-testid="palette-row-context"
            className="text-on-surface-variant text-label-small flex w-full min-w-0 items-center gap-2"
          >
            {item.breadcrumb && item.breadcrumb.length > 0 ? (
              <span className="min-w-0 truncate">{item.breadcrumb.join(' › ')}</span>
            ) : item.hint ? (
              <span className="min-w-0 truncate">{item.hint}</span>
            ) : null}
            {item.org ? (
              <span className="min-w-0 shrink truncate">
                <OrgChip orgId={item.org.id} name={item.org.name} />
              </span>
            ) : null}
            {item.source ? <span className="shrink-0">{item.source}</span> : null}
          </span>
        ) : null}
      </span>
    </MenuOption>
  );
}
