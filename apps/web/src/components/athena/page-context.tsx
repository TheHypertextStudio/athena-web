'use client';

/**
 * What page the person is on, for Athena.
 *
 * The shell publishes the active workspace. A detail route or drawer publishes the object it
 * shows as a source. Athena reads the merged result as the default context for anything the
 * person asks, and shows it as a chip they can detach.
 *
 * More than one publisher can be mounted at once — a drawer (the calendar item panel) can open
 * on top of a detail page, publishing its own source while the page underneath is still mounted.
 * The provider keeps one entry per publisher, keyed by a stable id, and reads the most recently
 * added entry as the active source. Closing the drawer removes only its own entry, so the page's
 * source is exactly what it was before the drawer opened — never a transient `null`.
 */
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';

import type { PersonalAthenaContext, PersonalAthenaSource } from '@/lib/athena/presentation';

/** The workspace the shell has resolved for the current route. */
export interface PageWorkspace {
  readonly workspaceId: string;
  readonly workspaceName?: string | undefined;
}

/** One publisher's entry in the page-source stack. */
interface PageSourceEntry {
  readonly id: string;
  readonly source: PersonalAthenaSource;
}

interface PageContextValue {
  readonly context: PersonalAthenaContext | null;
  readonly publish: (id: string, source: PersonalAthenaSource) => void;
  readonly retract: (id: string) => void;
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

/** Replace a stack entry in place, or append it if its id is not yet present. */
function upsertEntry(
  entries: readonly PageSourceEntry[],
  id: string,
  source: PersonalAthenaSource,
): readonly PageSourceEntry[] {
  const existing = entries.findIndex((entry) => entry.id === id);
  if (existing < 0) return [...entries, { id, source }];
  return entries.map((entry, index) => (index === existing ? { id, source } : entry));
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
  const [entries, setEntries] = useState<readonly PageSourceEntry[]>([]);
  const publish = useCallback((id: string, source: PersonalAthenaSource): void => {
    setEntries((current) => upsertEntry(current, id, source));
  }, []);
  const retract = useCallback((id: string): void => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
  }, []);
  const activeSource = entries.at(-1)?.source ?? null;
  const workspaceId = workspace?.workspaceId;
  const workspaceName = workspace?.workspaceName;
  const context = useMemo(
    () =>
      buildPageContext(
        workspaceId ? { workspaceId, ...(workspaceName ? { workspaceName } : {}) } : null,
        activeSource,
      ),
    [activeSource, workspaceId, workspaceName],
  );
  const value = useMemo<PageContextValue>(
    () => ({ context, publish, retract }),
    [context, publish, retract],
  );
  return <PageContextContext.Provider value={value}>{children}</PageContextContext.Provider>;
}

/** The merged page context, or null outside a workspace and page. */
export function usePageContext(): PersonalAthenaContext | null {
  return useContext(PageContextContext)?.context ?? null;
}

/**
 * Publish the object this page shows as Athena's source while the page is mounted.
 *
 * Each call site keeps its own slot in the page's source stack, so a drawer opened on top of a
 * page publishes a second entry rather than replacing the page's. The active source is the most
 * recently published entry; closing the drawer retracts only its own entry, restoring whatever
 * was active before it opened.
 *
 * @param source - The object on screen; null publishes nothing.
 */
export function usePublishPageSource(source: PersonalAthenaSource | null): void {
  const id = useId();
  const pageContext = useContext(PageContextContext);
  const publish = pageContext?.publish;
  const retract = pageContext?.retract;
  const type = source?.type;
  const sourceId = source?.id;
  const label = source?.label;

  // Retract this publisher's slot only when the publisher itself unmounts. Kept separate from
  // the effect below so a dependency-only change (a label arriving late) never runs a retract
  // and a publish as two steps — that would remove and re-append the entry, both reordering it
  // behind a later publisher and producing a momentary render with no entry for it at all.
  useEffect(() => {
    return () => {
      retract?.(id);
    };
  }, [id, retract]);

  useEffect(() => {
    if (!publish || !retract) return;
    if (!type || !sourceId) {
      retract(id);
      return;
    }
    publish(id, { type, id: sourceId, ...(label ? { label } : {}) });
  }, [id, label, publish, retract, sourceId, type]);
}

/** Publish a page source from JSX. Renders nothing. */
export function PageSource(source: PersonalAthenaSource): null {
  usePublishPageSource(source);
  return null;
}
