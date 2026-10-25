import type { JSX } from 'react';

/** Show only the actual selected saved sources at the final generation decision. */
export function TemplateTailoringContextReview({
  conversations,
  importedWork,
  selection,
}: {
  readonly conversations: readonly { id: string; label: string }[];
  readonly importedWork: readonly { id: string; label: string }[];
  readonly selection: { sessionIds: string[]; importedTaskIds: string[] };
}): JSX.Element {
  const groups = [
    {
      label: 'Saved conversations',
      rows: conversations.filter((row) => selection.sessionIds.includes(row.id)),
    },
    {
      label: 'Imported work',
      rows: importedWork.filter((row) => selection.importedTaskIds.includes(row.id)),
    },
  ];
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Selected context">
      {groups
        .filter((group) => group.rows.length)
        .map((group) => (
          <div key={group.label}>
            <h3 className="text-label-large">{group.label}</h3>
            <ul className="mt-2 flex min-w-0 list-disc flex-col gap-2 pl-5">
              {group.rows.map((row) => (
                <li key={row.id} className="text-body-medium break-words">
                  {row.label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      <p className="text-body-medium text-on-surface-variant">
        Athena will suggest starting work from these records. Review any proposal in Inbox before
        keeping a private draft.
      </p>
    </section>
  );
}
