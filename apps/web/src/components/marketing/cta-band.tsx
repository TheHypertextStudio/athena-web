import type { JSX } from 'react';

import { CtaBandActions } from './marketing-cta';

/**
 * Closing call-to-action — a full-bleed ink panel: the page's one inversion, typographic
 * rather than a floating rounded card.
 *
 * @remarks
 * The action row is delegated to {@link CtaBandActions} so a signed-in reader is offered their
 * workspace rather than another sign-up.
 */
export function CtaBand(): JSX.Element {
  return (
    <section className="bg-ink">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-7 px-6 py-24">
        <h2 className="font-display text-display-large-small text-paper max-w-2xl tracking-tight text-balance">
          Bring all your work under one calm roof.
        </h2>
        <p className="text-paper/75 max-w-xl text-base text-balance">
          Set up your personal command center in minutes, then add every organization you run.
        </p>
        <CtaBandActions />
      </div>
    </section>
  );
}
