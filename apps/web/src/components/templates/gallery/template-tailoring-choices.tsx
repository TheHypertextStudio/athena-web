'use client';
import type { JSX } from 'react';
import { Checkbox } from '@docket/ui/primitives';

/** Explicit saved-source choices; the surrounding manual catalog remains independently usable. */
export function TemplateTailoringChoices({
  availability,
  conversations,
  importedWork,
  selection,
  onChange,
}: {
  readonly availability: 'available' | 'requires_pro' | 'authoring_unavailable';
  readonly conversations: readonly { id: string; label: string }[];
  readonly importedWork: readonly { id: string; label: string }[];
  readonly selection: { sessionIds: string[]; importedTaskIds: string[] };
  readonly onChange: (value: { sessionIds: string[]; importedTaskIds: string[] }) => void;
}): JSX.Element {
  if (availability === 'requires_pro')
    return (
      <p className="text-body-medium text-on-surface-variant">
        Athena tailoring is available with Docket Pro. You can keep choosing and copying the
        starting points in the gallery on any plan.
      </p>
    );
  if (availability === 'authoring_unavailable')
    return (
      <p className="text-body-medium text-on-surface-variant">
        Your workspace’s authoring permissions do not currently allow Athena to propose templates
        for you.
      </p>
    );
  if (!conversations.length && !importedWork.length)
    return (
      <p className="text-body-medium text-on-surface-variant">
        No saved conversation or imported work is available here yet. Choose curated starting points
        in the gallery, or return after planning this work with Athena.
      </p>
    );
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-body-medium text-on-surface-variant">
        Choose saved context to guide a private proposal. Athena will use these records; it will not
        change existing work.
      </p>
      <SourceGroups
        conversations={conversations}
        importedWork={importedWork}
        selection={selection}
        onChange={onChange}
      />
    </div>
  );
}

function SourceGroups({
  conversations,
  importedWork,
  selection,
  onChange,
}: Pick<
  Parameters<typeof TemplateTailoringChoices>[0],
  'conversations' | 'importedWork' | 'selection' | 'onChange'
>): JSX.Element {
  return (
    <>
      {' '}
      {(
        [
          {
            key: 'sessionIds',
            label: 'Saved conversations (up to 5)',
            rows: conversations,
            max: 5,
          },
          {
            key: 'importedTaskIds',
            label: 'Imported work (up to 30)',
            rows: importedWork,
            max: 30,
          },
        ] as const
      )
        .filter((group) => group.rows.length)
        .map((group) => (
          <fieldset key={group.key} className="flex min-w-0 flex-col gap-2">
            <legend className="text-label-large mb-2">{group.label}</legend>
            {group.rows.map((row) => (
              <label
                key={row.id}
                className="text-body-medium flex min-h-11 min-w-0 items-start gap-3 py-2"
              >
                <Checkbox
                  checked={selection[group.key].includes(row.id)}
                  disabled={
                    !selection[group.key].includes(row.id) &&
                    selection[group.key].length >= group.max
                  }
                  onChange={() => {
                    onChange({
                      ...selection,
                      [group.key]: selection[group.key].includes(row.id)
                        ? selection[group.key].filter((id) => id !== row.id)
                        : [...selection[group.key], row.id],
                    });
                  }}
                />
                <span className="min-w-0 break-words">{row.label}</span>
              </label>
            ))}
          </fieldset>
        ))}
    </>
  );
}
