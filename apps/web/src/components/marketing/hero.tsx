import type { JSX } from 'react';

import { HeroActions } from './marketing-cta';
import { PlaceholderSurface } from './placeholder-surface';

/**
 * Hero — display headline, one supporting line, the action row, then a wide product plate.
 *
 * @remarks
 * The plate is wider than the text measure and runs past it on the right. The previous hero put
 * everything inside one narrow left column and left the right half of a 1280px viewport empty,
 * which read as an unfinished page rather than as restraint.
 *
 * The action row is delegated to {@link HeroActions} so it can reflect the session without making
 * the whole hero a Client Component.
 */
export function Hero(): JSX.Element {
  return (
    <section className="mx-auto w-full max-w-6xl px-6">
      <div className="flex flex-col gap-7 pt-20 sm:pt-28">
        <h1 className="font-display text-display-large text-ink wonk max-w-3xl tracking-tight text-balance">
          Docket is one tool for planning, scheduling, and tracking every kind of work.
        </h1>
        <p className="text-ink-muted max-w-xl text-lg text-balance">
          Each task carries its estimate, its place on the calendar, and the hours it took.
        </p>
        <HeroActions />
      </div>
      <div className="mt-16 sm:mt-20">
        <PlaceholderSurface
          label="Today — the landing view, tasks across every organization"
          aspect="aspect-[16/9]"
          tone="paper"
        />
      </div>
    </section>
  );
}
