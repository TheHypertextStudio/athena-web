'use client';

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

import { authClient, signOut } from '@/lib/auth-client';

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
        <DropdownMenuItem onSelect={onCreateWorkspace}>
          <Plus aria-hidden="true" className="size-4" />
          Create workspace
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            router.push('/settings');
          }}
        >
          <Settings aria-hidden="true" className="size-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void signOut().then(() => {
              router.replace('/sign-in');
            });
          }}
        >
          <LogOut aria-hidden="true" className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
