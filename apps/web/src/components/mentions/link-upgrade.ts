'use client';

/**
 * Offer to turn a link somebody just pasted into a chip.
 *
 * @remarks
 * A URL the author typed keeps their own text, because rewriting what someone wrote is worse than
 * leaving it plain. But a pasted link is almost always meant as a reference, so for a moment
 * afterwards `Tab` converts it into a chip carrying the resolved title — the same affordance Google
 * Docs offers.
 *
 * Keyboard semantics are the delicate part. `Tab` normally moves focus, and stealing it would trap
 * a keyboard-only user in the editor. Three rules keep that from happening: the binding exists only
 * while the affordance is visible, it is announced politely when it appears so a screen-reader user
 * knows it is there, and *any* other key dismisses it — including Escape, and including simply
 * typing on. A user who wants to leave presses Escape then Tab, or just types.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** The range a freshly pasted link occupies, while the offer stands. */
export interface PendingLinkUpgrade {
  readonly from: number;
  readonly to: number;
  readonly href: string;
}

/** Plugin state: at most one outstanding offer. */
interface LinkUpgradeState {
  readonly pending: PendingLinkUpgrade | undefined;
}

/** How the extension reports and applies an upgrade. */
export interface LinkUpgradeOptions {
  /**
   * Convert the pending link into a chip.
   *
   * @returns True when the conversion happened; false leaves the link alone and dismisses.
   */
  readonly onUpgrade: (pending: PendingLinkUpgrade) => boolean;
  /** Called when the offer appears or disappears, so the host can announce it. */
  readonly onPendingChange: (pending: PendingLinkUpgrade | undefined) => void;
}

/** Plugin key, exported so a host can read the pending offer if it needs to. */
export const linkUpgradeKey = new PluginKey<LinkUpgradeState>('docket-link-upgrade');

/** The transaction meta this plugin reads. */
const SET_PENDING = 'docket-link-upgrade-set';

/** Find the link mark range covering a position, if any. */
function linkRangeAt(doc: ProseMirrorNode, pos: number): PendingLinkUpgrade | undefined {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const child = parent.maybeChild(index === parent.childCount ? index - 1 : index);
  if (!child) return undefined;
  const mark = child.marks.find((candidate) => candidate.type.name === 'link');
  if (!mark) return undefined;

  const start = $pos.start();
  let from = start;
  let to = start;
  let cursor = start;
  parent.forEach((node, offset) => {
    const nodeFrom = start + offset;
    if (node.marks.some((candidate) => candidate.eq(mark))) {
      if (cursor === start || nodeFrom < from) from = nodeFrom;
      to = nodeFrom + node.nodeSize;
      cursor = nodeFrom;
    }
  });
  const href = String(mark.attrs['href'] ?? '');
  return href === '' ? undefined : { from, to, href };
}

/**
 * Build the link-upgrade extension.
 *
 * @param options - How to apply an upgrade, and how to announce the offer.
 * @returns The configured extension.
 */
export function createLinkUpgradeExtension(options: LinkUpgradeOptions) {
  return Extension.create({
    name: 'linkUpgrade',

    addProseMirrorPlugins() {
      return [
        new Plugin<LinkUpgradeState>({
          key: linkUpgradeKey,

          state: {
            init: () => ({ pending: undefined }),
            apply(tr, value) {
              const meta = tr.getMeta(SET_PENDING) as PendingLinkUpgrade | undefined | null;
              if (meta !== undefined) return { pending: meta ?? undefined };
              // Any document change that is not the paste itself retires the offer, so it never
              // lingers over text the author has since moved on from.
              if (tr.docChanged) return { pending: undefined };
              return value;
            },
          },

          props: {
            decorations(state) {
              const pending = linkUpgradeKey.getState(state)?.pending;
              if (pending === undefined) return DecorationSet.empty;
              return DecorationSet.create(state.doc, [
                Decoration.widget(pending.to, () => {
                  const hint = document.createElement('span');
                  hint.className =
                    'text-on-surface-variant bg-surface-container-high ml-1 rounded px-1 py-px align-baseline text-[0.7em] select-none';
                  hint.setAttribute('contenteditable', 'false');
                  // Decoration, not content: a screen reader hears the polite announcement the
                  // host makes instead, which reads as a sentence rather than as stray text.
                  hint.setAttribute('aria-hidden', 'true');
                  hint.textContent = 'Tab to link';
                  return hint;
                }),
              ]);
            },

            handleKeyDown(view, event) {
              const pending = linkUpgradeKey.getState(view.state)?.pending;
              if (pending === undefined) return false;

              if (event.key === 'Tab' && !event.shiftKey) {
                event.preventDefault();
                const upgraded = options.onUpgrade(pending);
                view.dispatch(view.state.tr.setMeta(SET_PENDING, null));
                options.onPendingChange(undefined);
                return upgraded;
              }

              // Everything else retires the offer and is otherwise left alone, so Escape, Tab-out
              // after a dismiss, and ordinary typing all behave the way they normally would.
              if (event.key !== 'Shift' && event.key !== 'Meta' && event.key !== 'Control') {
                view.dispatch(view.state.tr.setMeta(SET_PENDING, null));
                options.onPendingChange(undefined);
              }
              return false;
            },

            handlePaste(view) {
              // The mark is applied by the Link extension's own paste handling, so the range is
              // only knowable on the next tick.
              setTimeout(() => {
                const pending = linkRangeAt(view.state.doc, view.state.selection.from);
                if (pending === undefined) return;
                view.dispatch(view.state.tr.setMeta(SET_PENDING, pending));
                options.onPendingChange(pending);
              }, 0);
              return false;
            },
          },
        }),
      ];
    },
  });
}
