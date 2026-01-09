/**
 * Sign-up page.
 *
 * @packageDocumentation
 */

import Link from 'next/link';
import { SignUpForm } from '@/components/auth';

export const metadata = {
  title: 'Create Account - Athena',
  description: 'Create your Athena account',
};

export default function SignUpPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
        <p className="text-muted-foreground">Get started with Athena</p>
      </div>

      <SignUpForm />

      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{' '}
        <Link href="/signin" className="text-primary font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
