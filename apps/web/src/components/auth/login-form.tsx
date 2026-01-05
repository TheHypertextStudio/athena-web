'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, signInWithGoogle, signInWithPasskey } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? 'Login failed');
      } else {
        router.push('/dashboard');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setIsLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch {
      setError('Google sign-in failed');
      setIsLoading(false);
    }
  }

  async function handlePasskeyLogin() {
    setIsLoading(true);
    setError(null);
    try {
      const result = await signInWithPasskey();
      if (result.error) {
        setError(result.error.message ?? 'Passkey login failed');
      } else {
        router.push('/dashboard');
      }
    } catch {
      setError('Passkey login failed');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">Sign In</h1>
        <p className="text-muted-foreground">Enter your credentials to access your account</p>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">{error}</div>
      )}

      <form onSubmit={(e) => void handleEmailLogin(e)} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            placeholder="you@example.com"
            required
            autoComplete="username webauthn"
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            placeholder="••••••••"
            required
            autoComplete="current-password"
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
          />
        </div>

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Signing in...' : 'Sign In'}
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background text-muted-foreground px-2">Or continue with</span>
        </div>
      </div>

      <div className="grid gap-2">
        <Button
          variant="outline"
          type="button"
          onClick={() => void handlePasskeyLogin()}
          disabled={isLoading}
        >
          Passkey
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={() => void handleGoogleLogin()}
          disabled={isLoading}
        >
          Google
        </Button>
      </div>

      <p className="text-muted-foreground text-center text-sm">
        Don&apos;t have an account?{' '}
        <a href="/signup" className="hover:text-primary underline underline-offset-4">
          Sign up
        </a>
      </p>
    </div>
  );
}
