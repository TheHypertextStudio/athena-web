/** A closed interaction identifier and its acknowledgement category. */
export const INTERACTION_CATALOG = [
  { id: 'app.local-disclosure', category: 'local-disclosure' },
  { id: 'app.navigation', category: 'navigation' },
  { id: 'app.read', category: 'read' },
  { id: 'app.direct-manipulation', category: 'direct-manipulation' },
  { id: 'app.mutation', category: 'mutation' },
  { id: 'app.long-running', category: 'long-running' },
] as const;

/** Route templates that may be named by an interaction receipt. */
export const ROUTE_TEMPLATE_IDS = [
  '/',
  '/agenda',
  '/calendar',
  '/focus',
  '/initiatives',
  '/initiatives/[initiativeId]',
  '/programs',
  '/programs/[programId]',
  '/projects',
  '/projects/[projectId]',
  '/settings',
  '/settings/[section]',
  '/tasks',
  '/tasks/[taskId]',
] as const;
