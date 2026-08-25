import type { JSX } from 'react';

import { EntityDetailSkeleton } from '@/components/views/entity-detail-skeleton';

/** Render the Program detail layout while Next loads the detail route. */
export default function LoadingProgramDetail(): JSX.Element {
  return <EntityDetailSkeleton entityName="Program" tabCount={4} />;
}
