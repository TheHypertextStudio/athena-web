'use client';
import { createContext, useContext, useEffect, useState, type JSX, type ReactNode } from 'react';
import type {
  WorkTemplateGalleryItem,
  WorkTemplateGalleryQuery,
} from '@docket/work/template-gallery-contract';
import { Button, Skeleton } from '@docket/ui/primitives';
import { ImmersiveShell } from '@docket/ui/components';
import { ChevronLeft } from '@docket/ui/icons';
import Link from '@/components/docket-link';
import { useOptionalActiveOrg } from '@/components/active-org';
import { workTemplateHref } from '../work-template-navigation';
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
  initialFork,
  children,
}: {
  readonly scope: GalleryAttemptScope;
  readonly initialFork?: WorkTemplateGalleryQuery['fork'];
  readonly children: ReactNode;
}): JSX.Element {
  const browseReturn = useGalleryBrowseReturn(scope);
  const [memory, setMemory] = useState<GalleryTabMemory | null>(null);
  useEffect(() => {
    const restored = readGalleryTabMemory(scope, initialFork);
    writeGalleryTabMemory(scope, restored);
    setMemory(restored);
  }, [scope.userId, scope.orgId, initialFork]);
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
    <Context.Provider value={{ scope, memory, change, browseReturn }}>{children}</Context.Provider>
  );
}
/** Own the focused gallery activity and account-scoped review state, including loading and exit. */
export function GalleryWorkspace({
  orgId,
  initialFork,
  children,
}: {
  readonly orgId: string;
  readonly initialFork?: WorkTemplateGalleryQuery['fork'];
  readonly children: ReactNode;
}): JSX.Element {
  const session = useSession();
  const userId = session.data?.user.id;
  const workspace = useOptionalActiveOrg()?.orgs.find((org) => org.id === orgId);
  return (
    <ImmersiveShell
      header={
        <nav
          aria-label="Work templates navigation"
          className="flex min-w-0 items-center justify-between gap-2"
        >
          <Button asChild variant="ghost" className="px-0">
            <Link href={workTemplateHref(orgId)} aria-label="Back to Work templates">
              <ChevronLeft className="size-4" aria-hidden="true" />
              Work templates
            </Link>
          </Button>
          {workspace ? (
            <p className="text-body-small text-on-surface-variant min-w-0 truncate">
              {workspace.name}
            </p>
          ) : null}
        </nav>
      }
    >
      <div className="mx-auto w-full max-w-6xl min-w-0 pb-6 sm:px-6">
        {userId ? (
          <ScopedGallery
            key={`${userId}:${orgId}`}
            scope={{ userId, orgId }}
            initialFork={initialFork}
          >
            {children}
          </ScopedGallery>
        ) : (
          <Skeleton className="h-64" />
        )}
      </div>
    </ImmersiveShell>
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
