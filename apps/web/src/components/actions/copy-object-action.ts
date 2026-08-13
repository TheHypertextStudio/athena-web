'use client';

/**
 * `components/actions/copy-object-action` — the Copy action, defined once for every kind.
 *
 * @remarks
 * Six domains need an identical Copy item, and six hand-written copies of it is how a menu ends up
 * saying "Copy task" in one place and "Copy" in another, or how one kind quietly loses multi-select
 * support. So the definition is built here from the kind's own descriptor: the label pluralizes
 * itself, the icon is the shared one, and the section is the same everywhere.
 *
 * The action is the menu's route to the same payload ⌘C produces
 * ({@link ../clipboard/object-copy}) — one serializer, two entry points, no chance of them
 * disagreeing about what a copied task is.
 *
 * @see {@link ../../lib/clipboard/object-clipboard} for the payload.
 */
import { Copy } from '@docket/ui/icons';

import {
  type ActionContext,
  type ActionDefinitionInput,
  type ActionDomain,
  type ObjectKind,
  describeObject,
} from '@/lib/actions';
import { objectsToClipboard } from '@/lib/clipboard/object-clipboard';
import { canWriteClipboard, writeClipboard } from '@/lib/clipboard/write';

/**
 * The kinds that are also action domains, and so can own a `<kind>.copy` id.
 *
 * @remarks
 * A calendar event and a time block are objects but not domains: they belong to the `calendar`
 * domain, and neither has a detail page to link to, so neither has anything to copy. Deriving the
 * type rather than restating a list keeps that true as kinds are added.
 */
export type CopyableObjectKind = Extract<ObjectKind, ActionDomain>;

/**
 * Build the Copy action for one object kind.
 *
 * The return type is deliberately inferred rather than annotated as {@link ActionDefinitionInput}.
 * `defineActionDomain` validates each entry against its *implementation's* return type — an
 * asynchronous action must declare receipt ownership, a synchronous one must not — and widening to
 * the input type erases the `Promise<void>` that check reads.
 *
 * @param kind - The kind this action is offered for.
 * @returns The definition to include in that kind's domain.
 *
 * @example
 * ```ts
 * defineActionDomain('project', [openProject, copyObjectAction('project')])
 * ```
 */
export function copyObjectAction(kind: CopyableObjectKind) {
  const descriptor = describeObject(kind);

  return {
    id: `${kind}.copy`,
    label: (context: ActionContext) =>
      context.objects.length > 1
        ? `Copy ${String(context.objects.length)} ${descriptor.pluralNoun.toLowerCase()}`
        : 'Copy',
    icon: Copy,
    objectKinds: [kind],
    multi: true,
    section: 'share',
    keywords: ['clipboard', 'markdown', 'link', 'duplicate reference'],
    // Hidden rather than disabled where there is no clipboard, matching `task.copyLink`: an item
    // that can never work on this device is noise, and there is nothing useful to say about why.
    appliesTo: () => canWriteClipboard(),
    run: async (context: ActionContext) => {
      const payload = objectsToClipboard(context.objects, window.location.origin);
      if (payload.text === '') return;
      await writeClipboard(payload);
    },
    responsiveness: {
      ownership: 'autonomous',
    },
  } satisfies ActionDefinitionInput;
}
