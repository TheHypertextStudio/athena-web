'use client';

import { relativeTime } from '@docket/ui';
import { RelativeTime } from '@docket/ui/components';
import { ChevronDown, ChevronRight } from '@docket/ui/icons';
import { Button, Surface, Text } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import {
  formatUptime,
  outcomeLabel,
  outcomeTone,
  reasonLabel,
  windowLabel,
} from '@/lib/service-status';
import type { AdminServiceStatus } from '@/lib/types';

/** What each check method is called on screen. */
const METHOD_LABEL: Readonly<Record<AdminServiceStatus['method'], string>> = {
  http: 'Health endpoint',
  database: 'Direct query',
  derived: 'Derived from real traffic',
};

/** Props for {@link ServiceRow}. */
export interface ServiceRowProps {
  /** The service to render. */
  readonly service: AdminServiceStatus;
}

/**
 * One service: its current state, and its record behind a disclosure.
 *
 * @remarks
 * The collapsed row answers the only question most visits have — is this working — and the
 * disclosure answers the ones a visit that found a fault will ask next: how long it has been
 * failing, when it last worked, and how reliable it has been.
 *
 * Every row states when it was last checked, including the healthy ones. A status board that shows
 * a green mark without saying how old it is cannot distinguish a service that is fine from a probe
 * that stopped running an hour ago.
 *
 * @param props - See {@link ServiceRowProps}.
 * @returns the service row.
 */
export function ServiceRow({ service }: ServiceRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <Surface tone="card" shape="small" pad="none">
      <div className="flex items-center gap-3 px-3 py-2">
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 ${outcomeTone(service.outcome)}`}
          aria-hidden="true"
        >
          <Text as="span" token="label-small">
            {outcomeLabel(service.outcome)}
          </Text>
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          <Text as="span" token="body-medium" truncate>
            {service.label}
          </Text>
          <Text as="span" token="body-small" tone="muted" truncate>
            {service.reason ? reasonLabel(service.reason) : METHOD_LABEL[service.method]}
          </Text>
        </div>

        <Text as="span" token="body-small" tone="muted" className="shrink-0">
          {service.checkedAt ? (
            <RelativeTime iso={service.checkedAt}>{relativeTime(service.checkedAt)}</RelativeTime>
          ) : (
            'Never checked'
          )}
        </Text>

        <Button
          variant="ghost"
          controlSize="sm"
          iconOnly
          aria-expanded={expanded}
          aria-label={expanded ? `Hide ${service.label} detail` : `Show ${service.label} detail`}
          onClick={() => {
            setExpanded((open) => !open);
          }}
        >
          <Chevron aria-hidden="true" className="size-4" />
        </Button>
      </div>

      {expanded ? <ServiceDetail service={service} /> : null}
    </Surface>
  );
}

/** A service's uptime record and the particulars of its last check. */
function ServiceDetail({ service }: { readonly service: AdminServiceStatus }): JSX.Element {
  return (
    <div className="flex flex-col gap-3 px-3 pb-3">
      <div className="flex flex-wrap gap-6">
        {service.uptime.map((window) => (
          <div key={window.windowHours} className="flex flex-col gap-0.5">
            <Text as="span" token="label-small" tone="muted">
              {windowLabel(window.windowHours)}
            </Text>
            <Text as="span" token="title-small" numeric>
              {formatUptime(window.uptime)}
            </Text>
            <Text as="span" token="body-small" tone="muted" numeric>
              {`${String(window.successes)}/${String(window.checks)}`}
            </Text>
          </div>
        ))}
      </div>

      <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1">
        <Detail label="Checked by" value={METHOD_LABEL[service.method]} />
        <Detail
          label="Last healthy"
          value={service.lastSuccessAt ? relativeTime(service.lastSuccessAt) : 'Never'}
        />
        {service.latencyMs === null ? null : (
          <Detail label="Latency" value={`${String(service.latencyMs)} ms`} />
        )}
        {service.statusCode === null ? null : (
          <Detail label="Status" value={String(service.statusCode)} />
        )}
      </dl>
    </div>
  );
}

/** One labelled fact in the disclosure. */
function Detail({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div className="contents">
      <Text as="dt" token="body-small" tone="muted">
        {label}
      </Text>
      <Text as="dd" token="body-small">
        {value}
      </Text>
    </div>
  );
}
