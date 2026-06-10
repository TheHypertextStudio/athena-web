import type { JSX } from 'react';

interface Step {
  number: string;
  title: string;
  body: string;
}

const STEPS: readonly Step[] = [
  {
    number: '1',
    title: 'Create your space',
    body: 'Start with a personal command center, then add an organization for each venture — a startup, a nonprofit, a club.',
  },
  {
    number: '2',
    title: 'Bring your work in',
    body: 'Connect the tools each organization already uses and import the work that lives there. Your real tasks, on day one.',
  },
  {
    number: '3',
    title: 'Plan your day',
    body: 'Pull what matters from every organization into one Today view, delegate what you can, and approve the rest.',
  },
];

/**
 * How-it-works — a full-bleed deep-paper band with three rule-separated steps,
 * numbered in oversized Fraunces italic.
 */
export function HowItWorks(): JSX.Element {
  return (
    <section id="how-it-works" className="border-border bg-paper-deep scroll-mt-20 border-y">
      <div className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="flex max-w-2xl flex-col gap-3">
          <p className="text-ink-muted font-mono text-xs tracking-[0.14em] uppercase">
            From zero to in control
          </p>
          <h2 className="font-display text-title text-ink tracking-tight text-balance">
            Up and running in minutes
          </h2>
        </div>
        <ol className="divide-border border-border mt-12 grid divide-y border-t md:grid-cols-3 md:divide-x md:divide-y-0">
          {STEPS.map((step, index) => (
            <li
              key={step.number}
              className={`flex flex-col gap-3 py-8 md:pt-8 md:pb-2 ${index > 0 ? 'md:pl-8' : ''} ${index < STEPS.length - 1 ? 'md:pr-8' : ''}`}
            >
              <span aria-hidden className="font-display text-sienna text-4xl italic">
                {step.number}
              </span>
              <h3 className="text-ink text-h2">{step.title}</h3>
              <p className="text-ink-muted text-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
