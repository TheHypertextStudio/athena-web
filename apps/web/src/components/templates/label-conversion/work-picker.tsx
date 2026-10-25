import { useEffect, useRef, useState, type JSX } from 'react';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type { WorkViewQueryResponse } from '@docket/work/work-view-contract';
import { Button, Checkbox } from '@docket/ui/primitives';
import { QueryLoadFailure } from '@/components/feedback';
import { useApiQuery } from '@/lib/query';
import { conversionWorkDef } from './queries';
import { conversionWorkQuery } from './selection';
function MatchingWorkFailure({
  query,
}: {
  readonly query: Parameters<typeof QueryLoadFailure>[0]['query'];
}): JSX.Element {
  const recovery = useRef<HTMLDivElement>(null);
  useEffect(() => {
    recovery.current?.focus({ preventScroll: true });
    recovery.current?.scrollIntoView({ block: 'center' });
  }, [query.error]);
  return (
    <div
      ref={recovery}
      role="region"
      aria-label="Matching work could not load"
      tabIndex={-1}
      className="outline-none"
    >
      <QueryLoadFailure title="Matching work" query={query} size="panel" />
    </div>
  );
}

/** Paginate ordinary authorized work; selecting a row is always an explicit action. */
export function ConversionWorkPicker({
  orgId,
  kind,
  labelId,
  selected,
  disabled,
  onChange,
  heading = 'Choose the work to update',
}: {
  readonly heading?: string;
  readonly orgId: string;
  readonly kind: TemplateTargetType;
  readonly labelId: string;
  readonly selected: readonly string[];
  readonly disabled: boolean;
  readonly onChange: (ids: readonly string[]) => void;
}): JSX.Element {
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const query = useApiQuery(
    conversionWorkDef(orgId, conversionWorkQuery(kind, labelId, cursors.at(-1))),
  );
  if (query.isError) return <MatchingWorkFailure query={query} />;
  if (!query.data) return <p role="status">Finding matching work…</p>;
  const rows = query.data.rows.filter((row) => !row.isContext),
    next = query.data.nextCursor;
  return (
    <section aria-label="Choose matching work" className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title-medium">{heading}</h2>
        <p className="text-body-small text-on-surface-variant" role="status">
          {selected.length} selected · up to 100
        </p>
      </div>
      {selected.length > 0 ? (
        <Button
          variant="ghost"
          className="mb-2 h-auto min-h-10 max-w-full whitespace-normal"
          disabled={disabled}
          onClick={() => {
            onChange([]);
          }}
        >
          Clear selection
        </Button>
      ) : null}
      {rows.length ? (
        <WorkChoices rows={rows} selected={selected} disabled={disabled} onChange={onChange} />
      ) : (
        <p className="text-body-medium text-on-surface-variant py-4">
          No matching work is available for this label.
        </p>
      )}
      {cursors.length > 1 || next ? (
        <nav aria-label="Matching work pages" className="mt-3 flex justify-between gap-3">
          <Button
            variant="ghost"
            disabled={disabled || cursors.length === 1}
            onClick={() => {
              setCursors((value) => value.slice(0, -1));
            }}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            disabled={disabled || !next}
            onClick={() => {
              if (next) setCursors((value) => [...value, next]);
            }}
          >
            Next
          </Button>
        </nav>
      ) : null}
    </section>
  );
}

function WorkChoices({
  rows,
  selected,
  disabled,
  onChange,
}: {
  readonly rows: readonly WorkViewQueryResponse['rows'][number][];
  readonly selected: readonly string[];
  readonly disabled: boolean;
  readonly onChange: (ids: readonly string[]) => void;
}): JSX.Element {
  return (
    <ul className="divide-outline-variant divide-y">
      {rows.map((row) => (
        <li key={row.id}>
          <label className="text-body-large flex min-h-12 min-w-0 cursor-pointer items-start gap-3 py-3">
            <Checkbox
              className="mt-0.5 shrink-0"
              checked={selected.includes(row.id)}
              disabled={disabled || (!selected.includes(row.id) && selected.length >= 100)}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...selected, row.id]
                    : selected.filter((value) => value !== row.id),
                );
              }}
            />
            <span className="min-w-0 break-words">
              {row.target === 'task' ? row.title : row.name}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}
