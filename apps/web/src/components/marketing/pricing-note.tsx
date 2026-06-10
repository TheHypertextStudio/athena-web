import Link from 'next/link';
import type { JSX } from 'react';

/**
 * Pricing as one honest sentence — the landing page stops doing pricing-table work.
 * The full tiers live at /pricing.
 */
export function PricingNote(): JSX.Element {
  return (
    <section className="border-border border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-20">
        <p className="text-ink-muted font-mono text-xs tracking-[0.14em] uppercase">Pricing</p>
        <p className="font-display text-title text-ink max-w-3xl tracking-tight text-balance">
          Free for your personal command center. $8 a month when you run more.
        </p>
        <p className="text-ink-muted text-base">
          <Link
            href="/pricing"
            className="hover:text-sienna text-ink decoration-border font-medium underline underline-offset-4 transition-colors"
          >
            See what each plan includes →
          </Link>
        </p>
      </div>
    </section>
  );
}
