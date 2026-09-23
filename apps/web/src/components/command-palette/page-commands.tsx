'use client';

/**
 * Commands the page on screen offers through the command palette.
 *
 * @remarks
 * A page publishes its own actions (a task page's "Add blocker", "Add subtask") while it is
 * mounted, and the palette lists them first, under the page's own heading. One page publishes at a
 * time: the most recent publisher wins, and unmounting withdraws its commands. The
 * {@link PageCommandsProvider} sits in the command palette's provider, above both the palette and
 * the page; outside it, publishing does nothing and nothing is read.
 */
import {
  createContext,
  type Dispatch,
  type JSX,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { filterCommands } from './filter';
import {
  type PaletteOpening,
  type PaletteSubject,
  paletteSubjectLabel,
  useSubjectCommands,
} from './subject-commands';
import type { PaletteItem } from './types';

/** What a page publishes: a heading for the palette section, and its commands. */
export interface PageCommands {
  /** The section heading, naming the thing the commands act on (e.g. "This task"). */
  readonly label: string;
  /** The commands; each must use the `page` section. */
  readonly items: readonly PaletteItem[];
}

const NONE: PageCommands = { label: '', items: [] };

const PublishContext = createContext<Dispatch<SetStateAction<PageCommands>>>(() => undefined);
const PageCommandsContext = createContext<PageCommands>(NONE);
const OpeningContext = createContext<PaletteOpening | null>(null);

/** Props for {@link PageCommandsProvider}. */
export interface PageCommandsProviderProps {
  /** The palette's latest opening, which names what the person was focused on. */
  readonly opening?: PaletteOpening | null | undefined;
  /** The subtree holding both the palette and the pages. */
  readonly children: ReactNode;
}

/**
 * Hold the commands the page on screen publishes.
 *
 * @param props - The {@link PageCommandsProviderProps}.
 * @returns the provider.
 */
export function PageCommandsProvider({
  opening = null,
  children,
}: PageCommandsProviderProps): JSX.Element {
  const [commands, setCommands] = useState<PageCommands>(NONE);
  return (
    <PublishContext.Provider value={setCommands}>
      <OpeningContext.Provider value={opening}>
        <PageCommandsContext.Provider value={commands}>{children}</PageCommandsContext.Provider>
      </OpeningContext.Provider>
    </PublishContext.Provider>
  );
}

/**
 * Offer `commands` in the palette while the calling component is mounted.
 *
 * @param commands - The heading and commands; pass a stable (memoized) value.
 */
export function usePublishPageCommands(commands: PageCommands): void {
  const publish = useContext(PublishContext);
  useEffect(() => {
    publish(commands);
    return () => {
      publish((current) => (current === commands ? NONE : current));
    };
  }, [commands, publish]);
}

/**
 * Read the commands the page on screen offers.
 *
 * @returns the published heading and commands; empty when no page publishes any.
 */
export function usePageCommands(): PageCommands {
  return useContext(PageCommandsContext);
}

/**
 * Read the page's commands that match what the palette's box holds.
 *
 * @remarks
 * The page's published commands come first, then the registry actions offered for the palette's
 * subject (the focused list's selection, or the page's own object). A selection names its own
 * heading; the page's object keeps the page's.
 *
 * @param query - The palette's text.
 * @param enabled - Whether the palette lists commands at all (a prefix mode shows its own rows).
 * @returns the heading and the matching commands.
 */
export function usePageCommandMatches(query: string, enabled: boolean): PageCommands {
  const published = usePageCommands();
  const opening = useContext(OpeningContext);
  const subjectCommands = useSubjectCommands(opening, enabled);
  return useMemo(() => {
    const { subject, items: subjectItems } = subjectCommands;
    const fromSelection = subject !== null && !subject.isPage && subjectItems.length > 0;
    const pageItems = fromSelection ? [] : published.items;
    const label = headingFor(published.label, subject, fromSelection);
    return {
      label,
      items: enabled ? filterCommands([...pageItems, ...subjectItems], query) : [],
    };
  }, [enabled, published, query, subjectCommands]);
}

/** The heading for the page section: a selection's own name, else the page's. */
function headingFor(
  publishedLabel: string,
  subject: PaletteSubject | null,
  fromSelection: boolean,
): string {
  if (subject === null) return publishedLabel;
  if (fromSelection || publishedLabel === '') return paletteSubjectLabel(subject);
  return publishedLabel;
}
