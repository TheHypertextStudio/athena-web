import type { JSX } from 'react';

/** One ordered onboarding step shown in the "how it works" section. */
interface Step {
  /** The step's display number (1-based). */
  number: string;
  /** The step's short title. */
  title: string;
  /** A plain-language description of what happens in this step. */
  body: string;
}

/** The three onboarding steps, in order. */
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

/**
 * The "how it works" section: three numbered steps from sign-up to a planned day.
 *
 * @remarks
 * A Server Component. Anchored as `#how-it-works` so the footer can link to it. The copy is
 * domain-neutral so it reads the same for a founder, an organizer, or a one-person shop.
 */
export function HowItWorks(): JSX.Element {
  return (
    <section id="how-it-works" className="border-border/60 bg-card/30 scroll-mt-20 border-y">
      <div className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="flex max-w-2xl flex-col gap-3">
          <span className="text-primary text-sm font-medium">From zero to in control</span>
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
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
