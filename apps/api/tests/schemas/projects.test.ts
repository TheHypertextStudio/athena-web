/**
 * Projects schema tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  projectStatusSchema,
  projectSchema,
  projectWithRelationsSchema,
  createProjectSchema,
  updateProjectSchema,
  projectQuerySchema,
} from '../../src/schemas/projects.js';

describe('Project Status Schema', () => {
  it('should accept planning status', () => {
    const result = projectStatusSchema.safeParse('planning');
    expect(result.success).toBe(true);
  });

  it('should accept active status', () => {
    const result = projectStatusSchema.safeParse('active');
    expect(result.success).toBe(true);
  });

  it('should accept on_hold status', () => {
    const result = projectStatusSchema.safeParse('on_hold');
    expect(result.success).toBe(true);
  });

  it('should accept completed status', () => {
    const result = projectStatusSchema.safeParse('completed');
    expect(result.success).toBe(true);
  });

  it('should accept cancelled status', () => {
    const result = projectStatusSchema.safeParse('cancelled');
    expect(result.success).toBe(true);
  });

  it('should reject invalid status', () => {
    const result = projectStatusSchema.safeParse('invalid_status');
    expect(result.success).toBe(false);
  });
});

describe('Project Schema', () => {
  const validProject = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Test Project',
    description: null,
    status: 'active',
    deadline: null,
    initiativeId: null,
    ownerId: '123e4567-e89b-12d3-a456-426614174001',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
  };

  it('should accept valid project', () => {
    const result = projectSchema.safeParse(validProject);
    expect(result.success).toBe(true);
  });

  it('should accept project with description', () => {
    const result = projectSchema.safeParse({
      ...validProject,
      description: 'A test project for unit testing',
    });
    expect(result.success).toBe(true);
  });

  it('should accept project with deadline', () => {
    const result = projectSchema.safeParse({
      ...validProject,
      deadline: '2026-12-31T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('should accept project with initiativeId', () => {
    const result = projectSchema.safeParse({
      ...validProject,
      initiativeId: '123e4567-e89b-12d3-a456-426614174002',
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing name', () => {
    const { name: _name, ...invalid } = validProject;
    const result = projectSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject empty name', () => {
    const result = projectSchema.safeParse({ ...validProject, name: '' });
    expect(result.success).toBe(false);
  });

  it('should reject name exceeding max length', () => {
    const result = projectSchema.safeParse({
      ...validProject,
      name: 'a'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing status', () => {
    const { status: _status, ...invalid } = validProject;
    const result = projectSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid status', () => {
    const result = projectSchema.safeParse({
      ...validProject,
      status: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('Project With Relations Schema', () => {
  const validProjectWithRelations = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Test Project',
    description: null,
    status: 'active',
    deadline: null,
    initiativeId: '123e4567-e89b-12d3-a456-426614174002',
    ownerId: '123e4567-e89b-12d3-a456-426614174001',
    createdAt: '2026-01-05T10:00:00Z',
    updatedAt: '2026-01-05T10:00:00Z',
    initiative: {
      id: '123e4567-e89b-12d3-a456-426614174002',
      name: 'Parent Initiative',
    },
    tasks: [
      {
        id: '123e4567-e89b-12d3-a456-426614174003',
        title: 'Task 1',
        status: 'pending',
      },
    ],
  };

  it('should accept project with initiative relation', () => {
    const result = projectWithRelationsSchema.safeParse(validProjectWithRelations);
    expect(result.success).toBe(true);
  });

  it('should accept project with null initiative', () => {
    const result = projectWithRelationsSchema.safeParse({
      ...validProjectWithRelations,
      initiative: null,
    });
    expect(result.success).toBe(true);
  });

  it('should accept project without initiative', () => {
    const { initiative: _initiative, ...noInitiative } = validProjectWithRelations;
    const result = projectWithRelationsSchema.safeParse(noInitiative);
    expect(result.success).toBe(true);
  });

  it('should accept project with empty tasks array', () => {
    const result = projectWithRelationsSchema.safeParse({
      ...validProjectWithRelations,
      tasks: [],
    });
    expect(result.success).toBe(true);
  });

  it('should accept project without tasks', () => {
    const { tasks: _tasks, ...noTasks } = validProjectWithRelations;
    const result = projectWithRelationsSchema.safeParse(noTasks);
    expect(result.success).toBe(true);
  });
});

describe('Create Project Schema', () => {
  it('should accept valid create request with name only', () => {
    const result = createProjectSchema.safeParse({
      name: 'New Project',
    });
    expect(result.success).toBe(true);
  });

  it('should accept create request with all fields', () => {
    const result = createProjectSchema.safeParse({
      name: 'New Project',
      description: 'Project description',
      status: 'planning',
      deadline: '2026-12-31T00:00:00Z',
      initiativeId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing name', () => {
    const result = createProjectSchema.safeParse({
      description: 'Some description',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty name', () => {
    const result = createProjectSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('should reject description exceeding max length', () => {
    const result = createProjectSchema.safeParse({
      name: 'Project',
      description: 'a'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid status', () => {
    const result = createProjectSchema.safeParse({
      name: 'Project',
      status: 'invalid_status',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid deadline format', () => {
    const result = createProjectSchema.safeParse({
      name: 'Project',
      deadline: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

describe('Update Project Schema', () => {
  it('should accept partial update with name', () => {
    const result = updateProjectSchema.safeParse({ name: 'Updated Name' });
    expect(result.success).toBe(true);
  });

  it('should accept partial update with status', () => {
    const result = updateProjectSchema.safeParse({ status: 'completed' });
    expect(result.success).toBe(true);
  });

  it('should accept partial update with description', () => {
    const result = updateProjectSchema.safeParse({ description: 'New description' });
    expect(result.success).toBe(true);
  });

  it('should accept null description to clear it', () => {
    const result = updateProjectSchema.safeParse({ description: null });
    expect(result.success).toBe(true);
  });

  it('should accept deadline update', () => {
    const result = updateProjectSchema.safeParse({ deadline: '2026-12-31T00:00:00Z' });
    expect(result.success).toBe(true);
  });

  it('should accept null deadline to clear it', () => {
    const result = updateProjectSchema.safeParse({ deadline: null });
    expect(result.success).toBe(true);
  });

  it('should accept null initiativeId to clear it', () => {
    const result = updateProjectSchema.safeParse({ initiativeId: null });
    expect(result.success).toBe(true);
  });

  it('should accept empty update', () => {
    const result = updateProjectSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept multiple fields at once', () => {
    const result = updateProjectSchema.safeParse({
      name: 'Updated',
      status: 'on_hold',
      description: 'Paused project',
    });
    expect(result.success).toBe(true);
  });
});

describe('Project Query Schema', () => {
  it('should accept valid initiativeId filter', () => {
    const result = projectQuerySchema.safeParse({
      initiativeId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('should accept empty query', () => {
    const result = projectQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should reject invalid UUID for initiativeId', () => {
    const result = projectQuerySchema.safeParse({
      initiativeId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});
