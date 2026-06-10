import type { Metadata } from 'next';
import type { JSX } from 'react';

import { CtaBand } from '@/components/marketing/cta-band';

/** About page metadata. */
export const metadata: Metadata = {
  title: 'About',
  description:
    'Why Docket exists: a calm command center for the many organizations one person can run.',
};

interface Principle {
  number: string;
  title: string;
  body: string;
}

const PRINCIPLES: readonly Principle[] = [
  {
    number: '01',
    title: 'Separation by default',
    body: 'Every organization is its own world — its own people, tools, and vocabulary. Nothing leaks between the startup and the nonprofit unless you choose it to.',
  },
  {
    number: '02',
    title: 'Unification on top',
    body: 'Your command center gathers the organizations you belong to into one daily view, so running many things feels like running one.',
  },
  {
    number: '03',
    title: 'On top of your tools',
    body: 'Docket coordinates the work; your documents, calendars, and code stay where they already live. We connect, we do not replace.',
  },
  {
    number: '04',
    title: 'People and agents, together',
    body: 'Agents are teammates you can hand work to and supervise — never a black box. You always see the steps and approve what matters.',
  },
];

/** About page — editorial essay register: Fraunces display, measured prose, numbered principles. */
export default function AboutPage(): JSX.Element {
  return (
    <>
      <section className="mx-auto w-full max-w-3xl px-6 pt-20 pb-16">
        <p className="text-ink-muted font-mono text-xs tracking-[0.14em] uppercase">About Docket</p>
        <h1 className="font-display text-title text-ink mt-4 tracking-tight text-balance">
          Most people run more than one thing.
        </h1>
        <div className="text-ink-muted mt-8 flex flex-col gap-5 text-lg leading-relaxed">
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
      <section className="border-border border-t">
        <div className="mx-auto w-full max-w-6xl px-6 py-16">
          <p className="text-ink-muted font-mono text-xs tracking-[0.14em] uppercase">
            What we hold to
          </p>
          <dl className="mt-8 grid gap-x-12 gap-y-12 sm:grid-cols-2">
            {PRINCIPLES.map((principle) => (
              <div
                key={principle.number}
                className="border-border flex flex-col gap-3 border-t pt-5"
              >
                <span aria-hidden className="text-sienna font-mono text-sm">
                  {principle.number}
                </span>
                <dt className="font-display text-ink text-2xl leading-snug tracking-tight">
                  {principle.title}
                </dt>
                <dd className="text-ink-muted text-base">{principle.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
