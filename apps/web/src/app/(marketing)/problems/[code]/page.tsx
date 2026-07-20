import { PROBLEM_CODES, problemDefinition } from '@docket/types';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { PUBLIC_PROBLEM_RECOVERY } from '@/lib/problem-recovery';

interface ProblemPageProps {
  /** The stable, public problem code supplied by the route. */
  params: Promise<{ code: string }>;
}

/** Pre-render every closed problem type so stable API links remain available without a database. */
export function generateStaticParams(): { code: string }[] {
  return PROBLEM_CODES.map((code) => ({ code }));
}

/** Build occurrence-safe metadata for one public problem page. */
export async function generateMetadata({ params }: ProblemPageProps): Promise<Metadata> {
  const { code } = await params;
  const problem = problemDefinition(code);
  return problem
    ? { title: problem.title, description: problem.summary }
    : { title: 'Problem type' };
}

/** Public, generic recovery guidance for one stable Docket problem type. */
export default async function ProblemPage({ params }: ProblemPageProps): Promise<JSX.Element> {
  const { code } = await params;
  const problem = problemDefinition(code);
  if (!problem) notFound();

  const action = PUBLIC_PROBLEM_RECOVERY[problem.recovery];

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pt-20 pb-24">
      <header>
        <Link href="/problems" className="text-ink-muted text-sm underline underline-offset-4">
          Problem types
        </Link>
        <p className="text-ink-muted mt-8 font-mono text-xs">
          HTTP {problem.status} · {code}
        </p>
        <h1 className="font-display text-display-large-small text-ink mt-4 tracking-tight">
          {problem.title}
        </h1>
        <p className="text-ink-muted mt-4 max-w-2xl text-lg leading-relaxed">{problem.summary}</p>
      </header>

      <section className="border-border flex flex-col gap-4 border-t pt-7">
        <h2 className="font-display text-ink text-2xl tracking-tight">What you can do</h2>
        <p className="text-ink-muted leading-relaxed">{action.instruction}</p>
        <div>
          <Link
            href={action.href}
            className="bg-ink text-paper inline-flex min-h-10 items-center rounded-md px-4 text-sm font-medium"
          >
            {action.label}
          </Link>
        </div>
      </section>
    </article>
  );
}
