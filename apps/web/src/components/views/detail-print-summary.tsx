/**
 * `detail-print-summary` — the static, document-first representation of an entity detail page.
 *
 * @remarks
 * Detail pages contain editable fields, menus, and panels that make no sense on paper. This
 * component accepts only persisted strings, so every route prints the same stable brief regardless
 * of which interactive tab happened to be open.
 */
import { type JSX } from 'react';

import { StaticMarkdown } from '@/components/editor/static-markdown';

/** One read-only property included in a printed entity brief. */
export interface DetailPrintProperty {
  /** Human-readable property name. */
  readonly label: string;
  /** Persisted or derived read-only value. */
  readonly value: string;
}

/** Inputs for {@link DetailPrintSummary}. */
export interface DetailPrintSummaryProps {
  /** Entity name. */
  readonly title: string;
  /** Optional one-line outcome summary. */
  readonly summary?: string | null | undefined;
  /** Model-specific static properties. */
  readonly properties: readonly DetailPrintProperty[];
  /** Persisted Overview document content. */
  readonly description?: string | null | undefined;
}

/** Render the stable content that each entity detail route prints. */
export function DetailPrintSummary({
  title,
  summary,
  properties,
  description,
}: DetailPrintSummaryProps): JSX.Element {
  return (
    <article className="detail-print-summary" aria-label={`${title} printable brief`}>
      <h1 className="text-headline-large text-on-surface">{title}</h1>
      {summary ? <p className="text-on-surface-variant text-body-large mt-2">{summary}</p> : null}

      <dl className="detail-print-properties text-body-small mt-6 grid grid-cols-2 gap-x-8 gap-y-2">
        {properties.map(({ label, value }) => (
          <div key={label} className="flex justify-between gap-4 border-b py-1">
            <dt className="text-on-surface-variant">{label}</dt>
            <dd className="text-right capitalize">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-8" aria-label="Overview">
        <h2 className="text-title-large text-on-surface">Overview</h2>
        {description?.trim() ? (
          <StaticMarkdown value={description} className="mt-3 max-w-none" />
        ) : (
          <p className="text-on-surface-variant text-body-medium mt-3">No overview provided.</p>
        )}
      </section>
    </article>
  );
}
