import type { JSX } from 'react';

interface Step {
  number: string;
  title: string;
  body: string;
}

const STEPS: readonly Step[] = [
  {
    number: '01',
    title: 'Create your space',
    body: 'Start with a personal command center, then add an organization for each venture — a startup, a nonprofit, a club.',
  },
  {
    number: '02',
    title: 'Bring your work in',
    body: 'Connect the tools each organization already uses and import the work that lives there. Your real tasks, on day one.',
  },
  {
    number: '03',
    title: 'Plan your day',
    body: 'Pull what matters from every organization into one Today view, delegate what you can, and approve the rest.',
  },
];

export function HowItWorks(): JSX.Element {
  return (
    <section id="how-it-works" className="border-border/60 bg-card/30 scroll-mt-20 border-y">
      <div className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="flex max-w-2xl flex-col gap-3">
          <span className="text-primary text-sm font-medium">From zero to in control</span>
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Up and running in minutes
          </h2>
        </div>
        <ol className="mt-12 grid gap-8 md:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.number} className="flex flex-col gap-3">
              <span className="text-muted-foreground text-sm font-semibold">{step.number}</span>
              <h3 className="text-lg font-semibold">{step.title}</h3>
              <p className="text-muted-foreground text-sm">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
