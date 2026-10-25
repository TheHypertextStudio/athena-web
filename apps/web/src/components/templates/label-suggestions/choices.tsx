import type { JSX } from 'react';
import type { LabelTemplateSuggestionSources } from '@docket/work/template-gallery-contract';
import { TemplateTargetType } from '@docket/work/template-contract';
import { Field, Select } from '@docket/ui/primitives';
import { useVocabulary } from '@docket/ui/hooks';
import { ConversionWorkPicker } from '../label-conversion/work-picker';
import type { LabelSuggestionSelection } from './use-suggestion';

interface Props {
  readonly orgId: string;
  readonly sources: LabelTemplateSuggestionSources;
  readonly selection: LabelSuggestionSelection;
  readonly disabled: boolean;
  readonly onChange: (value: LabelSuggestionSelection) => void;
}
/** Choose a real label and kind before reading matching work; all examples start unchecked. */
export function LabelSuggestionChoices(props: Props): JSX.Element {
  const { selection, sources, disabled, onChange } = props;
  const matching = sources.labels.filter((label) => label.groupId === selection.labelGroupId);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Label group">
          <Select
            value={selection.labelGroupId}
            disabled={disabled}
            onChange={(event) => {
              onChange({
                ...selection,
                labelGroupId: event.target.value,
                labelId: '',
                workIds: [],
              });
            }}
          >
            <option value="">Choose a group</option>
            {sources.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        </Field>
        {selection.labelGroupId ? (
          <Field label="Label">
            <Select
              value={selection.labelId}
              disabled={disabled || matching.length === 0}
              onChange={(event) => {
                onChange({ ...selection, labelId: event.target.value, workIds: [] });
              }}
            >
              <option value="">
                {matching.length ? 'Choose a label' : 'No labels in this group'}
              </option>
              {matching.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      {selection.labelId ? (
        <>
          <SuggestionKind
            value={selection.kind}
            disabled={disabled}
            onChange={(kind) => {
              onChange({ ...selection, kind, workIds: [] });
            }}
          />
          <ConversionWorkPicker
            key={`${selection.labelId}:${selection.kind}`}
            orgId={props.orgId}
            kind={selection.kind}
            labelId={selection.labelId}
            selected={selection.workIds}
            disabled={disabled}
            heading="Choose examples"
            onChange={(ids) => {
              onChange({ ...selection, workIds: [...ids] });
            }}
          />
        </>
      ) : null}
    </div>
  );
}
function SuggestionKind({
  value,
  disabled,
  onChange,
}: {
  readonly value: LabelSuggestionSelection['kind'];
  readonly disabled: boolean;
  readonly onChange: (kind: LabelSuggestionSelection['kind']) => void;
}): JSX.Element {
  const kinds = ['task', 'project', 'initiative', 'program'] as const;
  const names = [
    useVocabulary('task'),
    useVocabulary('project'),
    useVocabulary('initiative'),
    useVocabulary('program'),
  ];
  return (
    <Field label="Work kind">
      <Select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(TemplateTargetType.parse(event.target.value));
        }}
      >
        {kinds.map((kind, index) => (
          <option key={kind} value={kind}>
            {names[index]}
          </option>
        ))}
      </Select>
    </Field>
  );
}
