import Link from 'next/link';
import type { JSX } from 'react';

interface Principle {
  quote: string;
  gloss: string;
}

const PRINCIPLES: readonly Principle[] = [
  {
    quote: 'Separation where it protects you.',
    gloss: 'Each organization is sealed — people, permissions, vocabulary, tools.',
  },
  {
    quote: 'Unification where it empowers you.',
    gloss: 'One day, one portfolio, one inbox — drawn from all of them.',
  },
];

/**
 * The two halves of the product's thesis as typographic moments — oversized Fraunces
 * italic pull-quotes with one-line Plex glosses and generous air. Type is the visual.
 */
export function PrinciplesStrip(): JSX.Element {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-24">
      <div className="flex flex-col gap-16">
        {PRINCIPLES.map((principle) => (
          <blockquote
            key={principle.quote}
            className="flex max-w-3xl flex-col gap-4 even:self-end even:text-right"
          >
            <p className="font-display text-title text-ink tracking-tight italic">
              {principle.quote}
            </p>
            <footer className="text-ink-muted text-base">{principle.gloss}</footer>
          </blockquote>
        ))}
      </div>
      <p className="text-ink-muted mt-16 text-center font-mono text-xs">
        <Link
          href="/about"
          className="hover:text-sienna underline underline-offset-4 transition-colors"
        >
          Read all four principles →
        </Link>
      </p>
    </section>
  );
}
