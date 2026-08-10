import type { LanguageFn } from 'highlight.js';
import { describe, expect, it, vi } from 'vitest';

import {
  createCodeLanguageLoader,
  type CodeGrammarImporter,
  type CodeHighlighter,
} from '@/components/editor/code-language-loader';

const grammar = (() => ({ contains: [] })) as unknown as LanguageFn;

function testHighlighter(): CodeHighlighter {
  return {
    highlight: vi.fn(() => ({ type: 'root' as const, children: [] })),
    register: vi.fn(() => undefined),
    registerAlias: vi.fn(() => undefined),
    registered: vi.fn(() => false),
  };
}

describe('code language loader', () => {
  it('does not request a grammar for plain text or an unknown fence', async () => {
    const importer: CodeGrammarImporter = vi.fn(async () => ({ default: grammar }));
    const loader = createCodeLanguageLoader({
      highlighter: testHighlighter(),
      importers: { javascript: importer },
    });

    await expect(loader.ensure('')).resolves.toBe('unavailable');
    await expect(loader.ensure('cobol')).resolves.toBe('unavailable');
    expect(importer).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent aliases that share a grammar', async () => {
    let resolveImport: ((module: { default: LanguageFn }) => void) | undefined;
    const importer: CodeGrammarImporter = vi.fn(
      () =>
        new Promise<{ default: LanguageFn }>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const highlighter = testHighlighter();
    const loader = createCodeLanguageLoader({
      highlighter,
      importers: { javascript: importer },
    });

    const javascript = loader.ensure('javascript');
    const jsx = loader.ensure('jsx');
    expect(loader.status('js')).toBe('loading');
    expect(importer).toHaveBeenCalledTimes(1);

    resolveImport?.({ default: grammar });
    await expect(Promise.all([javascript, jsx])).resolves.toEqual(['ready', 'ready']);
    expect(highlighter.register).toHaveBeenCalledTimes(1);
    expect(loader.status('jsx')).toBe('ready');
  });

  it('contains a failed grammar without retry loops or editor errors', async () => {
    const importer = vi.fn(async () => {
      throw new Error('chunk unavailable');
    });
    const loader = createCodeLanguageLoader({
      highlighter: testHighlighter(),
      importers: { python: importer },
    });

    await expect(loader.ensure('python')).resolves.toBe('unavailable');
    await expect(loader.ensure('py')).resolves.toBe('unavailable');
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('keeps a malformed highlighter result from breaking the document', async () => {
    const highlighter = testHighlighter();
    vi.mocked(highlighter.highlight).mockImplementation(() => {
      throw new Error('malformed grammar');
    });
    const loader = createCodeLanguageLoader({
      highlighter,
      importers: { typescript: vi.fn(async () => ({ default: grammar })) },
    });

    await expect(loader.ensure('typescript')).resolves.toBe('ready');
    expect(loader.highlight('typescript', 'const ready = true')).toBeUndefined();
  });

  it('reuses highlighted output for unchanged code and bounds ordinary transaction work', async () => {
    const highlighter = testHighlighter();
    const loader = createCodeLanguageLoader({
      highlighter,
      importers: { typescript: vi.fn(async () => ({ default: grammar })) },
    });

    await loader.ensure('typescript');
    const first = loader.highlight('typescript', 'const ready = true');
    const second = loader.highlight('ts', 'const ready = true');

    expect(second).toBe(first);
    expect(highlighter.highlight).toHaveBeenCalledTimes(1);
  });

  it('stops notifying a subscriber after cleanup', async () => {
    const listener = vi.fn();
    const loader = createCodeLanguageLoader({
      highlighter: testHighlighter(),
      importers: {
        javascript: vi.fn(async () => ({ default: grammar })),
        python: vi.fn(async () => ({ default: grammar })),
      },
    });
    const unsubscribe = loader.subscribe(listener);

    await loader.ensure('javascript');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await loader.ensure('python');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
