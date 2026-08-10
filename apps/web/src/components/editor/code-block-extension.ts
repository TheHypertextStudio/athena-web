import { findChildren, textblockTypeInputRule, type NodeViewRenderer } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { codeLanguageLoader, type CodeLanguageLoader } from './code-language-loader';

/** The fence that becomes a block as soon as its third backtick is typed. */
export const immediateCodeBlockInputRegex = /^```$/;

interface CodeHighlightState {
  readonly decorations: DecorationSet;
}

interface ChangedRange {
  readonly from: number;
  readonly to: number;
}

interface CodeBlockRange {
  readonly from: number;
  readonly to: number;
}

const codeHighlightKey = new PluginKey<CodeHighlightState>('docket-code-highlight');
const REFRESH_HIGHLIGHTING = 'docket-code-highlight-refresh';
type HighlightTree = NonNullable<ReturnType<CodeLanguageLoader['highlight']>>;
type HighlightContent = HighlightTree['children'][number];

/** Choose a Markdown fence that cannot collide with a backtick run inside the source. */
export function codeBlockFence(source: string): string {
  const longestRun = [...source.matchAll(/`+/g)].reduce(
    (longest, match) => Math.max(longest, match[0].length),
    0,
  );
  return '`'.repeat(Math.max(3, longestRun + 1));
}

/** Turn Lowlight's nested HAST tree into inline ProseMirror syntax decorations. */
function syntaxDecorations(
  children: readonly HighlightContent[],
  start: number,
  inheritedClasses: readonly string[] = [],
): readonly Decoration[] {
  const decorations: Decoration[] = [];
  let offset = 0;

  for (const child of children) {
    if (child.type === 'text') {
      const end = offset + child.value.length;
      if (child.value.length > 0 && inheritedClasses.length > 0) {
        decorations.push(
          Decoration.inline(start + offset, start + end, {
            class: inheritedClasses.join(' '),
          }),
        );
      }
      offset = end;
      continue;
    }

    if (child.type === 'element') {
      const ownClasses = child.properties.className;
      const classes = [
        ...inheritedClasses,
        ...(Array.isArray(ownClasses)
          ? ownClasses.filter((value): value is string => typeof value === 'string')
          : []),
      ];
      decorations.push(...syntaxDecorations(child.children, start + offset, classes));
      offset += child.children.reduce((length, descendant) => {
        if (descendant.type === 'text') return length + descendant.value.length;
        if (descendant.type === 'element')
          return length + descendantTextLength(descendant.children);
        return length;
      }, 0);
    }
  }

  return decorations;
}

/** Count text in a HAST branch so following token offsets stay aligned with the document. */
function descendantTextLength(children: readonly HighlightContent[]): number {
  return children.reduce((length, child) => {
    if (child.type === 'text') return length + child.value.length;
    if (child.type === 'element') return length + descendantTextLength(child.children);
    return length;
  }, 0);
}

/** Compute highlighting from already-loaded grammars without changing document content or history. */
function highlightedDocument(doc: ProseMirrorNode, loader: CodeLanguageLoader): DecorationSet {
  const decorations: Decoration[] = [];
  for (const { node, pos } of findChildren(
    doc,
    (candidate) => candidate.type.name === 'codeBlock',
  )) {
    const language = typeof node.attrs['language'] === 'string' ? node.attrs['language'] : '';
    const tree = loader.highlight(language, node.textContent);
    if (tree) decorations.push(...syntaxDecorations(tree.children, pos + 1));
  }
  return DecorationSet.create(doc, decorations);
}

/** Read code-block boundaries without visiting their inline syntax tokens. */
function codeBlockRanges(doc: ProseMirrorNode): readonly CodeBlockRange[] {
  return findChildren(doc, (candidate) => candidate.type.name === 'codeBlock').map(
    ({ node, pos }) => ({ from: pos, to: pos + node.nodeSize }),
  );
}

/** Detect code-block creation, removal, or conversion while allowing mapped text-size changes. */
function changesCodeBlockStructure(transaction: Transaction): boolean {
  const previous = codeBlockRanges(transaction.before);
  const next = codeBlockRanges(transaction.doc);
  if (previous.length !== next.length) return true;

  return previous.some((range, index) => {
    // Keep insertions exactly outside a block outside its mapped boundary: content inserted at the
    // opening edge belongs before the node, while a trailing paragraph inserted at the closing
    // edge belongs after it. Edits inside either boundary still expand or contract the range.
    const mappedFrom = transaction.mapping.map(range.from, 1);
    const mappedTo = transaction.mapping.map(range.to, -1);
    const nextRange = next[index];
    return nextRange?.from !== mappedFrom || nextRange.to !== mappedTo;
  });
}

/** Map step-local replacement ranges into the transaction's final document coordinates. */
function changedRanges(transaction: Transaction): readonly ChangedRange[] {
  const ranges: ChangedRange[] = [];
  transaction.mapping.maps.forEach((stepMap, index) => {
    const remaining = transaction.mapping.slice(index + 1);
    stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = remaining.map(newStart, -1);
      const to = remaining.map(newEnd, 1);
      ranges.push({ from: Math.min(from, to), to: Math.max(from, to) });
    });
  });
  return ranges;
}

/** Rebuild syntax only for code blocks touched by a document-changing transaction. */
function updateChangedCodeBlocks(
  transaction: Transaction,
  current: DecorationSet,
  loader: CodeLanguageLoader,
): DecorationSet {
  let decorations = current.map(transaction.mapping, transaction.doc);
  const ranges = changedRanges(transaction);
  if (ranges.length === 0) return decorations;

  for (const { node, pos } of findChildren(
    transaction.doc,
    (candidate) => candidate.type.name === 'codeBlock',
  )) {
    const end = pos + node.nodeSize;
    if (!ranges.some((range) => range.from < end && range.to > pos)) continue;

    decorations = decorations.remove(decorations.find(pos, end));
    const language = typeof node.attrs['language'] === 'string' ? node.attrs['language'] : '';
    const tree = loader.highlight(language, node.textContent);
    if (tree)
      decorations = decorations.add(transaction.doc, [
        ...syntaxDecorations(tree.children, pos + 1),
      ]);
  }
  return decorations;
}

/** Request only the distinct known languages that actually occur in the current document. */
function requestDocumentLanguages(doc: ProseMirrorNode, loader: CodeLanguageLoader): void {
  const languages = new Set<string>();
  for (const { node } of findChildren(doc, (candidate) => candidate.type.name === 'codeBlock')) {
    const language = typeof node.attrs['language'] === 'string' ? node.attrs['language'] : '';
    languages.add(language);
  }
  languages.forEach((language) => {
    void loader.ensure(language);
  });
}

/**
 * Create Docket's code-block node while retaining Tiptap's Markdown and keyboard contracts.
 *
 * @param nodeView - The React renderer that owns the block's quiet language/copy rail.
 * @returns A configured Tiptap code-block extension.
 */
export function createCodeBlockExtension(
  nodeView: NodeViewRenderer,
  loader: CodeLanguageLoader = codeLanguageLoader,
) {
  return CodeBlock.extend({
    renderMarkdown(node, helpers) {
      const language = typeof node.attrs?.['language'] === 'string' ? node.attrs['language'] : '';
      const source = node.content ? helpers.renderChildren(node.content) : '';
      const fence = codeBlockFence(source);
      return `${fence}${language}\n${source}\n${fence}`;
    },
    addNodeView() {
      return nodeView;
    },
    addInputRules() {
      return [
        textblockTypeInputRule({ find: immediateCodeBlockInputRegex, type: this.type }),
        ...(this.parent?.() ?? []),
      ];
    },
    addProseMirrorPlugins() {
      return [
        ...(this.parent?.() ?? []),
        new Plugin<CodeHighlightState>({
          key: codeHighlightKey,
          state: {
            init: (_, state) => ({ decorations: highlightedDocument(state.doc, loader) }),
            apply(transaction, current) {
              if (transaction.getMeta(REFRESH_HIGHLIGHTING)) {
                return { decorations: highlightedDocument(transaction.doc, loader) };
              }
              if (transaction.docChanged) {
                if (changesCodeBlockStructure(transaction)) {
                  return { decorations: highlightedDocument(transaction.doc, loader) };
                }
                return {
                  decorations: updateChangedCodeBlocks(transaction, current.decorations, loader),
                };
              }
              return {
                decorations: current.decorations.map(transaction.mapping, transaction.doc),
              };
            },
          },
          props: {
            decorations: (state) =>
              codeHighlightKey.getState(state)?.decorations ?? DecorationSet.empty,
          },
          view(view) {
            let destroyed = false;
            const unsubscribe = loader.subscribe(() => {
              if (!destroyed) view.dispatch(view.state.tr.setMeta(REFRESH_HIGHLIGHTING, true));
            });
            requestDocumentLanguages(view.state.doc, loader);
            return {
              update(nextView, previousState) {
                if (!nextView.state.doc.eq(previousState.doc)) {
                  requestDocumentLanguages(nextView.state.doc, loader);
                }
              },
              destroy() {
                destroyed = true;
                unsubscribe();
              },
            };
          },
        }),
      ];
    },
  });
}
