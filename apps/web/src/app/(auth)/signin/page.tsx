/**
 * Sign-in page.
 *
 * @packageDocumentation
 */

import Link from 'next/link';
import { SignInForm } from '@/components/auth';

export const metadata = {
  title: 'Sign In - Athena',
  description: 'Sign in to your Athena account',
};

export default function SignInPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground">Sign in to continue to Athena</p>
      </div>

      <SignInForm />

      <p className="text-muted-foreground text-center text-sm">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="text-primary font-medium hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
