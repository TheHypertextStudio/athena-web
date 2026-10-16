'use client';
import { useEffect, useRef, type JSX } from 'react';
import { useAppLocation } from '@/lib/app-location';
import { useAppRouter } from '@/lib/interactions/navigation';
import { legacyWorkTemplateHref } from './work-template-navigation';

/** Reopen saved template links in their workspace without adding a settings entry to Back history. */
export function LegacyWorkTemplateRedirect(): JSX.Element {
  const { pathname, searchParams } = useAppLocation();
  const router = useAppRouter();
  const search = searchParams.toString();
  const replaced = useRef<string | null>(null);
  useEffect(() => {
    const href = legacyWorkTemplateHref(
      `${pathname}${search ? `?${search}` : ''}${window.location.hash}`,
    );
    if (href && replaced.current !== href) {
      replaced.current = href;
      router.replace(href);
    }
  }, [pathname, search, router]);
  return <p role="status">Opening Work templates…</p>;
}
