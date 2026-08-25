import type { JSX } from 'react';

import { EntityDetailSkeleton } from '@/components/views/entity-detail-skeleton';

/** Render the Initiative detail layout while Next loads the detail route. */
export default function LoadingInitiativeDetail(): JSX.Element {
  return <EntityDetailSkeleton entityName="Initiative" tabCount={5} />;
}
