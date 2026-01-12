'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Settings, User } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { signOut } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { QueryClientProvider } from '@/lib/query-client';
import { CommandPaletteProvider, CommandPalette } from '@/components/command-palette';
import { registerAllActions } from '@/lib/command-palette/actions';
import { ObjectSystemProvider } from '@/components/objects';
import { SnackbarProvider } from '@/components/ui/snackbar';
import { UndoProvider } from '@/lib/undo';
import { HistoryPanel } from '@/components/ui/history-panel';
import { TimezoneMismatchDialog } from '@/components/timezone-mismatch-dialog';
import { EntitlementErrorProvider } from '@/contexts/entitlement-error-context';

export default function ProtectedLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/signin');
    }
  }, [isAuthenticated, isLoading, router]);

  // Register command palette actions once on mount
  useEffect(() => {
    registerAllActions();
  }, []);

  async function handleSignOut() {
    await signOut();
    router.push('/signin');
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <QueryClientProvider>
      <EntitlementErrorProvider>
        <SnackbarProvider>
          <UndoProvider>
            <ObjectSystemProvider>
              <CommandPaletteProvider>
                <div className="min-h-screen">
                  {/* Minimal Top Bar */}
                  <header className="fixed top-0 right-0 z-50 p-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="text" size="icon" className="rounded-full">
                          {user?.image ? (
                            <img
                              src={user.image}
                              alt={user.name}
                              className="h-8 w-8 rounded-full"
                            />
                          ) : (
                            <User className="h-5 w-5" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            router.push('/settings');
                          }}
                        >
                          <Settings className="mr-2 h-4 w-4" />
                          Settings
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleSignOut()}>
                          <LogOut className="mr-2 h-4 w-4" />
                          Sign out
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </header>

                  <main>{children}</main>
                </div>

                {/* Command Palette - Cmd+K / Ctrl+K to open */}
                <CommandPalette />

                {/* Modal slot for route interception (e.g., assistant) */}
                {modal}

                {/* History panel for undo/redo - Cmd+Alt+Z to open */}
                <HistoryPanel />

                {/* Timezone mismatch detection dialog */}
                <TimezoneMismatchDialog />
              </CommandPaletteProvider>
            </ObjectSystemProvider>
          </UndoProvider>
        </SnackbarProvider>
      </EntitlementErrorProvider>
    </QueryClientProvider>
  );
}
