'use client';

/**
 * `editor` — a document-style body for any entity: a quiet Markdown editor with a responsive,
 * auto-generated table of contents.
 *
 * @remarks
 * Generalized from the initiative-only document so Initiatives, Programs, and any future
 * document-first surface share one component instead of each cloning the editor + contents logic.
 * Nothing here is entity-specific: the caller supplies the value, edit permission, save handler,
 * and placeholder. The contents rail appears only once the body has two or more headings. Its
 * class names (`entity-document`, `entity-contents*`) are stable hooks a page's print stylesheet
 * can target.
 */
import { ExpandMoreRounded } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useEffect, useMemo, useRef, useState } from 'react';

import { EditableFreeformText } from '@/components/editor/freeform-text';
import { extractMarkdownHeadings } from '@/components/initiatives/markdown-toc';

import type { EditorContribution } from './editor-contribution';

/** Props for {@link EntityDocument}. */
export interface EntityDocumentProps {
  /** The Markdown body, or null/undefined when none has been written yet. */
  value: string | null | undefined;
  /** Whether the viewer may edit the body. */
  canEdit: boolean;
  /** Persist a non-empty Markdown value, or null to clear the body. */
  onSave: (value: string | null) => void;
  /** Notify the host when the reader activates the editable document. */
  onEditStart?: () => void;
  /** The quiet prompt shown before anything is written. */
  placeholder?: string;
  /**
   * Whether to generate a table of contents from the body's headings. Defaults to true.
   *
   * @remarks
   * Off for bodies that are short by nature. A contents rail beside two headings is navigation for
   * a distance nobody has to travel, and it costs a column of the measure to say so.
   */
  contents?: boolean;
  /** Feature behavior delegated to the editor without adding document-layout chrome. */
  contributions?: readonly EditorContribution[];
}

/** A document-style entity body with a responsive generated table of contents. */
export function EntityDocument({
  value,
  canEdit,
  onSave,
  onEditStart,
  placeholder = 'Add a description',
  contents = true,
  contributions = [],
}: EntityDocumentProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const headings = useMemo(() => extractMarkdownHeadings(value ?? ''), [value]);
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
    if (!root) return;

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
  }, [headings]);

  const hasContents = contents && headings.length >= 2;
  const renderContents = (showLabel: boolean): JSX.Element => (
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
                const target = headingElements.current.get(heading.id);
                if (!target) return;
                // `scrollIntoView` honours the scroll container's `scroll-padding-block-start`,
                // which the detail shell sets from the sticky header's measured height — so the
                // heading lands below the header rather than behind it.
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                window.history.replaceState(null, '', `#${heading.id}`);
              }}
              className={
                // `min-h-10` is the coarse-pointer target for the mobile disclosure. The desktop
                // rail drops it — a rail of 40px rows would be taller than the document beside it —
                // but it still needs a row box: at `min-h-0` an entry was a bare line, so a wrapped
                // label closed to within its own leading of the next entry and the level indent
                // stopped reading as nesting. `text-body-small` owns the leading; the row padding
                // is what separates one entry from the next.
                `text-body-small flex min-h-10 items-center @4xl:min-h-0 @4xl:py-1 ${
                  activeId === heading.id
                    ? 'text-on-surface'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`
              }
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );

  return (
    // `flex-1 flex flex-col` on this chain down to the visible box below is a no-op unless a
    // caller's own wrapper happens to be a flex column with real spare height to give up (e.g. a
    // tab where this document is the whole page, so its section carries `min-h-full`) — nothing
    // here needs to know that context exists. A host with more content stacked below the body
    // (a project's milestones, an initiative's updates) never has spare height to distribute in
    // the first place, so this is inert for them: the body still sizes to its own text.
    <div
      className={cn(
        'grid min-w-0 flex-1 gap-4',
        hasContents && '@4xl:grid-cols-[minmax(0,calc(75ch+2rem))_11rem]',
      )}
    >
      {/*
       * The body is the first (left) column, so its edge stays flush with the masthead and the
       * sibling sections — the contents live in their own column to the *right*, never indenting
       * the body. Below @4xl the rail collapses into a compact disclosure above the body.
       */}
      <div className="flex min-w-0 flex-col">
        {hasContents ? (
          <details className="entity-contents-mobile bg-surface-container-low group mb-6 w-fit max-w-full min-w-56 rounded-xl @4xl:hidden">
            <summary className="text-on-surface text-label-large flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 [&::-webkit-details-marker]:hidden">
              <span>Contents</span>
              <ExpandMoreRounded
                aria-hidden
                className="size-4 transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="px-3 pb-2">{renderContents(false)}</div>
          </details>
        ) : null}
        <div
          ref={rootRef}
          className="entity-document bg-surface-container-low flex min-h-56 w-full max-w-[calc(75ch+2rem)] flex-1 flex-col rounded-xl p-4 sm:min-w-[32rem] print:bg-transparent print:p-0"
        >
          <EditableFreeformText
            value={value}
            placeholder={placeholder}
            canEdit={canEdit}
            onSave={onSave}
            {...(onEditStart ? { onEditStart } : {})}
            className="flex min-h-0 max-w-[75ch] flex-1 flex-col"
            contributions={contributions}
          />
        </div>
      </div>
      {hasContents ? (
        <div className="entity-contents-desktop hidden @4xl:block">
          {/* `--detail-header-height` is published by the detail shell's collapse hook. The rail
              and the masthead pin to the same scrollport, and the masthead is opaque and `z-10`;
              a bare `top-4` parked this list 16px into the page and therefore underneath the tab
              bar. Offsetting by the measured header keeps it clear in every collapse state, and
              the fallback leaves it at `top-4` on surfaces that publish nothing. */}
          <div className="sticky top-[calc(var(--detail-header-height,0px)+1rem)] self-start py-4">
            {renderContents(true)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
