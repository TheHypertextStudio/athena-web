'use client';

/**
 * Name the browser tab after the document on screen.
 *
 * @remarks
 * Every authenticated route inherits the root layout's static title, so a reader with six
 * documents open has six browser tabs all reading "Docket" — and the browser's own tab strip,
 * window switcher and history entries become useless for telling them apart.
 *
 * A client hook rather than `generateMetadata` because these pages are client components: the
 * name is not known at request time, it arrives with the record. The title is restored on
 * unmount so leaving a document does not leave its name behind on an unrelated screen.
 */
import { useEffect } from 'react';

/** The product name every title falls back to and is suffixed with. */
const APP_NAME = 'Docket';

/**
 * Set `document.title` to this document's name while the page is mounted.
 *
 * @param title - The name currently on screen, or `null`/`undefined` while unknown.
 *
 * @example
 * ```ts
 * useDocumentTitle(project?.name);
 * ```
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
