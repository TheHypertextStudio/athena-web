'use client';

import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';

/** The recoverable kinds of app content a route can fail to provide. */
export type AppContentFallbackKind = 'error' | 'not-found';

/** Props for {@link AppContentFallback}. */
export interface AppContentFallbackProps {
  /** Whether a route failed unexpectedly or deliberately reported a missing resource. */
  readonly kind: AppContentFallbackKind;
  /** Re-render the failed route when the error boundary can retry it. */
  readonly onRetry?: (() => void) | undefined;
  /** A known-good in-app destination when the current route cannot be recovered. */
  readonly returnHref?: string | undefined;
  /** The label for the known-good destination. */
  readonly returnLabel?: string | undefined;
}

const FALLBACK_COPY: Readonly<
  Record<
    AppContentFallbackKind,
    { readonly eyebrow: string; readonly title: string; readonly body: string }
  >
> = {
  error: {
    eyebrow: 'Page unavailable',
    title: 'Couldn’t load this page',
    body: 'Try again, or return to your work and continue from there.',
  },
  'not-found': {
    eyebrow: '404',
    title: 'This page doesn’t exist',
    body: 'It may have moved, or the link may be out of date.',
  },
};

/**
 * A recoverable route fallback that stays inside the authenticated shell's content region.
 *
 * @remarks
 * This is deliberately `h-full`, never viewport-sized: its parent is the existing `AppShell`
 * content area, so the sidebar, tabs, command palette, and other persistent navigation stay
 * mounted while a page cannot. All copy is owned by the application; route error details are not
 * accepted here and therefore cannot reach the person using the app.
 *
 * @param props - The fallback kind and optional recovery actions.
 * @returns A bounded route recovery surface.
 */
export function AppContentFallback({
  kind,
  onRetry,
  returnHref = '/today',
  returnLabel = 'Go to Today',
}: AppContentFallbackProps): JSX.Element {
  const copy = FALLBACK_COPY[kind];

  return (
    <section
      aria-labelledby="app-content-fallback-title"
      className="flex h-full w-full items-center justify-center p-6"
    >
      <div className="border-outline-variant bg-surface-container-low/60 flex w-full max-w-md flex-col items-center gap-3 rounded-xl border p-8 text-center">
        <p className="text-on-surface-variant text-label-large">{copy.eyebrow}</p>
        <h1 id="app-content-fallback-title" className="text-on-surface text-title-large">
          {copy.title}
        </h1>
        <p className="text-on-surface-variant text-body-medium max-w-xs">{copy.body}</p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {onRetry ? (
            <Button type="button" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          <Button asChild size="sm" variant={onRetry ? 'outline' : 'default'}>
            <Link href={returnHref}>{returnLabel}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
