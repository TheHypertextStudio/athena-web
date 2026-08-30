import type { JSX } from 'react';

import { CtaBandActions } from './marketing-cta';

/**
 * The last call to action, on the page's one inverted panel.
 *
 * @remarks
 * The action row is delegated to {@link CtaBandActions}, which is styled for ink
 * (`variant="secondary"`, `text-paper/60`). Moving this section onto paper would break it.
 *
 * The panel is proportioned to the one control it holds. It carried a price line above the button
 * until that repeated what the pricing cards already say, and the padding sized for two elements
 * left the button floating in an empty field.
 *
 * @returns The closing panel.
 */
export function ClosingSection(): JSX.Element {
  return (
    <section className="bg-ink">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start px-6 py-16">
        <CtaBandActions />
      </div>
    </section>
  );
}
