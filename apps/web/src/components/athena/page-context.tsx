'use client';

/**
 * What page the person is on, for Athena.
 *
 * The shell publishes the active workspace. A detail route or drawer publishes the object it
 * shows as a source. Athena reads the merged result as the default context for anything the
 * person asks, and shows it as a chip they can detach.
 */
import {
  createContext,
  type JSX,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { PersonalAthenaContext, PersonalAthenaSource } from '@/lib/athena/presentation';

/** The workspace the shell has resolved for the current route. */
export interface PageWorkspace {
  readonly workspaceId: string;
  readonly workspaceName?: string | undefined;
}

interface PageContextValue {
  readonly context: PersonalAthenaContext | null;
  readonly setSource: (source: PersonalAthenaSource | null) => void;
}

const PageContextContext = createContext<PageContextValue | null>(null);

/** Merge the shell workspace and a page source into one Athena context. */
export function buildPageContext(
  workspace: PageWorkspace | null,
  source: PersonalAthenaSource | null,
): PersonalAthenaContext | null {
  if (!workspace && !source) return null;
  return {
    ...(workspace ? { workspaceId: workspace.workspaceId } : {}),
    ...(workspace?.workspaceName ? { workspaceName: workspace.workspaceName } : {}),
    ...(source ? { source } : {}),
  };
}

/** Props for {@link PageContextProvider}. */
export interface PageContextProviderProps {
  readonly workspace: PageWorkspace | null;
  readonly children: ReactNode;
}

/** Hold the page context for everything under the shell. */
export function PageContextProvider({
  workspace,
  children,
}: PageContextProviderProps): JSX.Element {
  const [source, setSource] = useState<PersonalAthenaSource | null>(null);
  const workspaceId = workspace?.workspaceId;
  const workspaceName = workspace?.workspaceName;
  const context = useMemo(
    () =>
      buildPageContext(
        workspaceId ? { workspaceId, ...(workspaceName ? { workspaceName } : {}) } : null,
        source,
      ),
    [source, workspaceId, workspaceName],
  );
  const value = useMemo<PageContextValue>(() => ({ context, setSource }), [context]);
  return <PageContextContext.Provider value={value}>{children}</PageContextContext.Provider>;
}

/** The merged page context, or null outside a workspace and page. */
export function usePageContext(): PersonalAthenaContext | null {
  return useContext(PageContextContext)?.context ?? null;
}

/**
 * Publish the object this page shows as Athena's source while the page is mounted.
 *
 * @param source - The object on screen; null publishes nothing.
 */
export function usePublishPageSource(source: PersonalAthenaSource | null): void {
  const setSource = useContext(PageContextContext)?.setSource;
  const type = source?.type;
  const id = source?.id;
  const label = source?.label;
  useEffect(() => {
    if (!setSource || !type || !id) return;
    setSource({ type, id, ...(label ? { label } : {}) });
    return () => {
      setSource(null);
    };
  }, [id, label, setSource, type]);
}

/** Publish a page source from JSX. Renders nothing. */
export function PageSource(source: PersonalAthenaSource): null {
  usePublishPageSource(source);
  return null;
}
