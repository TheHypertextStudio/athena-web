import type { JSX } from 'react';
import type { LabelGroupOut, LabelOut } from '@docket/work/label-contract';
import { Field, Select } from '@docket/ui/primitives';
import { QueryLoadFailure } from '@/components/feedback';
import { labelsDef, labelGroupsDef } from '@/components/labels/queries';
import { useApiQuery } from '@/lib/query';
/** Choose one existing stand-in label before loading any matching work. */
export function ConversionLabelPicker({
  orgId,
  groupId,
  labelId,
  disabled,
  onChoose,
}: {
  readonly orgId: string;
  readonly groupId: string;
  readonly labelId: string;
  readonly disabled: boolean;
  readonly onChoose: (groupId: string, labelId: string) => void;
}): JSX.Element {
  const groups = useApiQuery(labelGroupsDef(orgId)),
    labels = useApiQuery(labelsDef(orgId));
  if (groups.isError) return <QueryLoadFailure title="Label groups" query={groups} />;
  if (labels.isError) return <QueryLoadFailure title="Labels" query={labels} />;
  if (!groups.data || !labels.data) return <p role="status">Loading your labels…</p>;
  return (
    <LabelChoices
      groups={groups.data.items}
      labels={labels.data.items}
      groupId={groupId}
      labelId={labelId}
      disabled={disabled}
      onChoose={onChoose}
    />
  );
}
function LabelChoices({
  groups,
  labels,
  groupId,
  labelId,
  disabled,
  onChoose,
}: {
  readonly groupId: string;
  readonly labelId: string;
  readonly groups: readonly LabelGroupOut[];
  readonly labels: readonly LabelOut[];
  readonly disabled: boolean;
  readonly onChoose: (groupId: string, labelId: string) => void;
}): JSX.Element {
  if (groups.length === 0)
    return (
      <p className="text-body-medium text-on-surface-variant">
        There are no label groups to choose from. Group the labels you use for kinds of work, then
        return here.
      </p>
    );
  const matching = labels.filter((label) => label.groupId === groupId);
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <Field label="Label group">
        <Select
          value={groupId}
          disabled={disabled}
          onChange={(event) => {
            onChoose(event.target.value, '');
          }}
        >
          <option value="">Choose a group</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
      </Field>
      {groupId ? (
        <Field label="Label to replace">
          <Select
            value={labelId}
            disabled={disabled || matching.length === 0}
            onChange={(event) => {
              onChoose(groupId, event.target.value);
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
  );
}
