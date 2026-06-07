'use client';

/**
 * `@docket/ui` — the integrated workspace switcher at the top of the {@link Sidebar}.
 *
 * @remarks
 * Replaces the old left-edge org rail: a single styled dropdown that surfaces the *current
 * context* (the cross-org Hub, each org the caller belongs to, or their Personal space) with
 * avatars + per-workspace attention badges. The trigger shows the active workspace; opening it
 * lists every workspace so the caller can switch context in one click. Selecting a workspace
 * rebinds the active context via {@link useContextState} (so the org accent applies instantly)
 * and reports the selection through {@link WorkspaceSwitcherProps.onSelect} so the host can
 * navigate. The Hub entry rebinds to {@link HUB_CONTEXT} and reports `null`.
 */
import * as React from 'react';

import { Building, ChevronDown, Home } from '../../icons';
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
} from '../../primitives';
import { useContextState } from './ContextProvider';
import type { Workspace } from './workspaces';

/** Props for {@link WorkspaceSwitcher}. */
export interface WorkspaceSwitcherProps {
  /** Every org the caller belongs to (personal orgs are surfaced under "Personal"). */
  readonly workspaces: readonly Workspace[];
  /** The caller's cross-org unread count, surfaced as the Hub's attention badge. */
  readonly hubBadge?: number;
  /**
   * Switch to a workspace: `null` selects the cross-org Hub, otherwise an org id.
   *
   * @remarks
   * Fires in addition to the local context rebind, so the host can navigate imperatively.
   */
  readonly onSelect: (orgId: string | null) => void;
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
      className="bg-primary text-primary-foreground ring-card flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ring-2"
    >
      {badgeText(count)}
    </span>
  );
}

/** The workspace avatar: an org's accent-tinted initials avatar, or the Hub's home glyph. */
function WorkspaceAvatar({
  workspace,
}: {
  readonly workspace: Workspace | null;
}): React.JSX.Element {
  if (!workspace) {
    return (
      <span className="bg-muted text-muted-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-md">
        <Home aria-hidden="true" className="size-4" />
      </span>
    );
  }
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
  badge,
  onSelect,
}: {
  readonly workspace: Workspace | null;
  readonly active: boolean;
  readonly badge?: number;
  readonly onSelect: () => void;
}): React.JSX.Element {
  const name = workspace?.name ?? 'Hub';
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn('gap-2', active && 'bg-accent text-accent-foreground')}
    >
      <WorkspaceAvatar workspace={workspace} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <AttentionBadge count={badge ?? 0} label="need attention" />
    </DropdownMenuItem>
  );
}

/**
 * The integrated workspace switcher: the active context + a one-click switch between
 * the Hub, every org, and the caller's Personal space.
 *
 * @remarks
 * Must be rendered inside a {@link ContextProvider} (it reads + rebinds the active context).
 * Personal orgs (`isPersonal`) are grouped under a "Personal" section so a solo workspace
 * never gets lost among shared orgs.
 */
export function WorkspaceSwitcher({
  workspaces,
  hubBadge,
  onSelect,
}: WorkspaceSwitcherProps): React.JSX.Element {
  const { activeOrgId, isHub } = useContextState();
  const [open, setOpen] = React.useState(false);

  const active = React.useMemo(
    () => workspaces.find((w) => w.id === activeOrgId) ?? null,
    [workspaces, activeOrgId],
  );
  const shared = workspaces.filter((w) => !w.isPersonal);
  const personal = workspaces.filter((w) => w.isPersonal);

  const select = React.useCallback(
    (orgId: string | null): void => {
      setOpen(false);
      onSelect(orgId);
    },
    [onSelect],
  );

  const triggerLabel = isHub ? 'Hub' : (active?.name ?? 'Hub');

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={`Workspace: ${triggerLabel}. Switch workspace`}
          className="h-auto w-full justify-start gap-2 px-2 py-1.5"
        >
          <WorkspaceAvatar workspace={active} />
          <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
            {triggerLabel}
          </span>
          {isHub ? <AttentionBadge count={hubBadge ?? 0} label="need attention" /> : null}
          <ChevronDown aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[15rem]">
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          Cross-organization
        </DropdownMenuLabel>
        <WorkspaceMenuRow
          workspace={null}
          active={isHub}
          badge={hubBadge}
          onSelect={() => {
            select(null);
          }}
        />
        {shared.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Organizations
            </DropdownMenuLabel>
            {shared.map((w) => (
              <WorkspaceMenuRow
                key={w.id}
                workspace={w}
                active={!isHub && active?.id === w.id}
                badge={w.attentionCount}
                onSelect={() => {
                  select(w.id);
                }}
              />
            ))}
          </>
        ) : null}
        {personal.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Building aria-hidden="true" className="size-3.5" />
              Personal
            </DropdownMenuLabel>
            {personal.map((w) => (
              <WorkspaceMenuRow
                key={w.id}
                workspace={w}
                active={!isHub && active?.id === w.id}
                badge={w.attentionCount}
                onSelect={() => {
                  select(w.id);
                }}
              />
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
