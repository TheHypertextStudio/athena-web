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
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';

import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';

/**
 * The operator email/password sign-in screen.
 *
 * @remarks
 * A Client Component that owns form state and calls the Better Auth client. The admin
 * console assumes the signed-in user is staff — the API 403s every admin route otherwise,
 * which the authenticated screens surface inline. On success it routes to the operator
 * dashboard (`/`). Errors from Better Auth are surfaced inline via `error.message`.
 */
export default function SignInPage(): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Sign in, then route to the operator dashboard. */
  async function submit(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const { error: authError } = await authClient.signIn.email({ email, password });
      if (authError) {
        setError(authError.message ?? 'Could not sign in. Check your email and password.');
        return;
      }
      router.push('/');
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
          <CardTitle className="text-2xl">Docket service admin</CardTitle>
          <CardDescription>Sign in with your operator account.</CardDescription>
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
                placeholder="operator@docket.com"
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
            <p className="text-muted-foreground text-center text-xs">
              Operator access only. Non-staff accounts are rejected.
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
