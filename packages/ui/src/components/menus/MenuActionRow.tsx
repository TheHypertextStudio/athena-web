'use client';

import * as React from 'react';

import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../primitives';
import { menuFocusRing, menuItemClass } from '../../primitives/menu-styles';

/**
 * Props for {@link MenuActionRow}.
 *
 * @remarks
 * The caller supplies the primary control through `renderPrimary`, which keeps routing concerns
 * outside the design-system package while the row retains ownership of its shared menu geometry.
 */
export interface MenuActionRowProps {
  readonly label: string;
  readonly leading?: React.ReactNode;
  readonly selected?: boolean;
  readonly renderPrimary: (children: React.ReactNode, className: string) => React.ReactNode;
  readonly actionLabel: string;
  readonly actionIcon: React.ReactNode;
  readonly onPrimarySelect?: () => void;
  readonly onAction: () => void;
}

/** Return a direct element from a transparent fragment when one is available for tooltip semantics. */
function unwrapTooltipTrigger(node: React.ReactNode): React.ReactNode {
  if (!React.isValidElement(node) || node.type !== React.Fragment) return node;
  const fragment = node as React.ReactElement<{ children?: React.ReactNode }>;
  const children = React.Children.toArray(fragment.props.children);
  return children.length === 1 ? unwrapTooltipTrigger(children[0]) : node;
}

/**
 * Render a menu row with a full-width primary control and a separate trailing action.
 *
 * @param props - The row content, state, render callback, and activation handlers.
 * @returns The composed menu row.
 */
export function MenuActionRow({
  label,
  leading,
  selected = false,
  renderPrimary,
  actionLabel,
  actionIcon,
  onPrimarySelect,
  onAction,
}: MenuActionRowProps): React.JSX.Element {
  const [titleTooltipOpen, setTitleTooltipOpen] = React.useState(false);
  const [actionTooltipOpen, setActionTooltipOpen] = React.useState(false);
  const [actionInteracting, setActionInteracting] = React.useState(false);
  const primary = renderPrimary(
    <>
      {leading ? (
        <span
          aria-hidden="true"
          className="flex size-[18px] shrink-0 items-center justify-center opacity-70 [&_svg]:size-[18px]!"
        >
          {leading}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </>,
    cn(
      'flex h-full min-w-0 flex-1 items-center gap-3 rounded-corner-xs outline-none',
      menuFocusRing,
    ),
  );
  const tooltipTrigger = unwrapTooltipTrigger(primary);
  const titleTrigger =
    React.isValidElement(tooltipTrigger) && tooltipTrigger.type !== React.Fragment ? (
      <TooltipTrigger asChild>{tooltipTrigger}</TooltipTrigger>
    ) : (
      <TooltipTrigger asChild>
        <span data-menu-action-title-trigger="">{primary}</span>
      </TooltipTrigger>
    );

  return (
    <div
      role="listitem"
      aria-label={label}
      aria-current={selected ? 'true' : undefined}
      data-menu-action-row=""
      className={cn(
        menuItemClass('standard', { selected }),
        'group/menu-action-row h-11 min-h-11 py-0',
      )}
    >
      <Tooltip
        open={titleTooltipOpen && !actionInteracting}
        onOpenChange={(nextOpen) => {
          setTitleTooltipOpen(nextOpen && !actionInteracting);
          if (nextOpen) setActionTooltipOpen(false);
        }}
      >
        <span
          data-menu-action-primary=""
          className="flex h-full min-w-0 flex-1 pr-10"
          onPointerLeave={() => {
            setTitleTooltipOpen(false);
          }}
          onMouseLeave={() => {
            setTitleTooltipOpen(false);
          }}
          onClick={() => {
            onPrimarySelect?.();
          }}
        >
          {titleTrigger}
        </span>
        {actionInteracting ? null : <TooltipContent>{label}</TooltipContent>}
      </Tooltip>
      <Tooltip
        open={actionTooltipOpen}
        onOpenChange={(nextOpen) => {
          setActionTooltipOpen(nextOpen);
          if (nextOpen) setTitleTooltipOpen(false);
        }}
      >
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={actionLabel}
            onPointerEnter={() => {
              setActionInteracting(true);
              setTitleTooltipOpen(false);
            }}
            onMouseEnter={() => {
              setActionInteracting(true);
              setTitleTooltipOpen(false);
            }}
            onPointerLeave={() => {
              setActionInteracting(false);
            }}
            onMouseLeave={() => {
              setActionInteracting(false);
            }}
            onFocus={() => {
              setActionInteracting(true);
              setTitleTooltipOpen(false);
            }}
            onBlur={() => {
              setActionInteracting(false);
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAction();
            }}
            className={cn(
              'group/action',
              'absolute top-1/2 right-[5px] z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full',
              'pointer-events-none opacity-0 transition-opacity motion-reduce:transition-none',
              'group-hover/menu-action-row:pointer-events-auto group-hover/menu-action-row:opacity-100',
              'group-focus-within/menu-action-row:pointer-events-auto group-focus-within/menu-action-row:opacity-100',
              'coarse:pointer-events-auto coarse:opacity-100',
              menuFocusRing,
            )}
          >
            <span
              data-menu-action-layer=""
              className={cn(
                'flex size-7 items-center justify-center rounded-full [&_svg]:size-4!',
                selected
                  ? 'group-hover/action:bg-on-tertiary-container/8 group-focus-visible/action:bg-on-tertiary-container/10 group-active/action:bg-on-tertiary-container/10'
                  : 'group-hover/action:bg-on-surface/8 group-focus-visible/action:bg-on-surface/10 group-active/action:bg-on-surface/10',
              )}
            >
              {actionIcon}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{actionLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}
