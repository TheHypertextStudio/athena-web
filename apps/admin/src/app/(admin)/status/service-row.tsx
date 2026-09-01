'use client';

import { relativeTime } from '@docket/ui';
import { RelativeTime } from '@docket/ui/components';
import { Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { AdminDisclosureRow } from '@/components/admin-disclosure-row';
import { OutcomeBadge } from '@/components/outcome-badge';
import { PropertyList, Property } from '@/components/admin-detail';
import { formatUptime, reasonLabel, windowLabel } from '@/lib/service-status';
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
  return (
    <AdminDisclosureRow
      name={service.label}
      leading={<OutcomeBadge outcome={service.outcome} />}
      title={service.label}
      subtitle={service.reason ? reasonLabel(service.reason) : METHOD_LABEL[service.method]}
      meta={
        <Text as="span" token="body-small" tone="muted">
          {service.checkedAt ? (
            <RelativeTime iso={service.checkedAt}>{relativeTime(service.checkedAt)}</RelativeTime>
          ) : (
            'Never checked'
          )}
        </Text>
      }
    >
      <ServiceDetail service={service} />
    </AdminDisclosureRow>
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

      <PropertyList>
        <Property label="Checked by" value={METHOD_LABEL[service.method]} />
        <Property
          label="Last healthy"
          value={service.lastSuccessAt ? relativeTime(service.lastSuccessAt) : 'Never'}
        />
        {service.latencyMs === null ? null : (
          <Property label="Latency" value={`${String(service.latencyMs)} ms`} />
        )}
        {service.statusCode === null ? null : (
          <Property label="Status" value={String(service.statusCode)} />
        )}
      </PropertyList>
    </div>
  );
}
