/**
 * Static integration registry.
 *
 * This module contains the static configuration for all supported integrations.
 * Integration metadata is defined here; user connection state is stored in the database.
 */

import type { IntegrationConfig, IntegrationProvider } from './types';

/**
 * All supported integrations with their static configuration.
 */
export const INTEGRATIONS: IntegrationConfig[] = [
  // Productivity
  {
    provider: 'linear',
    name: 'Linear',
    shortDescription: 'Sync issues and projects',
    description:
      'Connect Linear to sync your issues and project progress with Athena. Track your engineering work alongside your other tasks.',
    category: 'productivity',
    scopes: [
      {
        id: 'read',
        name: 'Read access',
        description: 'View your issues, projects, and team data',
      },
      {
        id: 'write',
        name: 'Write access',
        description: 'Create and update issues on your behalf',
      },
    ],
  },
  {
    provider: 'github',
    name: 'GitHub',
    shortDescription: 'Track issues and PRs',
    description:
      'Connect GitHub to track issues and pull requests alongside your tasks. Stay on top of code reviews and project milestones.',
    category: 'productivity',
    scopes: [
      {
        id: 'repo',
        name: 'Repository access',
        description: 'Access your repositories, issues, and pull requests',
      },
      {
        id: 'user:email',
        name: 'Email address',
        description: 'Read your email for account identification',
      },
    ],
  },
  {
    provider: 'todoist',
    name: 'Todoist',
    shortDescription: 'Import tasks and projects',
    description:
      'Connect Todoist to import your tasks and projects into Athena. Consolidate your task management in one place.',
    category: 'productivity',
    scopes: [
      {
        id: 'data:read',
        name: 'Read tasks',
        description: 'View your tasks, projects, and labels',
      },
      {
        id: 'data:read_write',
        name: 'Manage tasks',
        description: 'Create, update, and complete tasks',
      },
    ],
  },
  {
    provider: 'asana',
    name: 'Asana',
    shortDescription: 'Sync tasks and projects',
    description:
      'Connect Asana to sync your tasks and projects with Athena. Keep your team projects visible alongside personal tasks.',
    category: 'productivity',
    scopes: [
      {
        id: 'default',
        name: 'Full access',
        description: 'Read and write access to your Asana data',
      },
    ],
  },
  {
    provider: 'jira',
    name: 'Jira',
    shortDescription: 'Track issues and sprints',
    description:
      "Connect Jira to track your issues and sprint progress. Stay aligned with your team's agile workflow.",
    category: 'productivity',
    scopes: [
      {
        id: 'read:jira-work',
        name: 'Read issues',
        description: 'View issues, projects, and boards',
      },
      {
        id: 'write:jira-work',
        name: 'Manage issues',
        description: 'Create and update issues',
      },
    ],
  },
  {
    provider: 'trello',
    name: 'Trello',
    shortDescription: 'Sync boards and cards',
    description:
      'Connect Trello to sync your boards and cards with Athena. Bring your Kanban workflow into your productivity hub.',
    category: 'productivity',
    scopes: [
      {
        id: 'read',
        name: 'Read boards',
        description: 'View your boards, lists, and cards',
      },
      {
        id: 'write',
        name: 'Manage cards',
        description: 'Create and update cards',
      },
    ],
  },
  // Calendar
  {
    provider: 'google_calendar',
    name: 'Google Calendar',
    shortDescription: 'Sync calendar events',
    description:
      'Connect Google Calendar to import your events into Athena. See your schedule alongside your tasks and deadlines.',
    category: 'calendar',
    scopes: [
      {
        id: 'calendar.readonly',
        name: 'Read calendars',
        description: 'View your calendar events',
      },
      {
        id: 'calendar.events',
        name: 'Manage events',
        description: 'Create and edit calendar events',
      },
    ],
  },
  {
    provider: 'outlook_calendar',
    name: 'Outlook Calendar',
    shortDescription: 'Sync Outlook events',
    description:
      'Connect Outlook Calendar to import your events into Athena. Integrate your Microsoft 365 schedule with your workflow.',
    category: 'calendar',
    scopes: [
      {
        id: 'Calendars.Read',
        name: 'Read calendars',
        description: 'View your calendar events',
      },
      {
        id: 'Calendars.ReadWrite',
        name: 'Manage events',
        description: 'Create and edit calendar events',
      },
    ],
  },
  {
    provider: 'apple_calendar',
    name: 'Apple Calendar',
    shortDescription: 'Sync iCloud calendar',
    description:
      'Connect Apple Calendar to import your iCloud events into Athena. Keep your Apple ecosystem in sync.',
    category: 'calendar',
    scopes: [
      {
        id: 'calendar:read',
        name: 'Read calendars',
        description: 'View your calendar events',
      },
    ],
  },

  // Communication
  {
    provider: 'slack',
    name: 'Slack',
    shortDescription: 'Get notifications in Slack',
    description:
      'Connect Slack to receive Athena notifications in your workspace. Stay updated on tasks and deadlines without leaving Slack.',
    category: 'communication',
    scopes: [
      {
        id: 'chat:write',
        name: 'Send messages',
        description: 'Send notifications to channels and DMs',
      },
      {
        id: 'users:read',
        name: 'Read users',
        description: 'View your workspace members',
      },
    ],
  },
  {
    provider: 'zoom',
    name: 'Zoom',
    shortDescription: 'Schedule and join meetings',
    description:
      'Connect Zoom to schedule meetings directly from Athena. Link events to Zoom calls for seamless video conferencing.',
    category: 'communication',
    scopes: [
      {
        id: 'meeting:read',
        name: 'Read meetings',
        description: 'View your scheduled meetings',
      },
      {
        id: 'meeting:write',
        name: 'Create meetings',
        description: 'Schedule new Zoom meetings',
      },
    ],
  },

  // Storage
  {
    provider: 'google_drive',
    name: 'Google Drive',
    shortDescription: 'Link files to tasks',
    description:
      'Connect Google Drive to link files and documents to your tasks. Access your Drive files directly from Athena.',
    category: 'storage',
    scopes: [
      {
        id: 'drive.readonly',
        name: 'Read files',
        description: 'View your Drive files and folders',
      },
      {
        id: 'drive.file',
        name: 'Manage files',
        description: 'Create and edit files in Drive',
      },
    ],
  },
  {
    provider: 'dropbox',
    name: 'Dropbox',
    shortDescription: 'Link Dropbox files',
    description:
      'Connect Dropbox to link files and folders to your tasks. Keep your cloud storage integrated with your workflow.',
    category: 'storage',
    scopes: [
      {
        id: 'files.metadata.read',
        name: 'Read metadata',
        description: 'View file and folder names',
      },
      {
        id: 'files.content.read',
        name: 'Read files',
        description: 'Access file contents',
      },
    ],
  },

  // Design
  {
    provider: 'figma',
    name: 'Figma',
    shortDescription: 'Link design files',
    description:
      'Connect Figma to link design files and prototypes to your tasks. Keep your design work connected to your projects.',
    category: 'design',
    scopes: [
      {
        id: 'file_read',
        name: 'Read files',
        description: 'View your Figma files and projects',
      },
    ],
  },
];

/**
 * Get an integration config by provider ID.
 */
export function getIntegrationConfig(provider: string): IntegrationConfig | undefined {
  return INTEGRATIONS.find((i) => i.provider === provider);
}

/**
 * Get all integrations for a specific category.
 */
export function getIntegrationsByCategory(category: string): IntegrationConfig[] {
  return INTEGRATIONS.filter((i) => i.category === category);
}

/**
 * Get all unique categories from the registry.
 */
export function getCategories(): string[] {
  return [...new Set(INTEGRATIONS.map((i) => i.category))];
}

/**
 * Check if a provider is valid (exists in registry).
 */
export function isValidProvider(provider: string): provider is IntegrationProvider {
  return INTEGRATIONS.some((i) => i.provider === provider);
}
