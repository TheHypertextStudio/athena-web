'use client';

import { Button, Select } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { CODE_LANGUAGES, codeLanguage, codeLanguageLabel } from './code-languages';

type CopyState = 'idle' | 'copied' | 'failed';

/** Props for the shared editable and static code-block presentation. */
export interface CodeBlockFrameProps {
  /** Exact source copied by the block action. */
  code: string;
  /** Markdown fence id, including an unknown id that should remain visible. */
  language: string;
  /** Whether the language rail is an authoring control rather than a label. */
  editableLanguage?: boolean;
  /** Persist a language selected by an author. */
  onLanguageChange?: (language: string) => void;
  /** Editable ProseMirror content or static highlighted source. */
  children: ReactNode;
}

/** Render the polished language, copy, and overflow chrome shared by every code block. */
export function CodeBlockFrame({
  code,
  language,
  editableLanguage = false,
  onLanguageChange,
  children,
}: CodeBlockFrameProps): JSX.Element {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const knownLanguage = codeLanguage(language);
  const options = useMemo(
    () =>
      knownLanguage === undefined && language !== ''
        ? [{ id: language, label: language, aliases: [] }, ...CODE_LANGUAGES]
        : CODE_LANGUAGES,
    [knownLanguage, language],
  );

  useEffect(() => {
    if (copyState === 'idle') return;
    const timeout = window.setTimeout(() => {
      setCopyState('idle');
    }, 3000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [copyState]);

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <div
      data-code-block=""
      className="border-outline-variant bg-surface-container-high my-3 overflow-hidden rounded-xl border"
    >
      <div
        contentEditable={false}
        className="border-outline-variant text-on-surface-variant flex min-h-10 items-center justify-between gap-2 border-b px-2"
      >
        {editableLanguage ? (
          <div className="w-40 max-w-[55%]">
            <Select
              aria-label="Code language"
              value={knownLanguage?.id ?? language}
              variant="plain"
              controlSize="xl"
              className="text-label-medium border-0 bg-transparent"
              onChange={(event) => {
                onLanguageChange?.(event.target.value);
              }}
            >
              {options.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <span className="text-label-medium px-2">{codeLanguageLabel(language)}</span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Copy code"
          data-copy-state={copyState}
          className="relative min-h-10 min-w-16"
          onClick={() => {
            void copyCode();
          }}
        >
          <span className={copyState === 'copied' ? '' : 'invisible'}>Copied</span>
          <span className={copyState === 'idle' ? 'absolute' : 'sr-only'}>Copy</span>
          <span className={copyState === 'failed' ? 'absolute' : 'sr-only'}>Retry</span>
        </Button>
      </div>
      <pre className="text-body-small m-0 overflow-x-auto p-4 font-mono">{children}</pre>
      <p aria-live="polite" aria-atomic="true" className="sr-only" contentEditable={false}>
        {copyState === 'copied'
          ? 'Code copied.'
          : copyState === 'failed'
            ? 'Could not copy code. Try again.'
            : ''}
      </p>
    </div>
  );
}
