import type { LanguageFn } from 'highlight.js';
import { createLowlight } from 'lowlight';

import { CODE_LANGUAGES, codeLanguage, type CodeGrammar } from './code-languages';

/** A dynamic Highlight.js grammar module. */
export interface CodeGrammarModule {
  readonly default: LanguageFn;
}

/** A request for one grammar chunk. */
export type CodeGrammarImporter = () => Promise<CodeGrammarModule>;

type Lowlight = ReturnType<typeof createLowlight>;

/** The small surface the loader needs from Lowlight, separated so its behavior is testable. */
export interface CodeHighlighter {
  readonly highlight: (language: string, value: string) => ReturnType<Lowlight['highlight']>;
  readonly register: (name: string, grammar: LanguageFn) => void;
  readonly registerAlias: (language: string, aliases: readonly string[] | string) => void;
  readonly registered: (name: string) => boolean;
}

/** Observable state for one known grammar. */
export type CodeLanguageLoadState = 'idle' | 'loading' | 'ready' | 'unavailable';

/** The language-loading service consumed by the ProseMirror decoration plugin. */
export interface CodeLanguageLoader {
  /** Start loading a known language, or resolve safely when it should remain plain. */
  ensure: (language: string | null | undefined) => Promise<CodeLanguageLoadState>;
  /** Read current loading state without starting work. */
  status: (language: string | null | undefined) => CodeLanguageLoadState;
  /** Highlight only after the matching grammar is ready. */
  highlight: (
    language: string | null | undefined,
    value: string,
  ) => ReturnType<Lowlight['highlight']> | undefined;
  /** Observe completed or failed chunks so editor decorations can refresh. */
  subscribe: (listener: () => void) => () => void;
}

/** Dependencies for an isolated language loader. */
export interface CodeLanguageLoaderOptions {
  readonly highlighter: CodeHighlighter;
  readonly importers: Partial<Record<CodeGrammar, CodeGrammarImporter>>;
}

const productionImporters: Record<CodeGrammar, CodeGrammarImporter> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  css: () => import('highlight.js/lib/languages/css'),
  diff: () => import('highlight.js/lib/languages/diff'),
  xml: () => import('highlight.js/lib/languages/xml'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  python: () => import('highlight.js/lib/languages/python'),
  sql: () => import('highlight.js/lib/languages/sql'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
};

/**
 * Create a per-application lazy grammar loader.
 *
 * @remarks
 * Requests and state are keyed by grammar rather than fence id, so aliases such as `js` and
 * `jsx` share one network request. Failures settle as unavailable and intentionally leave the
 * source readable without highlighting.
 */
export function createCodeLanguageLoader({
  highlighter,
  importers,
}: CodeLanguageLoaderOptions): CodeLanguageLoader {
  const states = new Map<CodeGrammar, CodeLanguageLoadState>();
  const pending = new Map<CodeGrammar, Promise<CodeLanguageLoadState>>();
  const listeners = new Set<() => void>();
  const highlightCache = new Map<string, ReturnType<Lowlight['highlight']>>();
  const MAX_HIGHLIGHT_CACHE_ENTRIES = 64;

  function grammarFor(language: string | null | undefined): CodeGrammar | undefined {
    return codeLanguage(language)?.grammar;
  }

  function notify(): void {
    listeners.forEach((listener) => {
      listener();
    });
  }

  function status(language: string | null | undefined): CodeLanguageLoadState {
    const grammar = grammarFor(language);
    return grammar === undefined ? 'unavailable' : (states.get(grammar) ?? 'idle');
  }

  function ensure(language: string | null | undefined): Promise<CodeLanguageLoadState> {
    const grammar = grammarFor(language);
    if (grammar === undefined) return Promise.resolve('unavailable');

    const current = states.get(grammar);
    if (current === 'ready' || current === 'unavailable') return Promise.resolve(current);
    const existing = pending.get(grammar);
    if (existing) return existing;

    const importer = importers[grammar];
    if (!importer) {
      states.set(grammar, 'unavailable');
      return Promise.resolve('unavailable');
    }

    states.set(grammar, 'loading');
    const request = importer()
      .then((module) => {
        if (!highlighter.registered(grammar)) highlighter.register(grammar, module.default);
        const aliases = CODE_LANGUAGES.filter((entry) => entry.grammar === grammar)
          .flatMap((entry) => [entry.id, ...entry.aliases])
          .filter((alias) => alias !== grammar);
        if (aliases.length > 0) highlighter.registerAlias(grammar, aliases);
        states.set(grammar, 'ready');
        return 'ready' as const;
      })
      .catch(() => {
        states.set(grammar, 'unavailable');
        return 'unavailable' as const;
      })
      .finally(() => {
        pending.delete(grammar);
        notify();
      });
    pending.set(grammar, request);
    return request;
  }

  return {
    ensure,
    status,
    highlight(language, value) {
      const grammar = grammarFor(language);
      if (grammar === undefined || states.get(grammar) !== 'ready') return undefined;
      const cacheKey = `${grammar}\u0000${value}`;
      const cached = highlightCache.get(cacheKey);
      if (cached) {
        // Refresh insertion order so frequently reused blocks survive the small LRU bound.
        highlightCache.delete(cacheKey);
        highlightCache.set(cacheKey, cached);
        return cached;
      }
      try {
        const highlighted = highlighter.highlight(grammar, value);
        highlightCache.set(cacheKey, highlighted);
        if (highlightCache.size > MAX_HIGHLIGHT_CACHE_ENTRIES) {
          const oldest = highlightCache.keys().next().value;
          if (oldest !== undefined) highlightCache.delete(oldest);
        }
        return highlighted;
      } catch {
        return undefined;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The shared browser loader: initially empty, then populated one requested grammar at a time. */
export const codeLanguageLoader = createCodeLanguageLoader({
  highlighter: createLowlight(),
  importers: productionImporters,
});
