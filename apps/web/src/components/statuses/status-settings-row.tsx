'use client';

/**
 * One status's row on the settings page.
 *
 * @remarks
 * The row answers "what is this, where does it sit, and how much work is on it?" — so it carries
 * the glyph exactly as a task row renders it, the name, what the status means, and the badge that
 * marks where new work starts. Rows separate by a tonal step rather than a rule, matching the
 * labels and templates lists.
 *
 * The grip is present in the DOM at all times and only *revealed* on hover or focus, because a
 * grip that appears with the pointer takes the keyboard path away with it.
 */
import type { WorkStatusCategory } from '@docket/work/work-status-contract';
import { DragHandle, StatusIcon } from '@docket/ui/components';
import type { ReorderableBinding } from '@docket/ui/hooks';
import { Ellipsis } from '@docket/ui/icons';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import type { JSX, ReactNode } from 'react';

import type { StatusLike } from './status-registry';

/** Props for {@link StatusSettingsRow}. */
export interface StatusSettingsRowProps {
  /** The status to render. */
  status: StatusLike;
  /** The category this row sits under, for the glyph. */
  category: WorkStatusCategory;
  /** Whether the viewer may reshape this workspace's statuses. */
  canManage: boolean;
  /** Whether this row belongs to a set the viewer is only reading. */
  readOnly?: boolean | undefined;
  /** The reorder binding for the category this row sits in. */
  reorder?: ReorderableBinding | undefined;
  /** Open the editor on this status. */
  onEdit: () => void;
  /** Decorative identity control. The status icon remains the semantic category signal. */
  identity?: ReactNode;
  /** Make this the status new work starts in. */
  onMakeDefault: () => void;
  /** Delete this status, choosing where its work goes. */
  onDelete: () => void;
  /** Whether deleting is available, and why when it is unavailable. */
  deleteBlockedReason?: string | undefined;
}

/**
 * Render one status as a settings row.
 *
 * @param props - The status, its category, and what the viewer may do with it.
 * @returns the row element.
 */
export function StatusSettingsRow({
  status,
  category,
  canManage,
  readOnly = false,
  reorder,
  onEdit,
  identity,
  onMakeDefault,
  onDelete,
  deleteBlockedReason,
}: StatusSettingsRowProps): JSX.Element {
  const editable = canManage && !readOnly;
  const itemProps = reorder?.itemProps(status.id) ?? {};
  const handleProps = reorder?.handleProps(status.id);

  return (
    <li
      {...itemProps}
      data-status-key={status.key}
      className={cn(
        'group/row bg-surface-container-low hover:bg-surface-container relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
        // The insertion line is drawn on the row a drop would land against, so the gap between
        // two rows is never ambiguous about which side is live.
        'data-[drop-edge=above]:before:bg-primary data-[drop-edge=above]:before:absolute data-[drop-edge=above]:before:inset-x-3 data-[drop-edge=above]:before:-top-px data-[drop-edge=above]:before:h-0.5 data-[drop-edge=above]:before:rounded-full',
        'data-[drop-edge=below]:after:bg-primary data-[drop-edge=below]:after:absolute data-[drop-edge=below]:after:inset-x-3 data-[drop-edge=below]:after:-bottom-px data-[drop-edge=below]:after:h-0.5 data-[drop-edge=below]:after:rounded-full',
        'data-grabbed:ring-primary data-dragging:opacity-40 data-grabbed:ring-2',
        itemProps.className,
      )}
    >
      {handleProps === undefined ? (
        <span aria-hidden="true" className="size-6 shrink-0" />
      ) : (
        <DragHandle {...handleProps} />
      )}

      {identity}
      <StatusIcon type={category} label={status.name} />

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-on-surface text-label-large truncate">{status.name}</span>
        {status.description === null || status.description === '' ? null : (
          <span className="text-on-surface-variant text-body-small truncate">
            {status.description}
          </span>
        )}
      </div>

      {status.isDefault ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary">Default</Badge>
          </TooltipTrigger>
          <TooltipContent>New work starts here</TooltipContent>
        </Tooltip>
      ) : null}

      {editable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${status.name}`}
              className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
            {status.isDefault ? null : (
              <DropdownMenuItem onSelect={onMakeDefault}>Start new work here</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {deleteBlockedReason === undefined ? (
              <DropdownMenuItem destructive onSelect={onDelete}>
                Delete
              </DropdownMenuItem>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <DropdownMenuItem disabled>Delete</DropdownMenuItem>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{deleteBlockedReason}</TooltipContent>
              </Tooltip>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}
