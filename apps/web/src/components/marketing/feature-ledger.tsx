import type { JSX } from 'react';

interface Feature {
  number: string;
  title: string;
  body: string;
  detail?: string;
}

const FEATURES: readonly Feature[] = [
  {
    number: '01',
    title: 'One home, many organizations',
    body: 'Each startup, nonprofit, or side project gets its own space — its own people, settings, and tools — so contexts never bleed together.',
  },
  {
    number: '02',
    title: 'Plan the whole day at once',
    body: 'A single Today view pulls what matters from every organization into one focused plan. Decide what to do; the noise settles.',
  },
  {
    number: '03',
    title: 'Structure that fits real work',
    body: 'Initiatives, programs, projects, and tasks — from a one-off campaign launch to an operation that simply never ends.',
  },
  {
    number: '04',
    title: 'Bring the tools you already use',
    body: 'Connect Google, Linear, GitHub, Slack, and more per organization. Docket coordinates on top of what each team already runs.',
  },
  {
    number: '05',
    title: 'Never miss a message that matters',
    body: 'Connect Slack once and every @mention, direct message, and reply in your threads lands in your Stream — filtered to what actually concerns you, linked back to the conversation.',
    detail: 'mentioned you in #launch-planning · Slack',
  },
  {
    number: '06',
    title: 'Work alongside agents',
    body: 'Hand a task to Athena — or your own agent — watch every step, and approve anything before it lands. You stay in control.',
    detail: 'step 3 of 5 · awaiting your approval',
  },
  {
    number: '07',
    title: 'Keep everyone accountable',
    body: 'Status, health, and updates roll up across every venture into one clear picture you can share with the people who care.',
  },
];

/**
 * Features as a numbered editorial ledger — Plex Mono numerals, Fraunces titles, hairline
 * rules between entries. No icon cards, no grid of rounded rectangles.
 */
export function FeatureLedger(): JSX.Element {
  return (
    <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="flex max-w-2xl flex-col gap-3">
        <p className="text-ink-muted font-mono text-xs tracking-[0.14em] uppercase">What you get</p>
        <h2 className="font-display text-title text-ink tracking-tight text-balance">
          Built for everyone who runs more than one thing
        </h2>
      </div>
      <dl className="border-border mt-12 border-t">
        {FEATURES.map((feature) => (
          <div
            key={feature.number}
            className="border-border grid gap-2 border-b py-7 sm:grid-cols-[5rem_minmax(0,2fr)_minmax(0,3fr)] sm:gap-6"
          >
            <span aria-hidden className="text-sienna pt-1 font-mono text-sm">
              {feature.number}
            </span>
            <dt className="font-display text-ink text-2xl leading-snug tracking-tight">
              {feature.title}
            </dt>
            <dd className="flex flex-col gap-3">
              <p className="text-ink-muted text-base">{feature.body}</p>
              {feature.detail ? (
                <p className="border-border text-ink-muted self-start rounded-full border px-3 py-1 font-mono text-xs">
                  {feature.detail}
                </p>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
