'use client';

/**
 * `components/actions/copy-object-action` — the Copy action, defined once for every kind.
 *
 * @remarks
 * Six domains share one Copy item, built from the kind's own descriptor: the label pluralizes
 * itself, the icon and section are fixed. Adding a kind is one call.
 *
 * The menu and ⌘C ({@link ../clipboard/clipboard-provider}) run the same serializer.
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
 * Derived from the two closed sets, so it tracks new kinds. Calendar events and time blocks fall
 * outside it: they belong to the `calendar` domain and have no detail page to link to.
 */
export type CopyableObjectKind = Extract<ObjectKind, ActionDomain>;

/**
 * Build the Copy action for one object kind.
 *
 * The return type is inferred. `defineActionDomain` validates each entry against its
 * *implementation's* return type, which an annotation would erase.
 *
 * @param kind - The kind this action is offered for.
 * @param reportOutcome - Where to report whether the write reached the clipboard, from
 * `useCopyOutcome`. The menu has closed by the time the write resolves.
 * @returns The definition to include in that kind's domain.
 *
 * @example
 * ```ts
 * defineActionDomain('project', [openProject, copyObjectAction('project', reportOutcome)])
 * ```
 */
export function copyObjectAction(
  kind: CopyableObjectKind,
  reportOutcome: (wrote: boolean) => void,
) {
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
    // Hidden where the device has no clipboard, matching `task.copyLink`.
    appliesTo: () => canWriteClipboard(),
    run: async (context: ActionContext) => {
      const payload = objectsToClipboard(context.objects, window.location.origin);
      if (payload.text === '') return;
      reportOutcome(await writeClipboard(payload));
    },
    responsiveness: {
      // The acknowledgement is the reported outcome: whether the clipboard took the payload.
      ownership: 'autonomous',
    },
  } satisfies ActionDefinitionInput;
}
