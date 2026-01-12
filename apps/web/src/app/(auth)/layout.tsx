/**
 * Auth layout with shared logo and footer.
 * Redirects authenticated users to /home.
 *
 * @packageDocumentation
 */

import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Target } from 'lucide-react';
import { AuthErrorBanner } from '@/components/auth';
import { auth } from '@/lib/auth-server';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
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
    <div className="bg-background flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {authError && <AuthErrorBanner message={authError} />}
        {/* Logo */}
        <div className="flex justify-center">
          <Link href="/" className="flex items-center gap-2">
            <div className="bg-primary flex h-12 w-12 items-center justify-center rounded-xl">
              <Target className="text-primary-foreground h-7 w-7" />
            </div>
            <span className="text-2xl font-bold">Athena</span>
          </Link>
        </div>

        {/* Page Content */}
        {children}

        {/* Terms Footer */}
        <p className="text-muted-foreground text-center text-xs">
          By continuing, you agree to our{' '}
          <Link href="/terms" className="hover:text-primary underline underline-offset-4">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="hover:text-primary underline underline-offset-4">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
