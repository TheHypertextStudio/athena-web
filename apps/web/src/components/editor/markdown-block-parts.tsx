import { Checkbox } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

/** Props for {@link MarkdownTaskItem}. */
export interface MarkdownTaskItemProps {
  readonly checked: boolean;
  readonly children: ReactNode;
}

/**
 * A GFM task-list `<li>`. Unlike TipTap's live `TaskItem` NodeView ({@link
 * file://./freeform-text.tsx}), this markup is fully under our control, so the checkbox itself is
 * the shared `@docket/ui` {@link Checkbox} primitive rather than a hand-rolled `<input>` — the
 * same box/tick treatment used everywhere else in the product, kept current for free.
 */
export function MarkdownTaskItem({ checked, children }: MarkdownTaskItemProps): JSX.Element {
  return (
    <li data-type="taskItem" data-checked={checked}>
      <label>
        <Checkbox checked={checked} readOnly />
      </label>
      <div>{children}</div>
    </li>
  );
}

/** One already-rendered table cell, carrying only the alignment a `<td>`/`<th>` needs. */
export interface MarkdownTableCell {
  readonly content: ReactNode;
  readonly align: 'left' | 'right' | 'center' | null | undefined;
}

/** Props for {@link MarkdownTable}. */
export interface MarkdownTableProps {
  /** Scopes React keys to this table's position among its siblings. */
  readonly keyPrefix: string;
  readonly header: readonly MarkdownTableCell[];
  readonly rows: readonly (readonly MarkdownTableCell[])[];
}

/** A GFM table, given its cell content pre-rendered so this component owns layout, not tokens. */
export function MarkdownTable({ keyPrefix, header, rows }: MarkdownTableProps): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            {header.map((cell, cellIndex) => (
              <th
                key={`${keyPrefix}-head-${cellIndex}`}
                style={{ textAlign: cell.align ?? 'left' }}
              >
                {cell.content}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${keyPrefix}-row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td
                  key={`${keyPrefix}-row-${rowIndex}-${cellIndex}`}
                  style={{ textAlign: cell.align ?? 'left' }}
                >
                  {cell.content}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
