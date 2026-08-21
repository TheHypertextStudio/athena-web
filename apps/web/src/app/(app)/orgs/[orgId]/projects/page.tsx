import type { JSX } from 'react';

import ProjectsListClient from './projects-client';

/** Render the server-executed organization Project roster. */
export default function ProjectsListPage(): JSX.Element {
  return <ProjectsListClient />;
}
