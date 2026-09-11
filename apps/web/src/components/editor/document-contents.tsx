'use client';

/**
 * `editor` — the generated table of contents for a live Markdown body.
 *
 * @remarks
 * Extracted from the detail-page document so the create composer can show the same rail beside
 * its body instead of leaving that width blank. Both hosts supply a ref to the element the
 * headings render inside and the Markdown they came from; everything else — tracking which
 * heading is in view, surviving ProseMirror's redraws, the level indent, the compact disclosure
 * for narrow widths — lives here.
 *
 * The class names (`entity-contents`, `entity-contents-desktop`, `entity-contents-mobile`) are
 * stable hooks a page's print stylesheet targets, and the level indent is declared once in
 * `packages/ui/src/styles/globals.css`.
 */
import { ExpandMoreRounded } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, type RefObject, useEffect, useMemo, useRef, useState } from 'react';

import {
  extractMarkdownHeadings,
  type MarkdownHeading,
} from '@/components/initiatives/markdown-toc';

/** Everything a host needs to render a contents rail for one live Markdown body. */
export interface DocumentContents {
  /** The h1-h3 entries parsed from the body, in document order. */
  readonly headings: readonly MarkdownHeading[];
  /** The entry currently in view, or null before the observer has reported one. */
  readonly activeId: string | null;
  /** Scroll the body to a heading by id. Does nothing if that heading is no longer rendered. */
  readonly scrollToHeading: (id: string) => void;
}

/** Options for {@link useDocumentContents}. */
export interface DocumentContentsOptions {
  /**
   * Whether navigating an entry should write the heading's id to the address bar.
   *
   * @remarks
   * True for a document that *is* the page, so a reader can link to a section. False inside a
   * dialog, where the body belongs to an unsaved draft and the page underneath owns the URL.
   */
  readonly reflectHash?: boolean;
}

/**
 * Track a Markdown body's headings and which one the reader is looking at.
 *
 * @param rootRef - The element the body's `h1`/`h2`/`h3` elements render inside.
 * @param markdown - The body's current Markdown source.
 * @param options - The {@link DocumentContentsOptions}.
 * @returns the {@link DocumentContents} for a rail.
 */
export function useDocumentContents(
  rootRef: RefObject<HTMLElement | null>,
  markdown: string,
  options: DocumentContentsOptions = {},
): DocumentContents {
  const { reflectHash = false } = options;
  const headings = useMemo(() => extractMarkdownHeadings(markdown), [markdown]);
  const [activeId, setActiveId] = useState(headings[0]?.id ?? null);

  /**
   * The heading element each contents entry points at, by heading id.
   *
   * @remarks
   * The rail used to navigate by `document.getElementById`, and every entry in it was a dead link.
   * Two reasons, and the second is why an `id` cannot be the mechanism here. The body mounts
   * asynchronously, so the one effect that assigned ids ran against an empty subtree and — keyed on
   * `headings`, which only changes when the saved Markdown does — never ran again. And the
   * headings live inside ProseMirror's managed DOM, which recreates its nodes from the schema and
   * drops foreign attributes with them, so even a correctly timed assignment does not survive the
   * next redraw. Holding the elements themselves sidesteps both.
   *
   * Nothing here writes to those elements. ProseMirror watches its own subtree and redraws nodes it
   * did not change itself, so an `id` written back on every mutation is a loop: write, redraw,
   * observe, write. The rail navigates to the element it is holding, which needs no attribute on
   * the element at all.
   */
  const headingElements = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const root = rootRef.current;
    // Nothing to track until the body has headings, so a composer with a plain description never
    // mounts an observer at all.
    if (!root || headings.length === 0) return;

    let observer: IntersectionObserver | null = null;
    let boundKey = '';

    const bind = (): void => {
      const rendered = [...root.querySelectorAll<HTMLElement>('h1, h2, h3')];
      // Rebuilding the observer on every mutation would tear it down on each keystroke. The set of
      // heading elements is what it watches, so their identity is what gates the work.
      const key = rendered.map((element, index) => `${element.tagName}:${index}`).join('|');
      const rebuild = key !== boundKey;
      boundKey = key;

      headingElements.current = new Map();
      rendered.forEach((element, index) => {
        const heading = headings[index];
        if (heading) headingElements.current.set(heading.id, element);
      });

      if (!rebuild) return;
      observer?.disconnect();
      const idOf = new Map([...headingElements.current].map(([id, element]) => [element, id]));
      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries.find((entry) => entry.isIntersecting);
          const id = visible ? idOf.get(visible.target as HTMLElement) : undefined;
          if (id) setActiveId(id);
        },
        { rootMargin: '-15% 0px -70% 0px' },
      );
      rendered.forEach((element) => {
        observer?.observe(element);
      });
    };

    bind();
    const mutations = new MutationObserver(bind);
    mutations.observe(root, { childList: true, subtree: true, characterData: true });

    return () => {
      mutations.disconnect();
      observer?.disconnect();
    };
  }, [headings, rootRef]);

  const scrollToHeading = (id: string): void => {
    const target = headingElements.current.get(id);
    if (!target) return;
    // `scrollIntoView` honours the scroll container's `scroll-padding-block-start`, which the
    // detail shell sets from the sticky header's measured height — so the heading lands below the
    // header rather than behind it.
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (reflectHash) window.history.replaceState(null, '', `#${id}`);
  };

  return { headings, activeId, scrollToHeading };
}

/** Props for {@link DocumentContentsRail} and {@link DocumentContentsDisclosure}. */
export interface DocumentContentsProps {
  /** The tracked headings from {@link useDocumentContents}. */
  contents: DocumentContents;
}

/** Props for {@link DocumentContentsRail}. */
export interface DocumentContentsRailProps extends DocumentContentsProps {
  /** Whether to print the "Contents" label above the list. */
  showLabel: boolean;
  /**
   * Row size.
   *
   * @remarks
   * `comfortable` gives each entry a 40px coarse-pointer target, for the disclosure a reader taps.
   * `compact` is the side rail: a rail of 40px rows would be taller than the document beside it.
   * An entry still needs a row box either way — at `min-h-0` it was a bare line, so a wrapped
   * label closed to within its own leading of the next entry and the level indent stopped reading
   * as nesting. `text-body-small` owns the leading; the row padding separates one entry from the
   * next.
   */
  density: 'comfortable' | 'compact';
}

/**
 * The list of contents entries.
 *
 * @param props - The {@link DocumentContentsRailProps}.
 * @returns the rendered contents navigation.
 */
export function DocumentContentsRail({
  contents,
  showLabel,
  density,
}: DocumentContentsRailProps): JSX.Element {
  const { headings, activeId, scrollToHeading } = contents;
  return (
    <nav aria-label="Document contents" className="entity-contents print:block">
      {showLabel ? (
        <p className="text-on-surface-variant text-label-medium mb-3">Contents</p>
      ) : null}
      <ol className="space-y-1">
        {headings.map((heading) => (
          // Indent by level through a data attribute rather than an inline `style`, so the step is
          // one declaration in the stylesheet instead of arithmetic at render time.
          <li key={heading.id} data-contents-level={heading.level}>
            <a
              href={`#${heading.id}`}
              onClick={(event) => {
                event.preventDefault();
                scrollToHeading(heading.id);
              }}
              className={cn(
                'text-body-small flex items-center',
                density === 'compact' ? 'py-1' : 'min-h-10',
                activeId === heading.id
                  ? 'text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The compact disclosure the rail collapses into below the two-column breakpoint.
 *
 * @param props - The {@link DocumentContentsProps}.
 * @returns the rendered disclosure.
 */
export function DocumentContentsDisclosure({ contents }: DocumentContentsProps): JSX.Element {
  return (
    <details className="entity-contents-mobile bg-surface-container-low group mb-6 w-fit max-w-full min-w-56 rounded-xl @4xl:hidden">
      <summary className="text-on-surface text-label-large flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 [&::-webkit-details-marker]:hidden">
        <span>Contents</span>
        <ExpandMoreRounded
          aria-hidden
          className="size-4 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="px-3 pb-2">
        <DocumentContentsRail contents={contents} showLabel={false} density="comfortable" />
      </div>
    </details>
  );
}
