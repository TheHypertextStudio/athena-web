'use client';

/**
 * The URL convention that lets something outside a list page open that page's create composer.
 *
 * @remarks
 * Create dialogs are controlled by their host page, which is right: the page owns the roster the
 * new row is prepended to and the route it navigates to afterwards. It also means nothing else can
 * open one — and the command palette needs to.
 *
 * Rather than hoisting four dialogs into a global provider, a command navigates to the page that
 * already owns the dialog and asks for it in the URL: `?compose=1`, optionally with
 * `&template=<id>`. The page opens its own composer, exactly as its header button does, and clears
 * the parameters so a refresh or a back-navigation does not reopen it.
 *
 * @example
 * ```tsx
 * const { composeRequested, templateId, clearCompose } = useComposeParam();
 * useEffect(() => { if (composeRequested) setCreateOpen(true); }, [composeRequested]);
 * // …and call clearCompose() when the dialog closes.
 * ```
 */
import { useRouter } from 'next/navigation';
import { useAppPathname, useAppSearchParams } from '@/lib/app-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** The query parameter asking a page to open its create composer. */
export const COMPOSE_PARAM = 'compose';
/** The query parameter naming a template to pre-apply. */
export const COMPOSE_TEMPLATE_PARAM = 'template';

/** Build the href a command uses to open a page's composer. */
export function composeHref(basePath: string, templateId?: string): string {
  const params = new URLSearchParams({ [COMPOSE_PARAM]: '1' });
  if (templateId) params.set(COMPOSE_TEMPLATE_PARAM, templateId);
  return `${basePath}?${params.toString()}`;
}

/** What a list page reads to honour an inbound compose request. */
export interface ComposeParam {
  /** Whether the URL is asking this page to open its create composer. */
  readonly composeRequested: boolean;
  /** The template to pre-apply, or null for a blank draft. */
  readonly templateId: string | null;
  /** Strip both parameters, so the request is consumed exactly once. */
  readonly clearCompose: () => void;
}

/**
 * Read (and consume) an inbound compose request from the URL.
 *
 * @returns the {@link ComposeParam} handle.
 */
export function useComposeParam(): ComposeParam {
  const router = useRouter();
  const pathname = useAppPathname();
  const searchParams = useAppSearchParams();

  const composeRequested = searchParams.get(COMPOSE_PARAM) === '1';
  const templateId = searchParams.get(COMPOSE_TEMPLATE_PARAM);

  const clearCompose = useCallback((): void => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(COMPOSE_PARAM);
    next.delete(COMPOSE_TEMPLATE_PARAM);
    const query = next.toString();
    // `replace`, not `push`: the compose request is a one-shot instruction, and leaving it in the
    // history would reopen the dialog every time someone navigated back to this page.
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  return useMemo(
    () => ({ composeRequested, templateId, clearCompose }),
    [composeRequested, templateId, clearCompose],
  );
}

/**
 * Honour an inbound compose request: open the page's composer, once, and keep its template.
 *
 * @remarks
 * The whole wiring a list page needs, so the four pages cannot implement it four ways. The
 * template id is copied into state before the URL is cleaned, because clearing the parameters is
 * what stops a back-navigation reopening the dialog — and it would otherwise take the template
 * with it before the composer had read it.
 *
 * @param setOpen - The page's own composer open-state setter (stable, from `useState`).
 * @returns the template id the composer should pre-apply, or null.
 *
 * @example
 * ```tsx
 * const [createOpen, setCreateOpen] = useState(false);
 * const composeTemplateId = useComposeRequest(setCreateOpen);
 * <CreateTaskDialog open={createOpen} defaultTemplateId={composeTemplateId} … />
 * ```
 */
export function useComposeRequest(setOpen: (open: boolean) => void): string | null {
  const { composeRequested, templateId, clearCompose } = useComposeParam();
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);
  const consumed = useRef(false);

  useEffect(() => {
    if (!composeRequested || consumed.current) return;
    consumed.current = true;
    setPendingTemplateId(templateId);
    setOpen(true);
    clearCompose();
  }, [composeRequested, templateId, setOpen, clearCompose]);

  return pendingTemplateId;
}
