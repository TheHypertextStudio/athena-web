'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signUp, signInWithGoogle } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const result = await signUp.email({ name, email, password });
      if (result.error) {
        setError(result.error.message ?? 'Sign up failed');
      } else {
        router.push('/dashboard');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogleSignUp() {
    setIsLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch {
      setError('Google sign-up failed');
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">Create Account</h1>
        <p className="text-muted-foreground">Enter your details to get started</p>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">{error}</div>
      )}

      <form onSubmit={(e) => void handleSignUp(e)} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="John Doe"
            required
            autoComplete="name"
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
          />
        </div>

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
            autoComplete="email"
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
            minLength={8}
            autoComplete="new-password"
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
          />
          <p className="text-muted-foreground text-xs">Minimum 8 characters</p>
        </div>

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Creating account...' : 'Create Account'}
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

      <Button
        variant="outline"
        type="button"
        onClick={() => void handleGoogleSignUp()}
        disabled={isLoading}
        className="w-full"
      >
        Google
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{' '}
        <a href="/login" className="hover:text-primary underline underline-offset-4">
          Sign in
        </a>
      </p>
    </div>
  );
}
