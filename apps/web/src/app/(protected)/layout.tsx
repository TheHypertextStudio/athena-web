'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutGroup } from 'framer-motion';
import LogoutIcon from '@mui/icons-material/Logout';
import SettingsIcon from '@mui/icons-material/Settings';
import PersonIcon from '@mui/icons-material/Person';
import { useAuth } from '@/hooks/use-auth';
import { useOnboardingRequired } from '@/hooks/use-onboarding';
import { signOutWithCleanup } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ViewTransitions } from 'next-view-transitions';
import { QueryClientProvider } from '@/lib/query-client';
import { CommandPaletteProvider, CommandPalette } from '@/components/command-palette';
import { registerAllActions } from '@/lib/command-palette/actions';
import { ObjectSystemProvider } from '@/components/objects';
import { SnackbarProvider } from '@/components/ui/snackbar';
import { UndoProvider } from '@/lib/undo';
import { HistoryPanel } from '@/components/ui/history-panel';
import { TimezoneMismatchDialog } from '@/components/timezone-mismatch-dialog';
import { EntitlementErrorProvider } from '@/contexts/entitlement-error-context';
import { OnboardingResumeBanner } from '@/components/onboarding/resume-banner';

export default function ProtectedLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { isRequired: onboardingRequired, isLoading: onboardingLoading } = useOnboardingRequired();

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/signin');
    }
  }, [isAuthenticated, authLoading, router]);

  // Redirect to onboarding if not complete
  useEffect(() => {
    if (!authLoading && isAuthenticated && !onboardingLoading && onboardingRequired) {
      router.push('/onboarding');
    }
  }, [isAuthenticated, authLoading, onboardingRequired, onboardingLoading, router]);

  const isLoading = authLoading || onboardingLoading;

  // Register command palette actions once on mount
  useEffect(() => {
    registerAllActions();
  }, []);

  async function handleSignOut() {
    await signOutWithCleanup();
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
    <ViewTransitions>
      <QueryClientProvider>
        <EntitlementErrorProvider>
          <SnackbarProvider>
            <UndoProvider>
              <ObjectSystemProvider>
                <CommandPaletteProvider>
                  <LayoutGroup>
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
                                <PersonIcon sx={{ fontSize: 20 }} />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                router.push('/settings');
                              }}
                            >
                              <SettingsIcon sx={{ fontSize: 16 }} className="mr-2" />
                              Settings
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void handleSignOut()}>
                              <LogoutIcon sx={{ fontSize: 16 }} className="mr-2" />
                              Sign out
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </header>

                      <main>{children}</main>

                      {/* Resume banner for users who skipped onboarding */}
                      <OnboardingResumeBanner />
                    </div>

                    {/* Command Palette - Cmd+K / Ctrl+K to open */}
                    <CommandPalette />

                    {/* Modal slot for route interception (e.g., assistant) */}
                    {modal}

                    {/* History panel for undo/redo - Cmd+Alt+Z to open */}
                    <HistoryPanel />

                    {/* Timezone mismatch detection dialog */}
                    <TimezoneMismatchDialog />
                  </LayoutGroup>
                </CommandPaletteProvider>
              </ObjectSystemProvider>
            </UndoProvider>
          </SnackbarProvider>
        </EntitlementErrorProvider>
      </QueryClientProvider>
    </ViewTransitions>
  );
}
