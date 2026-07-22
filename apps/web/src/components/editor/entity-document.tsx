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
import { type JSX, useEffect, useMemo, useRef, useState } from 'react';

import { EditableFreeformText } from '@/components/editor/freeform-text';
import { extractMarkdownHeadings } from '@/components/initiatives/markdown-toc';

/** Props for {@link EntityDocument}. */
export interface EntityDocumentProps {
  /** The Markdown body, or null/undefined when none has been written yet. */
  value: string | null | undefined;
  /** Whether the viewer may edit the body. */
  canEdit: boolean;
  /** Persist a non-empty Markdown value, or null to clear the body. */
  onSave: (value: string | null) => void;
  /** The quiet prompt shown before anything is written. */
  placeholder?: string;
}

/** A document-style entity body with a responsive generated table of contents. */
export function EntityDocument({
  value,
  canEdit,
  onSave,
  placeholder = 'Add a description…',
}: EntityDocumentProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const headings = useMemo(() => extractMarkdownHeadings(value ?? ''), [value]);
  const [activeId, setActiveId] = useState(headings[0]?.id ?? null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const rendered = [...root.querySelectorAll<HTMLElement>('h1, h2, h3')];
    rendered.forEach((element, index) => {
      const heading = headings[index];
      if (heading) {
        element.id = heading.id;
        element.tabIndex = -1;
      }
    });
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible?.target.id) setActiveId(visible.target.id);
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    rendered.forEach((element) => {
      observer.observe(element);
    });
    return () => {
      observer.disconnect();
    };
  }, [headings]);

  const hasContents = headings.length >= 2;
  const renderContents = (showLabel: boolean): JSX.Element => (
    <nav aria-label="Document contents" className="entity-contents print:block">
      {showLabel ? (
        <p className="text-on-surface-variant text-label-medium mb-2">Contents</p>
      ) : null}
      <ol className="space-y-1">
        {headings.map((heading) => (
          <li key={heading.id} style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}>
            <a
              href={`#${heading.id}`}
              onClick={(event) => {
                event.preventDefault();
                const target = document.getElementById(heading.id);
                if (!target) return;
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                target.focus({ preventScroll: true });
                window.history.replaceState(null, '', `#${heading.id}`);
              }}
              className={
                activeId === heading.id
                  ? 'text-on-surface text-label-medium flex min-h-10 items-center @4xl:min-h-0'
                  : 'text-on-surface-variant hover:text-on-surface text-label-medium flex min-h-10 items-center @4xl:min-h-0'
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
    <div
      className={`grid min-w-0 gap-8 ${hasContents ? '@4xl:grid-cols-[minmax(0,1fr)_11rem]' : ''}`}
    >
      {/*
       * The body is the first (left) column, so its edge stays flush with the masthead and the
       * sibling sections — the contents live in their own column to the *right*, never indenting
       * the body. Below @4xl the rail collapses into a compact disclosure above the body.
       */}
      <div className="min-w-0">
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
          className="entity-document bg-surface-container-low min-h-56 rounded-xl px-4 py-3 print:bg-transparent print:p-0"
        >
          <EditableFreeformText
            value={value}
            placeholder={placeholder}
            canEdit={canEdit}
            onSave={onSave}
            className="max-w-none"
          />
        </div>
      </div>
      {hasContents ? (
        <div className="entity-contents-desktop hidden @4xl:block">
          <div className="sticky top-4 self-start">{renderContents(true)}</div>
        </div>
      ) : null}
    </div>
  );
}
