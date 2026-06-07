'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
} from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';

import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';

/**
 * The email/password sign-in screen.
 *
 * @remarks
 * A Client Component (it owns form state and calls the Better Auth client). On success it
 * routes the user into the Hub "Today" cockpit (`/today`), or to `/onboarding` when they
 * belong to no organization yet; the membership lookup goes through the typed RPC client so
 * it rides the freshly-set session cookie. Errors from Better Auth are surfaced inline via
 * `error.message`.
 *
 * Passkey sign-in is intentionally deferred — email/password is the only enabled method —
 * but the footer reserves a clearly-marked spot for the future passkey CTA.
 */
export default function SignInPage(): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Sign in, then route to the Today cockpit (or onboarding when the user has no org). */
  async function submit(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const { error: authError } = await authClient.signIn.email({ email, password });
      if (authError) {
        setError(authError.message ?? 'Could not sign in. Check your email and password.');
        return;
      }
      const res = await api.v1.orgs.$get();
      if (res.ok) {
        const { items } = await res.json();
        router.push(items.length > 0 ? '/today' : '/onboarding');
        return;
      }
      router.push('/onboarding');
    } catch (caught) {
      setError(readError(caught, 'Something went wrong signing in. Please try again.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>Sign in to your Docket workspace.</CardDescription>
        </CardHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                placeholder="you@example.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
                placeholder="••••••••"
              />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
            {/* Passkey CTA goes here once passkey auth is enabled (deferred). */}
            <p className="text-muted-foreground text-center text-sm">
              New to Docket?{' '}
              <Link
                href="/sign-up"
                className="text-primary font-medium underline-offset-4 hover:underline"
              >
                Create an account
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
