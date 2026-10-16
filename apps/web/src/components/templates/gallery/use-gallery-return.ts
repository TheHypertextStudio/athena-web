'use client';
import { useMemo } from 'react';
import { restoreShellScroll, shellScrollPosition } from '@/lib/app-location';
import { readGalleryTabMemory, writeGalleryTabMemory } from './gallery-session';
import type { GalleryAttemptScope } from './gallery-acceptance-attempt';

/** Return to the actual browse row and canonical shell scroll position after inspecting work. */
export interface GalleryBrowseReturn {
  readonly remember: (slug: string) => void;
  readonly restore: () => void;
}
/** Preserve actual browse focus across local page remounts using the same scoped unsaved tab memory. */
export function useGalleryBrowseReturn(scope: GalleryAttemptScope): GalleryBrowseReturn {
  return useMemo(
    () => ({
      remember: (slug: string): void => {
        const memory = readGalleryTabMemory(scope);
        writeGalleryTabMemory(scope, { ...memory, returnTo: { slug, ...shellScrollPosition() } });
      },
      restore: (): void => {
        const target = readGalleryTabMemory(scope).returnTo;
        if (!target) return;
        restoreShellScroll({ top: target.top, left: target.left });
        window.requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(`a[data-gallery-slug="${CSS.escape(target.slug)}"]`)
            ?.focus({ preventScroll: true });
        });
      },
    }),
    [scope.userId, scope.orgId],
  );
}
