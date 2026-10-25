import type { ComponentType } from 'react';

/** An authenticated route and the layout owner allowed to render its client component. */
export interface OfflineRoute {
  readonly pattern: string;
  readonly navigationContext: 'workspace' | 'activity';
  readonly load: () => Promise<ComponentType>;
}
