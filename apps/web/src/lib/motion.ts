'use client';

/**
 * `lib/motion` — motion-preference helpers.
 *
 * @remarks
 * A single place to read the native `prefers-reduced-motion` query, so imperative animations (Web
 * Animations API pops, smooth `scrollIntoView`) can honor it consistently. CSS-driven motion should
 * prefer Tailwind's `motion-safe:`/`motion-reduce:` variants; this is for the JS side.
 */

/** Whether the user has requested reduced motion. SSR-safe (returns `false` before hydration). */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
