import type { JSX } from 'react';

interface SecondaryItem {
  title: string;
  slot: string;
}

/**
 * The things that are real but do not earn a screenshot on the landing page.
 *
 * @remarks
 * Time tracking sits here rather than above. It is one of the strongest things Docket does and it
 * is still not what someone is shopping for when they land, so it gets a line instead of a plate.
 */
const ITEMS: readonly SecondaryItem[] = [
  {
    title: 'Time tracking',
    slot: 'Log hours on a task without opening a separate timer app.',
  },
  {
    title: 'Status updates',
    slot: 'Post progress on the task itself, where whoever needs it will actually see it.',
  },
  {
    title: 'Connected tools',
    slot: 'Gmail, Google Calendar, and whatever else an organization runs, connected once instead of copied by hand into each one.',
  },
];

/**
 * A rule-separated row of secondary capabilities — titles and one line each, no plates.
 *
 * @returns The secondary row.
 */
export function SecondaryList(): JSX.Element {
  return (
    <section className="border-outline-variant bg-paper-deep border-y">
      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <dl className="divide-outline-variant border-outline-variant grid divide-y border-t md:grid-cols-3 md:divide-x md:divide-y-0">
          {ITEMS.map((item, index) => (
            <div
              key={item.title}
              className={`flex flex-col gap-2 py-6 md:pb-0 ${index > 0 ? 'md:pl-8' : ''} ${
                index < ITEMS.length - 1 ? 'md:pr-8' : ''
              }`}
            >
              <dt className="font-display text-ink text-xl tracking-tight">{item.title}</dt>
              <dd className="text-ink-muted/60 font-mono text-xs">{item.slot}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
