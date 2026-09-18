'use client';

/**
 * The Review expansion: an outward proposal's raw input as label/value rows.
 *
 * @remarks
 * Shared by the batch-review card ({@link import('@/components/agents/proposal-group-card').ProposalGroupCard})
 * and the job card's decision block, so both surfaces reveal what an outward tool call would send
 * out the same way before a person approves it.
 */
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

import { orderedInputRows } from '@/lib/athena/describe-proposal';

/** Props for {@link ProposalInputRows}. */
export interface ProposalInputRowsProps {
  /** The outward proposal's raw tool input. */
  readonly input: Readonly<Record<string, unknown>>;
  readonly className?: string;
}

/** Render one outward proposal's input as a `dt`/`dd` list, `to`/`subject`/`body` first. */
export function ProposalInputRows({ input, className }: ProposalInputRowsProps): JSX.Element {
  return (
    <dl className={cn('rounded-md p-2.5', className)}>
      {orderedInputRows(input).map((row) => (
        <div key={row.label} className="text-body-small grid gap-1 py-1 sm:grid-cols-[6rem_1fr]">
          <dt className="text-on-surface-variant">{row.label}</dt>
          <dd className="text-on-surface break-words whitespace-pre-wrap">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
