'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { signOut, registerPasskey } from '@/lib/auth-client';
import { Header } from '@/components/layout/header';
import { StatsCards, TaskSummary, EventSummary, QuickActions } from '@/components/dashboard';

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  async function handleAddPasskey() {
    try {
      await registerPasskey('My Device');
      alert('Passkey registered successfully!');
    } catch (error) {
      console.error('Failed to register passkey:', error);
      alert('Failed to register passkey');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="Dashboard" onSignOut={() => void handleSignOut()} />

      <div className="flex-1 space-y-6 p-6">
        <div>
          <h2 className="text-lg font-medium">Welcome back, {user?.name ?? 'there'}!</h2>
          <p className="text-muted-foreground text-sm">
            Here&apos;s what&apos;s happening with your productivity today.
          </p>
        </div>

        <StatsCards />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <TaskSummary />
            <EventSummary />
          </div>
          <div className="space-y-6">
            <QuickActions />
            <div className="bg-card rounded-xl border p-6">
              <h3 className="font-semibold">Security</h3>
              <div className="mt-4 space-y-3">
                <button
                  onClick={() => void handleAddPasskey()}
                  className="bg-secondary text-secondary-foreground hover:bg-secondary/80 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors"
                >
                  Add Passkey
                </button>
                <p className="text-muted-foreground text-xs">
                  Passkeys provide passwordless sign-in using your device&apos;s biometrics.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
