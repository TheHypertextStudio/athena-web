'use client';

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

  const contents =
    headings.length >= 2 ? (
      <nav aria-label="Document contents" className="initiative-contents print:block">
        <p className="text-on-surface-variant mb-2 text-xs font-medium">Contents</p>
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
                    ? 'text-on-surface flex min-h-10 items-center text-xs font-medium @4xl:min-h-0'
                    : 'text-on-surface-variant hover:text-on-surface flex min-h-10 items-center text-xs @4xl:min-h-0'
                }
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    ) : null;

  return (
    <div className="grid min-w-0 gap-6 @4xl:grid-cols-[9rem_minmax(0,1fr)]">
      {contents ? (
        <div className="initiative-contents-desktop hidden @4xl:block">{contents}</div>
      ) : null}
      <div className="min-w-0">
        {contents ? (
          <details className="initiative-contents-mobile border-outline-variant mb-5 border-y @4xl:hidden">
            <summary className="text-on-surface flex min-h-10 items-center text-sm font-medium">
              Contents
            </summary>
            <div className="pb-2">{contents}</div>
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
