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

import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';

/**
 * The email/password sign-up screen.
 *
 * @remarks
 * A Client Component (it owns form state and calls the Better Auth client). On a successful
 * sign-up the session cookie is set and the user is routed to `/onboarding`, where they
 * create their first organization. Errors from Better Auth are surfaced inline via
 * `error.message`.
 *
 * Passkey sign-up is intentionally deferred — email/password is the only enabled method —
 * but the footer reserves a clearly-marked spot for the future passkey CTA.
 */
export default function SignUpPage(): JSX.Element {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Create the account, then route into onboarding to set up the first org. */
  async function submit(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const { error: authError } = await authClient.signUp.email({ name, email, password });
      if (authError) {
        setError(authError.message ?? 'Could not create your account. Please try again.');
        return;
      }
      router.push('/onboarding');
    } catch (caught) {
      setError(readError(caught, 'Something went wrong creating your account. Please try again.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Create your account</CardTitle>
          <CardDescription>Start your calm command center for work.</CardDescription>
        </CardHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                placeholder="Ada Lovelace"
              />
            </div>
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
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
                placeholder="At least 8 characters"
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
              {pending ? 'Creating account…' : 'Create account'}
            </Button>
            {/* Passkey CTA goes here once passkey auth is enabled (deferred). */}
            <p className="text-muted-foreground text-center text-sm">
              Already have an account?{' '}
              <Link
                href="/sign-in"
                className="text-primary font-medium underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
