'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { signOut, registerPasskey } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

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
    <div className="bg-background min-h-screen p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground">Welcome back, {user?.name ?? 'User'}</p>
          </div>
          <Button variant="outline" onClick={() => void handleSignOut()}>
            Sign Out
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="bg-card rounded-lg border p-6">
            <h2 className="text-lg font-semibold">Your Profile</h2>
            <div className="mt-4 space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Name:</span> {user?.name}
              </p>
              <p>
                <span className="text-muted-foreground">Email:</span> {user?.email}
              </p>
              <p>
                <span className="text-muted-foreground">Verified:</span>{' '}
                {user?.emailVerified ? 'Yes' : 'No'}
              </p>
            </div>
          </div>

          <div className="bg-card rounded-lg border p-6">
            <h2 className="text-lg font-semibold">Security</h2>
            <div className="mt-4 space-y-4">
              <Button variant="secondary" size="sm" onClick={() => void handleAddPasskey()}>
                Add Passkey
              </Button>
              <p className="text-muted-foreground text-xs">
                Passkeys provide passwordless sign-in using your device&apos;s biometrics.
              </p>
            </div>
          </div>

          <div className="bg-card rounded-lg border p-6">
            <h2 className="text-lg font-semibold">Get Started</h2>
            <p className="text-muted-foreground mt-4 text-sm">
              Start organizing your tasks, projects, and initiatives with Athena.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
