'use client';

import { ExpandMoreRounded } from '@docket/ui/icons';
import { type JSX, useEffect, useMemo, useRef, useState } from 'react';

import { EditableFreeformText } from '@/components/editor/freeform-text';
import { extractMarkdownHeadings } from './markdown-toc';

/** Document-style Initiative body with responsive generated contents. */
export function InitiativeDocument({
  value,
  canEdit,
  saving,
  onSave,
  placeholder = 'Add the Initiative brief…',
}: {
  value: string | null | undefined;
  canEdit: boolean;
  saving: boolean;
  onSave: (value: string | null) => void;
  placeholder?: string;
}): JSX.Element {
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
    <nav aria-label="Document contents" className="initiative-contents print:block">
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
      className={`grid min-w-0 gap-6 ${hasContents ? '@4xl:grid-cols-[9rem_minmax(0,1fr)]' : ''}`}
    >
      {hasContents ? (
        <div className="initiative-contents-desktop hidden @4xl:block">{renderContents(true)}</div>
      ) : null}
      <div className="min-w-0">
        {hasContents ? (
          <details className="initiative-contents-mobile bg-surface-container-low group mb-5 rounded-xl @4xl:hidden">
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
        <div ref={rootRef} className="initiative-document min-h-56">
          <EditableFreeformText
            value={value}
            placeholder={placeholder}
            canEdit={canEdit}
            saving={saving}
            onSave={onSave}
            className="max-w-none"
          />
        </div>
      </div>
    </div>
  );
}
