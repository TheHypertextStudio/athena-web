/**
 * OAuth 2.1 Scope Definitions for MCP
 *
 * Hierarchical scope system where parent scopes imply child scopes.
 * Example: `mcp:read` grants `tasks:read`, `events:read`, etc.
 */

/**
 * Map of parent scopes to their implied child scopes.
 * Empty arrays indicate leaf scopes with no children.
 */
export const MCP_SCOPES: Record<string, string[]> = {
  // Parent scopes - user-friendly, grant multiple permissions
  'mcp:read': ['tasks:read', 'events:read', 'projects:read', 'initiatives:read'],
  'mcp:write': ['tasks:write', 'events:write', 'projects:write'],
  'mcp:schedule': ['availability:read', 'agenda:read'],
  'mcp:search': ['tasks:search', 'events:search'],

  // Fine-grained scopes - can be requested directly for minimal access
  'tasks:read': [],
  'tasks:write': [],
  'tasks:search': [],
  'events:read': [],
  'events:write': [],
  'projects:read': [],
  'projects:write': [],
  'initiatives:read': [],
  'availability:read': [],
  'agenda:read': [],
};

/**
 * All scope names that can be requested.
 */
export const ALL_MCP_SCOPES = Object.keys(MCP_SCOPES);

/**
 * Parent scopes only (the user-friendly ones shown in consent UI).
 */
export const PARENT_MCP_SCOPES = Object.entries(MCP_SCOPES)
  .filter(([, children]) => children.length > 0)
  .map(([scope]) => scope);

/**
 * Scope descriptions for consent UI.
 */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  // OIDC standard scopes
  openid: 'Authenticate you with your account',
  profile: 'Access your name and profile picture',
  email: 'Access your email address',
  offline_access: 'Maintain access while you are away',

  // Parent MCP scopes
  'mcp:read': 'Read your tasks, events, projects, and initiatives',
  'mcp:write': 'Create and modify your tasks, events, and projects',
  'mcp:schedule': 'View your schedule and availability',
  'mcp:search': 'Search your tasks and events',

  // Fine-grained scopes
  'tasks:read': 'Read your tasks',
  'tasks:write': 'Create and modify your tasks',
  'tasks:search': 'Search your tasks',
  'events:read': 'Read your calendar events',
  'events:write': 'Create and modify your calendar events',
  'projects:read': 'Read your projects',
  'projects:write': 'Create and modify your projects',
  'initiatives:read': 'Read your initiatives',
  'availability:read': 'Check your availability',
  'agenda:read': 'Read your daily agenda',
};

/**
 * Expand a list of scopes to include all implied child scopes.
 *
 * @example
 * expandScopes(['mcp:read'])
 * // Returns: ['mcp:read', 'tasks:read', 'events:read', 'projects:read', 'initiatives:read']
 */
export function expandScopes(requestedScopes: string[]): string[] {
  const expanded = new Set(requestedScopes);

  for (const scope of requestedScopes) {
    const implied = MCP_SCOPES[scope];
    if (implied) {
      for (const childScope of implied) {
        expanded.add(childScope);
      }
    }
  }

  return Array.from(expanded);
}

/**
 * Check if a required scope is granted, considering parent scope implications.
 *
 * @example
 * hasScope(['mcp:read'], 'tasks:read') // true - mcp:read implies tasks:read
 * hasScope(['tasks:read'], 'tasks:write') // false - different scopes
 */
export function hasScope(grantedScopes: string[], requiredScope: string): boolean {
  // Direct match
  if (grantedScopes.includes(requiredScope)) {
    return true;
  }

  // Check if any granted parent scope implies the required scope
  for (const scope of grantedScopes) {
    const implied = MCP_SCOPES[scope];
    if (implied?.includes(requiredScope)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if all required scopes are granted.
 */
export function hasAllScopes(grantedScopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.every((scope) => hasScope(grantedScopes, scope));
}

/**
 * Check if any of the required scopes are granted.
 */
export function hasAnyScope(grantedScopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.some((scope) => hasScope(grantedScopes, scope));
}

/**
 * Get a human-readable description for a scope.
 */
export function getScopeDescription(scope: string): string {
  return SCOPE_DESCRIPTIONS[scope] ?? `Access ${scope}`;
}

/**
 * Get descriptions for multiple scopes.
 */
export function getScopeDescriptions(scopes: string[]): { scope: string; description: string }[] {
  return scopes.map((scope) => ({
    scope,
    description: getScopeDescription(scope),
  }));
}
