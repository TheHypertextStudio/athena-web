import { LabelId } from '../ids';
import { BlueprintError } from '../blueprints/errors';
import { copyIdentityKey } from './copy-identity';
import type {
  ProspectiveCopyOmission,
  CopyDefinitionSource,
  TemplateCopySourcesInput,
} from './copy-prospective-types';

/** Apply only caller-selected catalog labels; unknown labels remain visible omissions. */
export function prospectiveSuggestedLabels(
  input: TemplateCopySourcesInput,
  source: CopyDefinitionSource,
  payload: Readonly<Record<string, unknown>>,
): { payload: Record<string, unknown>; omissions: readonly ProspectiveCopyOmission[] } {
  const labels: string[] = [],
    omissions: ProspectiveCopyOmission[] = [];
  for (const suggestion of source.labelSuggestions ?? []) {
    const choices =
      input.suggestedLabelMappings?.filter(
        (choice) =>
          copyIdentityKey(choice.source) === copyIdentityKey(source.identity) &&
          choice.suggestion === suggestion,
      ) ?? [];
    const label = choices[0]?.destinationLabelId;
    if (choices.some((choice) => choice.destinationLabelId !== label))
      throw new BlueprintError('blueprint_invalid', 'Conflicting catalog label mapping.');
    if (label) {
      if (payload['targetType'] !== 'task')
        throw new BlueprintError(
          'blueprint_invalid',
          'Only Task templates accept suggested labels.',
        );
      labels.push(LabelId.parse(label));
    } else
      omissions.push({
        source: source.identity,
        kind: 'label_suggestion',
        path: ['labelSuggestions'],
        count: 1,
        value: suggestion,
      });
  }
  const prior = Array.isArray(payload['labelIds'])
    ? payload['labelIds'].map((id) => LabelId.parse(id))
    : [];
  return {
    payload: labels.length
      ? { ...payload, labelIds: [...new Set([...prior, ...labels])] }
      : { ...payload },
    omissions,
  };
}
