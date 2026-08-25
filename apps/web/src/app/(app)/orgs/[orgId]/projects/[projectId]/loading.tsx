import type { JSX } from 'react';

import { EntityDetailSkeleton } from '@/components/views/entity-detail-skeleton';

/** Render the Project detail layout while Next loads the detail route. */
export default function LoadingProjectDetail(): JSX.Element {
  return <EntityDetailSkeleton entityName="Project" tabCount={4} />;
}
