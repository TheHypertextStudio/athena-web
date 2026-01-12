/**
 * Integration type definitions for the Athena integrations system.
 *
 * This module provides static configuration types for integration metadata
 * and connection types for user-specific integration state.
 */

/**
 * Supported integration providers.
 */
export type IntegrationProvider =
  | 'linear'
  | 'github'
  | 'todoist'
  | 'asana'
  | 'jira'
  | 'trello'
  | 'google_calendar'
  | 'outlook_calendar'
  | 'apple_calendar'
  | 'caldav_calendar'
  | 'slack'
  | 'google_drive'
  | 'dropbox'
  | 'zoom'
  | 'figma';

/**
 * Categories for grouping integrations in the UI.
 */
export type IntegrationCategory =
  | 'productivity'
  | 'calendar'
  | 'communication'
  | 'storage'
  | 'design';

/**
 * Represents an OAuth scope or permission for an integration.
 */
export interface IntegrationScope {
  /** OAuth scope string (e.g., 'repo', 'read:issues') */
  id: string;
  /** Human-readable name */
  name: string;
  /** What this permission allows */
  description: string;
}

/**
 * Static configuration for an integration provider.
 * This data is defined in the registry and does not change per-user.
 */
export interface IntegrationConfig {
  /** Unique provider identifier */
  provider: IntegrationProvider;
  /** Display name (e.g., "Linear", "GitHub") */
  name: string;
  /** Short description for list view cards */
  shortDescription: string;
  /** Full description for detail view */
  description: string;
  /** Category for grouping */
  category: IntegrationCategory;
  /** OAuth scopes requested by this integration */
  scopes: IntegrationScope[];
}

/**
 * Represents a user's connection to an integration provider.
 * This data is stored in the database per-user.
 */
export interface IntegrationConnection {
  /** Database ID */
  id: string;
  /** Provider this connection is for */
  provider: IntegrationProvider;
  /** Account identifier (e.g., email or username) */
  accountName?: string;
  /** When the connection was established */
  connectedAt: string;
}

/**
 * Combined view of an integration with its config and connection status.
 * Used by the UI to render integration cards and details.
 */
export interface IntegrationWithStatus {
  /** Static configuration */
  config: IntegrationConfig;
  /** User's connection, if connected */
  connection: IntegrationConnection | null;
  /** Whether the user is connected */
  isConnected: boolean;
}

/**
 * Category display metadata for UI rendering.
 */
export interface CategoryInfo {
  id: IntegrationCategory;
  name: string;
  description: string;
}

/**
 * Category metadata for UI display.
 */
export const CATEGORY_INFO: Record<IntegrationCategory, CategoryInfo> = {
  productivity: {
    id: 'productivity',
    name: 'Productivity',
    description: 'Task management and project tracking tools',
  },
  calendar: {
    id: 'calendar',
    name: 'Calendar',
    description: 'Calendar and scheduling apps',
  },
  communication: {
    id: 'communication',
    name: 'Communication',
    description: 'Team chat and messaging platforms',
  },
  storage: {
    id: 'storage',
    name: 'Storage',
    description: 'Cloud storage and file sharing',
  },
  design: {
    id: 'design',
    name: 'Design',
    description: 'Design and creative tools',
  },
};
