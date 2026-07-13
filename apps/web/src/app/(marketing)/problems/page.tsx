import { PROBLEM_CATALOG, PROBLEM_CODES } from '@docket/types';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

/** Metadata for the public, occurrence-safe problem catalog. */
export const metadata: Metadata = {
  title: 'Problem types',
  description: 'Docket problem types and general recovery guidance.',
};

/** Public registry of the stable problem codes Docket surfaces can link to. */
export default function ProblemsPage(): JSX.Element {
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pt-20 pb-24">
      <header>
        <p className="text-ink-muted font-mono text-xs tracking-[0.14em] uppercase">Support</p>
        <h1 className="font-display text-title text-ink mt-4 tracking-tight">Problem types</h1>
        <p className="text-ink-muted mt-4 max-w-2xl leading-relaxed">
          Docket links errors here by stable code. These pages describe general recovery only; they
          do not contain information about a specific account, request, or item.
        </p>
      </header>

      <ul className="border-border flex flex-col border-t">
        {PROBLEM_CODES.map((code) => {
          const problem = PROBLEM_CATALOG[code];
          return (
            <li key={code} className="border-border py-5">
              <Link href={`/problems/${code}`} className="group block">
                <p className="text-ink font-medium group-hover:underline">{problem.title}</p>
                <p className="text-ink-muted mt-1 leading-relaxed">{problem.summary}</p>
                <p className="text-ink-muted mt-3 font-mono text-xs">{code}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
