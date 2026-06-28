/**
 * Project routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import { eq, and, inArray } from 'drizzle-orm';
import {
  ProjectIdParamSchema,
  ProjectDependencyParamsSchema,
  ListProjectsQuerySchema,
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  ProjectResponseSchema,
  ProjectListResponseSchema,
  ProjectDependenciesResponseSchema,
} from '@athena/types/openapi/projects';
import {
  ErrorResponseSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';
import { db } from '../db/index.js';
import { projects, projectDependencies, tasks, taskDependencies } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { TaskDependencyGraphQuerySchema, TaskDependencyGraphResponseSchema } from './projects/schemas.js';
import {
  toDependencyGraphTask,
  toProject,
  toProjectWithRelations,
} from './projects/serializers.js';

const projectRoutes = createOpenAPIApp();

projectRoutes.use('*', requireAuth);

const ERROR_PROJECT_NOT_FOUND = 'Project not found';
const ERROR_DEPENDENCY_PROJECT_NOT_FOUND = 'Dependency project not found';
const ERROR_SELF_DEPENDENCY = 'A project cannot depend on itself';
const ERROR_CIRCULAR_DEPENDENCY = 'Circular dependency detected';

// =============================================================================
// List Projects
// =============================================================================

const listProjects = createRoute({
  method: 'get',
  path: '/',
  tags: ['Projects'],
  summary: 'List projects',
  description: 'Retrieve a list of projects with optional filtering and pagination.',
  request: {
    query: ListProjectsQuerySchema,
  },
  responses: {
    200: {
      description: 'Projects retrieved successfully',
      content: {
        'application/json': {
          schema: ProjectListResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Project
// =============================================================================

const getProject = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Projects'],
  summary: 'Get a project',
  description: 'Retrieve a single project by its ID.',
  request: {
    params: ProjectIdParamSchema,
  },
  responses: {
    200: {
      description: 'Project retrieved successfully',
      content: {
        'application/json': {
          schema: ProjectResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Project
// =============================================================================

const createProject = createRoute({
  method: 'post',
  path: '/',
  tags: ['Projects'],
  summary: 'Create a project',
  description: 'Create a new project.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateProjectRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Project created successfully',
      content: {
        'application/json': {
          schema: ProjectResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Update Project
// =============================================================================

const updateProject = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Projects'],
  summary: 'Update a project',
  description: 'Update an existing project. Only provided fields will be updated.',
  request: {
    params: ProjectIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateProjectRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Project updated successfully',
      content: {
        'application/json': {
          schema: ProjectResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Project
// =============================================================================

const deleteProject = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Projects'],
  summary: 'Delete a project',
  description: 'Delete a project by its ID.',
  request: {
    params: ProjectIdParamSchema,
  },
  responses: {
    204: {
      description: 'Project deleted successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Task Dependency Graph
// =============================================================================

const getTaskDependencyGraph = createRoute({
  method: 'get',
  path: '/{id}/task-dependency-graph',
  tags: ['Projects'],
  summary: 'Get project task dependency graph',
  description: 'Retrieve tasks in a project and their dependency relationships.',
  request: {
    params: ProjectIdParamSchema,
    query: TaskDependencyGraphQuerySchema,
  },
  responses: {
    200: {
      description: 'Task dependency graph retrieved',
      content: {
        'application/json': {
          schema: TaskDependencyGraphResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Project Dependencies
// =============================================================================

const getProjectDependencies = createRoute({
  method: 'get',
  path: '/{id}/dependencies',
  tags: ['Projects'],
  summary: 'Get project dependencies',
  description: 'Retrieve all projects that this project depends on.',
  request: {
    params: ProjectIdParamSchema,
  },
  responses: {
    200: {
      description: 'Dependencies retrieved successfully',
      content: {
        'application/json': {
          schema: ProjectDependenciesResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Add Project Dependency
// =============================================================================

const addProjectDependency = createRoute({
  method: 'post',
  path: '/{id}/dependencies/{dependsOnId}',
  tags: ['Projects'],
  summary: 'Add project dependency',
  description: 'Add a dependency relationship between two projects.',
  request: {
    params: ProjectDependencyParamsSchema,
  },
  responses: {
    201: {
      description: 'Dependency added successfully',
    },
    400: {
      description: 'Invalid dependency (e.g., circular dependency)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Remove Project Dependency
// =============================================================================

const removeProjectDependency = createRoute({
  method: 'delete',
  path: '/{id}/dependencies/{dependsOnId}',
  tags: ['Projects'],
  summary: 'Remove project dependency',
  description: 'Remove a dependency relationship between two projects.',
  request: {
    params: ProjectDependencyParamsSchema,
  },
  responses: {
    204: {
      description: 'Dependency removed successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Project or dependency not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * List all projects for the authenticated user.
 * GET /api/projects
 */
projectRoutes.openapi(listProjects, async (c) => {
  const userId = getUserId(c);
  const { initiativeId, status } = c.req.valid('query');

  const conditions = [eq(projects.ownerId, userId)];

  if (initiativeId) {
    conditions.push(eq(projects.initiativeId, initiativeId));
  }

  if (status) {
    conditions.push(eq(projects.status, status));
  }

  const result = await db.query.projects.findMany({
    where: and(...conditions),
    with: {
      initiative: true,
      tasks: true,
    },
    orderBy: (projects, { desc }) => [desc(projects.createdAt)],
  });

  return c.json({ data: result.map(toProjectWithRelations) }, 200);
});

/**
 * Get a single project by ID.
 * GET /api/projects/:id
 */
projectRoutes.openapi(getProject, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const result = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, userId)),
    with: {
      initiative: true,
      tasks: {
        with: {
          assignee: true,
          tags: {
            with: {
              tag: true,
            },
          },
        },
      },
    },
  });

  if (!result) {
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
  }

  return c.json({ data: toProjectWithRelations(result) }, 200);
});

/**
 * Create a new project.
 * POST /api/projects
 */
projectRoutes.openapi(createProject, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(projects).values({
    id,
    name: body.name,
    description: body.description,
    status: body.status,
    deadline: body.deadline ?? null,
    initiativeId: body.initiativeId,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.projects.findFirst({
    where: eq(projects.id, id),
    with: {
      initiative: true,
    },
  });

  if (!result) {
    throw new Error('Failed to create project');
  }

  return c.json({ data: toProjectWithRelations(result) }, 201);
});

/**
 * Update a project.
 * PATCH /api/projects/:id
 */
projectRoutes.openapi(updateProject, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
  }

  const updateData: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.deadline !== undefined) {
    updateData.deadline = body.deadline ?? null;
  }
  if (body.initiativeId !== undefined) updateData.initiativeId = body.initiativeId;

  await db
    .update(projects)
    .set(updateData)
    .where(and(eq(projects.id, id), eq(projects.ownerId, userId)));

  const result = await db.query.projects.findFirst({
    where: eq(projects.id, id),
    with: {
      initiative: true,
    },
  });

  if (!result) {
    throw new Error('Failed to update project');
  }

  return c.json({ data: toProjectWithRelations(result) }, 200);
});

/**
 * Delete a project.
 * DELETE /api/projects/:id
 */
projectRoutes.openapi(deleteProject, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
  }

  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.ownerId, userId)));

  return c.body(null, 204);
});

/**
 * Get task dependency graph for a project.
 * Returns all tasks in the project and their dependency relationships.
 * GET /api/projects/:id/task-dependency-graph
 */
projectRoutes.openapi(getTaskDependencyGraph, async (c) => {
  const userId = getUserId(c);
  const { id: projectId } = c.req.valid('param');
  const { includeCompleted } = c.req.valid('query');

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, userId)),
  });

  if (!project) {
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
  }

  // Fetch all tasks for this project
  const projectTasks = await db.query.tasks.findMany({
    where: and(eq(tasks.projectId, projectId), eq(tasks.creatorId, userId)),
    with: {
      assignee: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  // Filter out completed tasks if not requested
  const filteredTasks = includeCompleted
    ? projectTasks
    : projectTasks.filter((t) => t.status !== 'completed');

  const taskIds = filteredTasks.map((t) => t.id);
  const taskIdSet = new Set(taskIds);

  // Fetch dependencies where both source and target are in this project's tasks
  const projectDeps =
    taskIds.length > 0
      ? (
          await db.query.taskDependencies.findMany({
            where: inArray(taskDependencies.taskId, taskIds),
          })
        ).filter((d) => taskIdSet.has(d.dependsOnTaskId))
      : [];

  return c.json(
    {
      data: {
        tasks: filteredTasks.map(toDependencyGraphTask),
        dependencies: projectDeps.map((d) => ({
          taskId: d.taskId,
          dependsOnTaskId: d.dependsOnTaskId,
        })),
      },
    },
    200,
  );
});

/**
 * Get project dependencies.
 * GET /api/projects/:id/dependencies
 */
projectRoutes.openapi(getProjectDependencies, async (c) => {
  const userId = getUserId(c);
  const { id: projectId } = c.req.valid('param');

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, userId)),
  });

  if (!project) {
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
  }

  const dependencies = await db.query.projectDependencies.findMany({
    where: eq(projectDependencies.projectId, projectId),
    with: {
      dependsOnProject: true,
    },
  });

  return c.json(
    {
      data: dependencies.map((d) => toProject(d.dependsOnProject)),
    },
    200,
  );
});

/**
 * Add a dependency to a project.
 * POST /api/projects/:id/dependencies/:dependsOnId
 */
projectRoutes.openapi(addProjectDependency, async (c) => {
  const userId = getUserId(c);
  const { id: projectId, dependsOnId } = c.req.valid('param');

  // Prevent self-dependency
  if (projectId === dependsOnId) {
    return c.json({ error: ERROR_SELF_DEPENDENCY }, 400);
  }

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, userId)),
  });

  if (!project) {
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
  }

  const dependsOnProject = await db.query.projects.findFirst({
    where: and(eq(projects.id, dependsOnId), eq(projects.ownerId, userId)),
  });

  if (!dependsOnProject) {
    return c.json({ error: ERROR_DEPENDENCY_PROJECT_NOT_FOUND }, 404);
  }

  // Check for circular dependency
  const reverseCheck = await db.query.projectDependencies.findFirst({
    where: and(
      eq(projectDependencies.projectId, dependsOnId),
      eq(projectDependencies.dependsOnProjectId, projectId),
    ),
  });

  if (reverseCheck) {
    return c.json({ error: ERROR_CIRCULAR_DEPENDENCY }, 400);
  }

  const id = crypto.randomUUID();
  await db
    .insert(projectDependencies)
    .values({
      id,
      projectId,
      dependsOnProjectId: dependsOnId,
      createdAt: new Date(),
    })
    .onConflictDoNothing();

  return c.body(null, 201);
});

/**
 * Remove a dependency from a project.
 * DELETE /api/projects/:id/dependencies/:dependsOnId
 */
projectRoutes.openapi(removeProjectDependency, async (c) => {
  const userId = getUserId(c);
  const { id: projectId, dependsOnId } = c.req.valid('param');

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, userId)),
  });

  if (!project) {
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
  }

  await db
    .delete(projectDependencies)
    .where(
      and(
        eq(projectDependencies.projectId, projectId),
        eq(projectDependencies.dependsOnProjectId, dependsOnId),
      ),
    );

  return c.body(null, 204);
});

export { projectRoutes };
