import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthErrorBanner } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth-server';

export default async function LandingPage() {
  let authError: string | null = null;

  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user) {
      redirect('/home');
    }
  } catch {
    authError =
      'We’re having trouble reaching the auth service. You can keep browsing, but sign-in may be unavailable.';
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="w-full max-w-md">{authError && <AuthErrorBanner message={authError} />}</div>
      <div className="space-y-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Athena</h1>
        <p className="text-muted-foreground max-w-md text-lg">
          Your next-generation productivity platform. Organize tasks, manage projects, and achieve
          your goals with AI-powered assistance.
        </p>
        <div className="flex justify-center gap-4">
          <Button asChild>
            <Link href="/signin">Sign In</Link>
          </Button>
          <Button asChild variant="outlined">
            <Link href="/signup">Create Account</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
