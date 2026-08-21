import type { JSX } from 'react';

import InitiativesListClient from './initiatives-client';

/** Render the server-executed Initiative hierarchy. */
export default function InitiativesListPage(): JSX.Element {
  return <InitiativesListClient />;
}
