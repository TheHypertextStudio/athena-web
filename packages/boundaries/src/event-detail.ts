/**
 * `@docket/boundaries` — the detail-builder chain shared by the observer adapters.
 *
 * @remarks
 * Each observer maps a provider event onto a typed {@link EventDetail} via an *ordered chain*
 * of pure builders ("first non-null wins"), always ending in a {@link genericDetail} tail so an
 * event we don't yet have a specific shape for still surfaces as a degraded `generic` row
 * instead of being dropped (the raw original always remains in `inbound_event` for later
 * re-enrichment). {@link runDetailBuilders} is the runner; adding a tool's detail is one new
 * builder at the front of an adapter's chain.
 */
import type { EventDetail } from '@docket/types';

/**
 * A pure detail-builder: inspect the adapter's per-event context and either claim it by
 * returning a typed {@link EventDetail}, or defer to the next builder by returning `null`.
 *
 * @typeParam C - The adapter-specific context shape the builder reads.
 */
export type DetailBuilder<C> = (context: C) => EventDetail | null;

/**
 * Build the `generic` fallback detail — the chain tail that guarantees nothing is dropped.
 *
 * @param title - The display title to carry on the degraded row.
 * @param summary - Optional supporting summary.
 * @param url - Optional canonical URL.
 * @returns the `generic` {@link EventDetail} variant.
 */
export function genericDetail(title: string, summary?: string, url?: string): EventDetail {
  return { schema: 'generic', title, summary: summary ?? null, url: url ?? null };
}

/**
 * Run an ordered detail-builder chain and return the first non-null result.
 *
 * @remarks
 * The chain MUST end in a builder that always returns (e.g. one delegating to
 * {@link genericDetail}); the trailing throw is therefore unreachable and exists only to
 * satisfy the return type.
 *
 * @typeParam C - The adapter-specific context shape passed to every builder.
 * @param builders - The ordered chain; earlier, more-specific builders win.
 * @param context - The per-event context every builder inspects.
 * @returns the first typed {@link EventDetail} a builder yields.
 */
export function runDetailBuilders<C>(
  builders: readonly DetailBuilder<C>[],
  context: C,
): EventDetail {
  for (const build of builders) {
    const detail = build(context);
    if (detail) return detail;
  }
  /* v8 ignore next 2 -- the chain always ends in a generic builder that returns. */
  throw new Error('detail-builder chain must end in a builder that always returns');
}
