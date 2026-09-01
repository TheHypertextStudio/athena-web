'use client';

/**
 * `publishing` — one DNS record, laid out as the registrar form it is about to be typed into.
 *
 * @remarks
 * Type, Name and Value are three labelled fields, and a registrar's form asks for them in exactly
 * that shape. So they are rendered as aligned columns — one grid owning every row, labels in a
 * fixed first column, values in the second — rather than as three independently-spaced lines.
 * Alignment is what lets someone read down the pair of columns instead of hunting each label.
 *
 * The two fields anyone actually transcribes — Name and Value — are copy controls; see
 * {@link CopyValue} for why that is a control rather than selectable text. Type is not one of
 * them: registrars offer it as a fixed choice, so there is nowhere to paste it.
 */
import type { WorkspaceDomainOut } from '@docket/work/publish-contract';
import { Fragment, type JSX } from 'react';

import { CopyValue } from './copy-value';

/** Props for {@link DnsRecord}. */
export interface DnsRecordProps {
  /** The record to publish at the registrar. */
  readonly record: WorkspaceDomainOut['verificationRecord'];
}

/**
 * The three fields of one DNS record, in aligned label/value columns.
 *
 * @param props - The {@link DnsRecordProps}.
 * @returns The rendered record.
 */
export function DnsRecord({ record }: DnsRecordProps): JSX.Element {
  return (
    <dl className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5">
      <dt className="text-label-small text-on-surface-variant">Type</dt>
      {/* Not copyable. A record type is a value you pick from the registrar's own dropdown, never
          one you paste, so a copy control here would be an affordance for something nobody does —
          and at three characters wide it left its icon stranded at the far end of the column. */}
      <dd className="text-body-small text-on-surface min-w-0 py-1 font-mono">{record.type}</dd>

      {(
        [
          ['Name', record.name],
          ['Value', record.value],
        ] as const
      ).map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-label-small text-on-surface-variant">{label}</dt>
          <dd className="min-w-0">
            <CopyValue label={label} value={value} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
