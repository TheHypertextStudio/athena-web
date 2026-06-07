import type { Metadata } from 'next';
import type { JSX } from 'react';

import { CtaBand } from '@/components/cta-band';

/** Page-specific metadata for the about route. */
export const metadata: Metadata = {
  title: 'About',
  description:
    'Why Docket exists: a calm command center for the many organizations one person can run.',
};

/** One principle behind the product, shown as a card on the about page. */
interface Principle {
  /** The principle's short title. */
  title: string;
  /** A plain-language explanation of the principle. */
  body: string;
}

/** The product principles, in display order. */
const PRINCIPLES: readonly Principle[] = [
  {
    title: 'Separation by default',
    body: 'Every organization is its own world — its own people, tools, and vocabulary. Nothing leaks between the startup and the nonprofit unless you choose it to.',
  },
  {
    title: 'Unification on top',
    body: 'Your command center gathers the organizations you belong to into one daily view, so running many things feels like running one.',
  },
  {
    title: 'On top of your tools',
    body: 'Docket coordinates the work; your documents, calendars, and code stay where they already live. We connect, we do not replace.',
  },
  {
    title: 'People and agents, together',
    body: 'Agents are teammates you can hand work to and supervise — never a black box. You always see the steps and approve what matters.',
  },
];

/**
 * The about page: the product's story and the principles behind it.
 *
 * @remarks
 * A static Server Component. The narrative is deliberately domain-neutral — Docket is for
 * anyone running more than one thing, not a developer tool — and frames the relationship
 * between the product (Docket) and its first-party agent (Athena).
 */
export default function AboutPage(): JSX.Element {
  return (
    <>
      <section className="mx-auto w-full max-w-3xl px-6 pb-12 pt-20">
        <span className="text-primary text-sm font-medium">About Docket</span>
        <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Most people run more than one thing
        </h1>
        <div className="text-muted-foreground mt-6 flex flex-col gap-4 text-lg">
          <p>
            A founder is also a volunteer. An organizer is also building something on the side. The
            tools we use assume you live inside a single workspace — but real life spills across
            many.
          </p>
          <p>
            Docket is the command center for all of it. Each organization keeps its own context;
            your day brings them together. It is, in spirit, &ldquo;Linear for everything&rdquo; —
            the same calm, fast, structured feel, pointed at every kind of work instead of just one.
          </p>
          <p>
            Athena, Docket&rsquo;s built-in agent, is along for the ride when you want the help —
            but Docket is agent-agnostic, and the work model comes first. The product is the point;
            the agent is a participant.
          </p>
        </div>
      </section>
      <section className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid gap-5 sm:grid-cols-2">
          {PRINCIPLES.map((principle) => (
            <div
              key={principle.title}
              className="border-border bg-card flex flex-col gap-2 rounded-xl border p-6"
            >
              <h2 className="text-base font-semibold">{principle.title}</h2>
              <p className="text-muted-foreground text-sm">{principle.body}</p>
            </div>
          ))}
        </div>
      </section>
      <CtaBand />
    </>
  );
}
