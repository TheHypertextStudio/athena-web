import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="space-y-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Athena</h1>
        <p className="text-muted-foreground max-w-md text-lg">
          Your next-generation productivity platform. Organize tasks, manage projects, and achieve
          your goals with AI-powered assistance.
        </p>
        <div className="flex justify-center gap-4">
          <Button asChild>
            <Link href="/login">Sign In</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/signup">Create Account</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
