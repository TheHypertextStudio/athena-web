import type { LabelTemplateConversionChoices } from '@docket/work/work-template-contract';
import { useState } from 'react';
import { useConversionLabelPrefill } from './prefill';
import type { ConversionPageProps, ConversionCommand } from './types';
interface Selection {
  readonly groupId: string;
  readonly labelId: string;
  readonly ids: readonly string[];
}
/** Restore IDs only for the exact target and single-label choice this focused flow can display. */
export function recoverConversionSelection(
  choices: LabelTemplateConversionChoices | null,
  target: Pick<ConversionPageProps, 'templateId' | 'versionId'>,
): Selection | null {
  const first = choices?.items[0],
    labelId = first?.removeLabelIds[0];
  if (
    !choices ||
    !first ||
    !labelId ||
    choices.items.some(
      (item) =>
        item.workTypeId !== target.templateId ||
        item.workTypeVersionId !== target.versionId ||
        item.kind !== first.kind ||
        item.removeLabelIds.length !== 1 ||
        item.removeLabelIds[0] !== labelId,
    )
  )
    return null;
  return { groupId: choices.labelGroupId, labelId, ids: choices.items.map((item) => item.id) };
}
const labelKey = (value: { readonly groupId: string; readonly labelId: string }): string =>
  JSON.stringify([value.groupId, value.labelId]);
/** Recovered IDs become selectable only after their actual current label has passed the normal prefill check. */
export function useConversionSelection(props: ConversionPageProps, command: ConversionCommand) {
  const recovered = recoverConversionSelection(command.choices ?? null, props);
  const prefill = useConversionLabelPrefill(
    props.orgId,
    recovered?.groupId ?? props.labelGroupId,
    recovered?.labelId ?? props.labelId,
  );
  const [stored, setStored] = useState(() => ({
    key: recovered ? labelKey(recovered) : '',
    ids: recovered?.ids ?? [],
  }));
  const label = prefill.value,
    selected = stored.key === labelKey(label) ? stored.ids : [];
  function setSelected(ids: readonly string[]): void {
    setStored({ key: labelKey(label), ids });
  }
  function choose(groupId: string, labelId: string): void {
    prefill.choose({ groupId, labelId });
    setStored({ key: labelKey({ groupId, labelId }), ids: [] });
  }
  return {
    label,
    selected,
    setSelected,
    choose,
    checking: prefill.checking,
    unavailable: prefill.unavailable,
  };
}
