'use client';

import { useQueryClient } from '@tanstack/react-query';

import { useShellDrawer, useShellSidebar } from '@docket/ui/components';
import { LogOut, Plus, Settings } from '@docket/ui/icons';
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';

import { signOutAndPurge } from '@/lib/sign-out';

/** The display identity already resolved by the authenticated shell. */
export interface AccountMenuIdentity {
  /** The account's display name, which may be empty for legacy accounts. */
  readonly name: string;
  /** The account email and guaranteed fallback label. */
  readonly email: string;
}

/**
 * The account control pinned to the foot of the app sidebar.
 *
 * @remarks
 * Gives sign-out a visible, discoverable home instead of hiding it in the command palette only
 * (audit finding). Shows the signed-in identity (name + email) and opens a menu with global
 * workspace creation plus sign-out. The parent shell supplies the identity it already resolved
 * from the server session, live session, or permitted offline snapshot. Avoiding a second session
 * read here keeps the server tree and first client tree identical during hydration.
 * One default export per the component-file convention.
 */
export default function AccountMenu({
  onCreateWorkspace,
  identity,
}: {
  /** Open the shared-workspace creation flow. */
  onCreateWorkspace: () => void;
  /** Server/live/offline display identity resolved once by the shell. */
  identity: AccountMenuIdentity;
}): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  // When this menu is rendered inside the mobile off-canvas nav drawer, a selection must both act
  // and close the drawer — otherwise the destination renders behind the still-open drawer. `null`
  // on the static desktop rail (no drawer to close), so every call is a safe no-op there.
  const dismissDrawer = useShellDrawer();
  // Inside the drawer the sidebar is always expanded, so this row is too.
  const { collapsed: sidebarCollapsed } = useShellSidebar();
  const collapsed = sidebarCollapsed && dismissDrawer === null;
  const { name, email } = identity;
  const label = name.trim() || email;
  const initial = (label || '?').charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={
            // The avatar is the identity; the name and address are what the menu itself opens with,
            // so a collapsed sidebar loses nothing but the duplication.
            collapsed
              ? 'text-on-surface hover:bg-surface-container-high focus-visible:ring-ring mx-auto flex size-10 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none'
              : 'text-on-surface hover:bg-surface-container-high focus-visible:ring-ring flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none'
          }
        >
          <Avatar className="size-7 shrink-0">
            <AvatarFallback className="text-xs">{initial}</AvatarFallback>
          </Avatar>
          {collapsed ? null : (
            <span className="min-w-0 flex-1">
              <span className="text-body-medium block truncate font-medium">{label}</span>
              {name ? (
                <span className="text-on-surface-variant block truncate text-xs">{email}</span>
              ) : null}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" width="md">
        <DropdownMenuLabel className="truncate font-normal">
          Signed in as <span className="font-medium">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            dismissDrawer?.();
            onCreateWorkspace();
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          Create workspace
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            dismissDrawer?.();
            router.push('/settings');
          }}
        >
          <Settings aria-hidden="true" className="size-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            dismissDrawer?.();
            // Centralized: sign-out must also clear the in-memory cache, the offline identity
            // snapshot, and every persisted cache bucket before navigating.
            void signOutAndPurge(queryClient);
          }}
        >
          <LogOut aria-hidden="true" className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
