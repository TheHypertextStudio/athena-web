'use client';

import { type JSX } from 'react';
import { useTypedRoute } from '@/lib/app-location';
import { SeriesManagementContent } from '@/components/recurrence/series-management-content';

/** Direct route entry to the same management workspace used by generated work. */
export default function RecurrenceSeriesPage(): JSX.Element {
  const {
    params: { orgId, seriesId },
  } = useTypedRoute('/orgs/[orgId]/recurrence-series/[seriesId]');
  return <SeriesManagementContent key={seriesId} orgId={orgId} seriesId={seriesId} />;
}
