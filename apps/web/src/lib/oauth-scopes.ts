/**
 * OAuth 2.1 Scope Definitions for MCP
 *
 * Hierarchical scope system where parent scopes imply child scopes.
 * Must match the API's oauth-scopes.ts.
 */

export const MCP_SCOPES: Record<string, string[]> = {
  // Parent scopes
  'mcp:read': ['tasks:read', 'events:read', 'projects:read', 'initiatives:read'],
  'mcp:write': ['tasks:write', 'events:write', 'projects:write'],
  'mcp:schedule': ['availability:read', 'agenda:read'],
  'mcp:search': ['tasks:search', 'events:search'],
  // Fine-grained scopes
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

export const ALL_MCP_SCOPES = Object.keys(MCP_SCOPES);

export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: 'Authenticate you with your account',
  profile: 'Access your name and profile picture',
  email: 'Access your email address',
  offline_access: 'Maintain access while you are away',
  'mcp:read': 'Read your tasks, events, projects, and initiatives',
  'mcp:write': 'Create and modify your tasks, events, and projects',
  'mcp:schedule': 'View your schedule and availability',
  'mcp:search': 'Search your tasks and events',
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

export function getScopeDescription(scope: string): string {
  return SCOPE_DESCRIPTIONS[scope] ?? `Access ${scope}`;
}
