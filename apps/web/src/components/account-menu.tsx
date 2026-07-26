'use client';

import { useQueryClient } from '@tanstack/react-query';

import { useShellDrawer } from '@docket/ui/components';
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

import { authClient } from '@/lib/auth-client';
import { signOutAndPurge } from '@/lib/sign-out';

/**
 * The account control pinned to the foot of the app sidebar.
 *
 * @remarks
 * Gives sign-out a visible, discoverable home instead of hiding it in the command palette only
 * (audit finding). Shows the signed-in identity (name + email) and opens a menu with global
 * workspace creation plus sign-out. Self-contained — it reads the Better Auth session directly,
 * so it renders nothing until a session exists (and on the auth screens it is never mounted).
 * One default export per the component-file convention.
 */
export default function AccountMenu({
  onCreateWorkspace,
}: {
  /** Open the shared-workspace creation flow. */
  onCreateWorkspace: () => void;
}): JSX.Element | null {
  const router = useRouter();
  const queryClient = useQueryClient();
  // When this menu is rendered inside the mobile off-canvas nav drawer, a selection must both act
  // and close the drawer — otherwise the destination renders behind the still-open drawer. `null`
  // on the static desktop rail (no drawer to close), so every call is a safe no-op there.
  const dismissDrawer = useShellDrawer();
  const { data: session } = authClient.useSession();
  if (!session) return null;

  const { name, email } = session.user;
  const label = name.trim() || email;
  const initial = (label || '?').charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="text-on-surface hover:bg-surface-container-high focus-visible:ring-ring flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Avatar className="size-7 shrink-0">
            <AvatarFallback className="text-xs">{initial}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="text-body-medium block truncate font-medium">{label}</span>
            {name ? (
              <span className="text-on-surface-variant block truncate text-xs">{email}</span>
            ) : null}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
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
