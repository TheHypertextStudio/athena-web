'use client';

import { CheckCircle2 } from '@docket/ui/icons';
import { Row, Stack, Text } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX } from 'react';

import { faultingServices, outcomeLabel, reasonLabel } from '@/lib/service-status';
import type { AdminStatus } from '@/lib/types';

/** Props for {@link ServiceHealthSummary}. */
export interface ServiceHealthSummaryProps {
  /** The status board, or `undefined` before it resolves. */
  readonly status: AdminStatus | undefined;
}

/**
 * Whether anything is broken, in one line, with a way through to the detail.
 *
 * @remarks
 * The dashboard's job is to say what needs a person. Service health belongs on it for the same
 * reason the queue signals do — but it does not belong on it in full, because the full board is
 * three groups of rows that answer questions nobody has while everything is working.
 *
 * So: one line when everything is healthy, and the faults themselves when there are any. A summary
 * that said "5 services" with no verdict would be a number an operator has to go and interpret,
 * which is the opposite of what a dashboard is for.
 *
 * @param props - See {@link ServiceHealthSummaryProps}.
 * @returns the summary.
 */
export function ServiceHealthSummary({ status }: ServiceHealthSummaryProps): JSX.Element {
  const faults = faultingServices(status);

  if (!status) {
    return (
      <Text as="p" token="body-small" tone="muted">
        Checking…
      </Text>
    );
  }

  if (faults.length === 0) {
    return (
      <Row gap={2} align="center">
        <CheckCircle2 aria-hidden="true" className="text-state-completed size-4 shrink-0" />
        <Text as="p" token="body-medium">
          Every service is operational
        </Text>
      </Row>
    );
  }

  return (
    <Stack gap={2}>
      {faults.map((service) => (
        <Link
          key={service.key}
          href="/status"
          className="hover:bg-surface-container -mx-2 flex items-center gap-3 rounded-md px-2 py-1 transition-colors"
        >
          <span className="bg-error-container text-on-error-container shrink-0 rounded-full px-2 py-0.5">
            <Text as="span" token="label-small">
              {outcomeLabel(service.outcome)}
            </Text>
          </span>
          <Text as="span" token="body-medium" truncate className="min-w-0 flex-1">
            {service.label}
          </Text>
          {service.reason ? (
            <Text as="span" token="body-small" tone="muted" truncate className="shrink-0">
              {reasonLabel(service.reason)}
            </Text>
          ) : null}
        </Link>
      ))}
    </Stack>
  );
}
