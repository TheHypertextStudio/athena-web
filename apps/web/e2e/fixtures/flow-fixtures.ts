/**
 * Flow visualization test fixtures and mocks.
 *
 * Provides test data for task dependency graphs, project roadmaps,
 * and workflow status visualizations.
 */

import type { Page, Route } from '@playwright/test';

// =============================================================================
// Test Data - Tasks
// =============================================================================

export const TEST_TASKS = [
  {
    id: 'task-1',
    title: 'Research API specs',
    status: 'completed',
    priority: 'high',
    assigneeId: null,
    deadline: '2026-01-15T00:00:00.000Z',
    description: 'Research API specifications',
    workspaceId: 'workspace-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
  },
  {
    id: 'task-2',
    title: 'Implement endpoints',
    status: 'in_progress',
    priority: 'high',
    assigneeId: 'test-user-123',
    deadline: '2026-01-20T00:00:00.000Z',
    description: 'Implement the API endpoints',
    workspaceId: 'workspace-1',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-11T00:00:00.000Z',
  },
  {
    id: 'task-3',
    title: 'Write unit tests',
    status: 'pending',
    priority: 'medium',
    assigneeId: null,
    deadline: '2026-01-25T00:00:00.000Z',
    description: 'Write tests for the endpoints',
    workspaceId: 'workspace-1',
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
  },
  {
    id: 'task-4',
    title: 'Deploy to staging',
    status: 'pending',
    priority: 'low',
    assigneeId: null,
    deadline: '2026-01-30T00:00:00.000Z',
    description: 'Deploy to staging environment',
    workspaceId: 'workspace-1',
    createdAt: '2026-01-04T00:00:00.000Z',
    updatedAt: '2026-01-04T00:00:00.000Z',
  },
] as const;

export const TEST_DEPENDENCIES = {
  'task-2': [TEST_TASKS[0]], // task-2 depends on task-1
  'task-3': [TEST_TASKS[1]], // task-3 depends on task-2
  'task-4': [TEST_TASKS[1], TEST_TASKS[2]], // task-4 depends on task-2 and task-3
} as const;

// =============================================================================
// Test Data - Initiatives and Projects
// =============================================================================

export const TEST_INITIATIVES = [
  {
    id: 'initiative-1',
    name: 'Platform Modernization',
    description: 'Modernize the platform infrastructure',
    status: 'active',
    startDate: '2026-01-01T00:00:00.000Z',
    targetDate: '2026-06-30T00:00:00.000Z',
    workspaceId: 'workspace-1',
    parentId: null,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
  },
  {
    id: 'initiative-2',
    name: 'Mobile Experience',
    description: 'Improve mobile user experience',
    status: 'planning',
    startDate: '2026-04-01T00:00:00.000Z',
    targetDate: '2026-09-30T00:00:00.000Z',
    workspaceId: 'workspace-1',
    parentId: null,
    createdAt: '2025-12-15T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
  },
] as const;

export const TEST_PROJECTS = [
  {
    id: 'project-1',
    name: 'API Redesign',
    description: 'Redesign the core API',
    status: 'active',
    progress: 60,
    initiativeId: 'initiative-1',
    workspaceId: 'workspace-1',
    startDate: '2026-01-15T00:00:00.000Z',
    targetDate: '2026-03-30T00:00:00.000Z',
    dependsOnProjectId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
  },
  {
    id: 'project-2',
    name: 'Database Migration',
    description: 'Migrate to new database',
    status: 'planning',
    progress: 0,
    initiativeId: 'initiative-1',
    workspaceId: 'workspace-1',
    startDate: '2026-04-01T00:00:00.000Z',
    targetDate: '2026-06-15T00:00:00.000Z',
    dependsOnProjectId: 'project-1',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
  },
  {
    id: 'project-3',
    name: 'Mobile App Refresh',
    description: 'Update mobile app design',
    status: 'planning',
    progress: 0,
    initiativeId: 'initiative-2',
    workspaceId: 'workspace-1',
    startDate: '2026-04-01T00:00:00.000Z',
    targetDate: '2026-07-30T00:00:00.000Z',
    dependsOnProjectId: null,
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
  },
] as const;

// =============================================================================
// Test Data - Task Statuses
// =============================================================================

export const TEST_TASK_STATUSES = [
  {
    id: 'status-1',
    name: 'Backlog',
    category: 'not_started',
    color: '#6B7280',
    isDefault: true,
    position: 0,
    workspaceId: 'workspace-1',
  },
  {
    id: 'status-2',
    name: 'To Do',
    category: 'not_started',
    color: '#9CA3AF',
    isDefault: false,
    position: 1,
    workspaceId: 'workspace-1',
  },
  {
    id: 'status-3',
    name: 'In Progress',
    category: 'in_progress',
    color: '#3B82F6',
    isDefault: true,
    position: 0,
    workspaceId: 'workspace-1',
  },
  {
    id: 'status-4',
    name: 'In Review',
    category: 'in_progress',
    color: '#8B5CF6',
    isDefault: false,
    position: 1,
    workspaceId: 'workspace-1',
  },
  {
    id: 'status-5',
    name: 'Done',
    category: 'done',
    color: '#10B981',
    isDefault: true,
    position: 0,
    workspaceId: 'workspace-1',
  },
  {
    id: 'status-6',
    name: 'Cancelled',
    category: 'cancelled',
    color: '#EF4444',
    isDefault: true,
    position: 0,
    workspaceId: 'workspace-1',
  },
] as const;

// =============================================================================
// Mock Route Handlers
// =============================================================================

/**
 * Mock all flow-related API endpoints.
 */
export async function mockFlowApiRoutes(page: Page): Promise<void> {
  // Tasks list
  await page.route('**/api/tasks', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: TEST_TASKS }),
      });
    } else {
      await route.continue();
    }
  });

  // Individual task
  await page.route('**/api/tasks/*', async (route: Route) => {
    const url = route.request().url();
    const taskIdMatch = /\/api\/tasks\/([^/]+)(?:\/|$)/.exec(url);

    if (!taskIdMatch?.[1]) {
      await route.continue();
      return;
    }

    const taskId = taskIdMatch[1];

    // Handle dependencies endpoint
    if (url.includes('/dependencies')) {
      const dependencyKey = taskId as keyof typeof TEST_DEPENDENCIES;
      const dependencies =
        dependencyKey in TEST_DEPENDENCIES ? TEST_DEPENDENCIES[dependencyKey] : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: dependencies }),
      });
      return;
    }

    // Handle individual task fetch
    const task = TEST_TASKS.find((t) => t.id === taskId);
    if (task) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: task }),
      });
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Task not found' }),
      });
    }
  });

  // Initiatives
  await page.route('**/api/initiatives', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: TEST_INITIATIVES }),
    });
  });

  // Projects
  await page.route('**/api/projects', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: TEST_PROJECTS }),
    });
  });

  // Task statuses
  await page.route('**/api/settings/task-statuses', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: TEST_TASK_STATUSES }),
    });
  });
}

// =============================================================================
// ReactFlow Helpers
// =============================================================================

/**
 * Wait for ReactFlow to be fully loaded and rendered.
 */
export async function waitForReactFlowReady(page: Page): Promise<void> {
  // Wait for the ReactFlow viewport to exist
  await page.waitForSelector('.react-flow__viewport', { timeout: 10000 });

  // Wait for at least one node to be rendered
  await page.waitForSelector('.react-flow__node', { timeout: 10000 });
}

/**
 * Get the count of nodes currently rendered in ReactFlow.
 */
export async function getNodeCount(page: Page): Promise<number> {
  return page.locator('.react-flow__node').count();
}

/**
 * Get the count of edges currently rendered in ReactFlow.
 */
export async function getEdgeCount(page: Page): Promise<number> {
  return page.locator('.react-flow__edge').count();
}

/**
 * Check if ReactFlow controls are visible.
 */
export async function areControlsVisible(page: Page): Promise<boolean> {
  const controls = page.locator('.react-flow__controls');
  return controls.isVisible();
}

/**
 * Check if ReactFlow minimap is visible.
 */
export async function isMinimapVisible(page: Page): Promise<boolean> {
  const minimap = page.locator('.react-flow__minimap');
  return minimap.isVisible();
}

/**
 * Click the fit view button in ReactFlow controls.
 */
export async function clickFitView(page: Page): Promise<void> {
  const fitButton = page.locator('button[title="Fit to view"]');
  await fitButton.click();
}

/**
 * Click on a specific node by its ID.
 */
export async function clickNode(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-id="${nodeId}"]`);
  await node.click();
}
