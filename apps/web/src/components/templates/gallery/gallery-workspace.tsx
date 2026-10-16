'use client';
import { createContext, useContext, useEffect, useState, type JSX, type ReactNode } from 'react';
import type { WorkTemplateGalleryItem } from '@docket/work/template-gallery-contract';
import { ControlGroup, Skeleton } from '@docket/ui/primitives';
import { useSession } from '@/lib/auth-client';
import {
  readGalleryTabMemory,
  writeGalleryTabMemory,
  type GalleryTabMemory,
} from './gallery-session';
import { useGalleryBrowseReturn, type GalleryBrowseReturn } from './use-gallery-return';
import type { GalleryAttemptScope } from './gallery-acceptance-attempt';

/** One authenticated gallery's current catalog and unsaved selection across routed detail views. */
export interface GalleryWorkspaceState {
  readonly scope: GalleryAttemptScope;
  readonly browseReturn: GalleryBrowseReturn;
  readonly memory: GalleryTabMemory;
  readonly change: (
    memory: GalleryTabMemory | ((previous: GalleryTabMemory) => GalleryTabMemory),
  ) => void;
}
const Context = createContext<GalleryWorkspaceState | null>(null);
function ScopedGallery({
  scope,
  children,
}: {
  readonly scope: GalleryAttemptScope;
  readonly children: ReactNode;
}): JSX.Element {
  const browseReturn = useGalleryBrowseReturn(scope);
  const [memory, setMemory] = useState<GalleryTabMemory | null>(null);
  useEffect(() => {
    setMemory(readGalleryTabMemory(scope));
  }, [scope.userId, scope.orgId]);
  function change(
    update: GalleryTabMemory | ((previous: GalleryTabMemory) => GalleryTabMemory),
  ): void {
    setMemory((previous) => {
      if (!previous) return previous;
      const next = typeof update === 'function' ? update(previous) : update;
      writeGalleryTabMemory(scope, next);
      return next;
    });
  }
  if (memory === null) return <Skeleton className="h-64" />;
  return (
    <Context.Provider value={{ scope, memory, change, browseReturn }}>
      <ControlGroup
        controlSize="xl"
        orientation="vertical"
        className="mx-auto w-full max-w-6xl gap-5 px-4 py-4 sm:px-8 sm:py-6"
      >
        {children}
      </ControlGroup>
    </Context.Provider>
  );
}
/** Scope tab memory to the actual signed-in account; account changes remount all review state. */
export function GalleryWorkspace({
  orgId,
  children,
}: {
  readonly orgId: string;
  readonly children: ReactNode;
}): JSX.Element {
  const session = useSession();
  const userId = session.data?.user.id;
  if (!userId) return <Skeleton className="h-64" />;
  return (
    <ScopedGallery key={`${userId}:${orgId}`} scope={{ userId, orgId }}>
      {children}
    </ScopedGallery>
  );
}
/** Read a gallery selection only inside its authenticated workspace layout. */
export function useGalleryWorkspace(): GalleryWorkspaceState {
  const value = useContext(Context);
  if (!value) throw new Error('Gallery workspace is unavailable.');
  return value;
}
/** Resolve selected metadata from the current catalog rather than treating cached labels as authority. */
export function gallerySelectedItems(
  state: GalleryWorkspaceState,
  catalog: readonly WorkTemplateGalleryItem[],
): readonly WorkTemplateGalleryItem[] {
  return state.memory.choices.roots.flatMap((slug) => {
    const item = catalog.find((entry) => entry.slug === slug);
    return item ? [item] : [];
  });
}
