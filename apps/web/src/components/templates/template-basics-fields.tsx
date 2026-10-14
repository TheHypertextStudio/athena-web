import type { JSX } from 'react';
import type { TemplateOut } from '@docket/work/template-contract';
import { EnumPicker } from '@docket/ui/components';
import { Input } from '@docket/ui/primitives';

/** The sharing scopes a template may take, in widening order. */
const SCOPE_OPTIONS = [
  { value: 'personal', label: 'Only you' },
  { value: 'organization', label: 'Everyone in this workspace' },
] as const;

/** Edit the template identity and existing sharing scopes. */
export function TemplateBasicsFields({
  name,
  description,
  scope,
  saving,
  nameFieldId,
  descriptionFieldId,
  onNameChange,
  onDescriptionChange,
  onScopeChange,
  teamScoped,
}: {
  name: string;
  description: string;
  scope: TemplateOut['scope'];
  saving: boolean;
  nameFieldId: string;
  descriptionFieldId: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onScopeChange: (value: TemplateOut['scope']) => void;
  teamScoped: boolean;
}): JSX.Element {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
        <label htmlFor={nameFieldId} className="text-on-surface text-label-large">
          Template name
        </label>
        <Input
          id={nameFieldId}
          value={name}
          disabled={saving}
          placeholder="Template name"
          onChange={(event) => {
            onNameChange(event.target.value);
          }}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
        <label htmlFor={descriptionFieldId} className="text-on-surface text-label-large">
          When to use it
        </label>
        <Input
          id={descriptionFieldId}
          value={description}
          disabled={saving}
          placeholder="Optional"
          onChange={(event) => {
            onDescriptionChange(event.target.value);
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-label-large text-on-surface">Shared with</span>
        <EnumPicker
          options={
            teamScoped
              ? [...SCOPE_OPTIONS, { value: 'team' as const, label: 'This team' }]
              : SCOPE_OPTIONS
          }
          value={scope}
          onChange={(next) => {
            if (next) onScopeChange(next);
          }}
          placeholder="Shared with"
          ariaLabel="Shared with"
          triggerVariant="secondary"
          triggerClassName="w-full justify-start"
          disabled={saving}
        />
      </div>
    </>
  );
}
