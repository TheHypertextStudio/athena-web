import Link from 'next/link';
import type { JSX } from 'react';

import { CtaBandActions } from './marketing-cta';

/** Props for {@link ClosingSection}. */
export interface ClosingSectionProps {
  /**
   * Whether to show the price line and the link to `/pricing`.
   *
   * @remarks
   * Required rather than defaulted, so `/pricing` cannot end up linking to itself because
   * somebody forgot to pass it.
   */
  readonly pricing: boolean;
}

/**
 * The price and the last call to action, on the page's one inverted panel.
 *
 * @remarks
 * The action row is delegated to {@link CtaBandActions}, which is styled for ink
 * (`variant="secondary"`, `text-paper/60`). Moving this section onto paper would break it.
 *
 * @param props - Whether the price line is shown.
 * @returns The closing panel.
 */
export function ClosingSection({ pricing }: ClosingSectionProps): JSX.Element {
  return (
    <section className="bg-ink">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-8 px-6 py-24">
        {pricing ? (
          <div className="flex flex-col gap-4">
            <p className="font-display text-paper max-w-3xl text-4xl tracking-tight text-balance">
              Free for one workspace. $8 a month to run more.
            </p>
            <p className="text-base">
              <Link
                href="/pricing"
                className="text-paper/75 hover:text-paper decoration-paper/30 font-medium underline underline-offset-4 transition-colors"
              >
                See what each plan includes →
              </Link>
            </p>
          </div>
        ) : null}
        <CtaBandActions />
      </div>
    </section>
  );
}
