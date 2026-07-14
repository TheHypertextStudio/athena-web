'use client';

/**
 * `@docket/ui` — the integrated workspace switcher pinned at the top of the {@link Sidebar}.
 *
 * @remarks
 * Replaces the old left-edge org rail: a single styled dropdown that surfaces the *active
 * workspace* and lists every org the caller belongs to in one uniform list — personal and
 * shared orgs look and group identically, exactly like Linear. The trigger shows the active
 * workspace; opening it lists every workspace for one-click switching plus the host's shared
 * creation action.
 * Selecting a workspace rebinds the active org via {@link useContextState} (so the org accent
 * applies instantly) and reports the selection through {@link WorkspaceSwitcherProps.onSelect}
 * so the host can navigate.
 */
import * as React from 'react';

import { ChevronDown, Plus } from '../../icons';
import { cn } from '../../lib/utils';
import { getOrgAccent } from '../../lib/org-accent';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from '../../primitives';
import { useContextState } from './ContextProvider';
import type { Workspace } from './workspaces';

/** Props for {@link WorkspaceSwitcher}. */
export interface WorkspaceSwitcherProps {
  /** Every org the caller belongs to, listed uniformly (no personal/shared partition). */
  readonly workspaces: readonly Workspace[];
  /**
   * Switch to a workspace by org id.
   *
   * @remarks
   * Fires in addition to the local context rebind, so the host can navigate imperatively.
   */
  readonly onSelect: (orgId: string) => void;
  /** Open the host application's shared-workspace creation flow. */
  readonly onCreate: () => void;
  /** Show a stable, disabled trigger while workspace context resolves. */
  readonly loading?: boolean;
}

/** Compute up-to-two-letter initials from a workspace name for the avatar fallback. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words.at(0);
  if (!first) return '?';
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  const last = words.at(-1);
  const firstChar = first.at(0);
  const lastChar = last?.at(0);
  /* v8 ignore start -- unreachable: `words` has >= 2 entries here; this only narrows noUncheckedIndexedAccess. */
  if (last === undefined || firstChar === undefined || lastChar === undefined)
    return first.slice(0, 2).toUpperCase();
  /* v8 ignore stop */
  return (firstChar + lastChar).toUpperCase();
}

/** Clamp a raw attention count to a compact, sidebar-friendly label (`99+` ceiling). */
function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** A small overlapping attention pill rendered next to a workspace avatar. */
function AttentionBadge({
  count,
  label,
}: {
  readonly count: number;
  readonly label: string;
}): React.JSX.Element | null {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} ${label}`}
      className="bg-primary text-primary-foreground ring-surface flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ring-2"
    >
      {badgeText(count)}
    </span>
  );
}

/** The workspace avatar: an org's accent-tinted initials avatar (or its image). */
function WorkspaceAvatar({ workspace }: { readonly workspace: Workspace }): React.JSX.Element {
  return (
    <Avatar
      className="h-6 w-6 rounded-md ring-1"
      style={{ '--tw-ring-color': getOrgAccent(workspace.id) } as React.CSSProperties}
    >
      {workspace.avatar ? <AvatarImage src={workspace.avatar} alt="" /> : null}
      <AvatarFallback className="rounded-md text-[10px] font-semibold">
        {initialsOf(workspace.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** A single selectable workspace row inside the switcher menu. */
function WorkspaceMenuRow({
  workspace,
  active,
  onSelect,
}: {
  readonly workspace: Workspace;
  readonly active: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn('gap-2', active && 'bg-surface-container-highest text-on-surface')}
    >
      <WorkspaceAvatar workspace={workspace} />
      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
      <AttentionBadge count={workspace.attentionCount ?? 0} label="need attention" />
    </DropdownMenuItem>
  );
}

/**
 * The integrated workspace switcher: the active workspace, one-click switching, and creation.
 *
 * @remarks
 * Must be rendered inside a {@link ContextProvider} (it reads + rebinds the active org). Every
 * org is listed uniformly — there is no Hub entry and no personal/shared partition, so a solo
 * workspace looks identical to a shared one, exactly like Linear's workspace switcher.
 */
export function WorkspaceSwitcher({
  workspaces,
  onSelect,
  onCreate,
  loading = false,
}: WorkspaceSwitcherProps): React.JSX.Element {
  const { activeOrgId } = useContextState();
  const [open, setOpen] = React.useState(false);

  const active = React.useMemo(
    () => workspaces.find((w) => w.id === activeOrgId) ?? workspaces.at(0) ?? null,
    [workspaces, activeOrgId],
  );

  const select = React.useCallback(
    (orgId: string): void => {
      setOpen(false);
      onSelect(orgId);
    },
    [onSelect],
  );

  const triggerLabel = loading ? 'Loading workspaces' : (active?.name ?? 'Workspace');

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={
            loading ? 'Loading workspaces' : `Workspace: ${triggerLabel}. Switch workspace`
          }
          disabled={loading}
          className="h-auto w-full justify-start gap-2 px-2 py-1.5"
        >
          {loading ? (
            <Skeleton className="size-6 shrink-0 rounded-md" aria-hidden="true" />
          ) : active ? (
            <WorkspaceAvatar workspace={active} />
          ) : (
            <span
              className="bg-surface-container-high size-6 shrink-0 rounded-md"
              aria-hidden="true"
            />
          )}
          {loading ? (
            <Skeleton className="h-4 w-24" aria-hidden="true" />
          ) : (
            <span className="text-body-medium min-w-0 flex-1 truncate text-left font-semibold">
              {triggerLabel}
            </span>
          )}
          {loading ? null : (
            <ChevronDown aria-hidden="true" className="text-on-surface-variant size-3.5 shrink-0" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[15rem]">
        {/* A calm, real section heading at the menu's default `text-body-medium font-semibold` — not a
            shrunken `text-xs` eyebrow. */}
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <WorkspaceMenuRow
            key={w.id}
            workspace={w}
            active={active?.id === w.id}
            onSelect={() => {
              select(w.id);
            }}
          />
        ))}
        {workspaces.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          onSelect={() => {
            setOpen(false);
            onCreate();
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
