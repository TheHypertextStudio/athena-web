/**
 * Task status service - business logic for custom task statuses.
 *
 * @packageDocumentation
 */

import { BaseService, type ServiceContext } from '../../lib/service.js';
import { TaskStatusRepository, type TaskStatusRecord } from './repository.js';
import {
  type TaskStatusCategory,
  type CreateTaskStatusInput,
  type UpdateTaskStatusInput,
  type ReorderTaskStatusesInput,
  DEFAULT_TASK_STATUSES,
  DEFAULT_STATUS_NAMES_BY_CATEGORY,
} from './schemas.js';

export interface GroupedTaskStatuses {
  not_started: TaskStatusRecord[];
  in_progress: TaskStatusRecord[];
  done: TaskStatusRecord[];
  cancelled: TaskStatusRecord[];
}

export class TaskStatusService extends BaseService {
  private readonly repository: TaskStatusRepository;

  constructor(ctx: ServiceContext, repository?: TaskStatusRepository) {
    super(ctx);
    this.repository = repository ?? new TaskStatusRepository();
  }

  /**
   * List all custom statuses for a workspace.
   * If no workspace is specified, uses the user's default workspace.
   */
  async list(workspaceId?: string, category?: TaskStatusCategory): Promise<TaskStatusRecord[]> {
    const resolvedWorkspaceId = await this.resolveWorkspaceId(workspaceId);
    return this.repository.findMany({ workspaceId: resolvedWorkspaceId, category });
  }

  /**
   * List all statuses grouped by category.
   */
  async listGrouped(workspaceId?: string): Promise<GroupedTaskStatuses> {
    const statuses = await this.list(workspaceId);

    return {
      not_started: statuses.filter((s) => s.category === 'not_started'),
      in_progress: statuses.filter((s) => s.category === 'in_progress'),
      done: statuses.filter((s) => s.category === 'done'),
      cancelled: statuses.filter((s) => s.category === 'cancelled'),
    };
  }

  /**
   * Get a status by ID.
   */
  async get(id: string): Promise<TaskStatusRecord> {
    const status = await this.repository.findById(id);
    if (!status) {
      this.notFound('TaskStatus', id);
    }
    return status;
  }

  /**
   * Get the default status for a category.
   */
  async getDefaultForCategory(
    category: TaskStatusCategory,
    workspaceId?: string,
  ): Promise<TaskStatusRecord | null> {
    const resolvedWorkspaceId = await this.resolveWorkspaceId(workspaceId);
    return this.repository.findDefaultForCategory(resolvedWorkspaceId, category);
  }

  /**
   * Create a new custom status.
   */
  async create(input: CreateTaskStatusInput): Promise<TaskStatusRecord> {
    const workspaceId = await this.resolveWorkspaceId(input.workspaceId);

    // Get the next position for this category
    const position = await this.repository.getNextPosition(workspaceId, input.category);

    // Check if there's already a default for this category
    const existingDefault = await this.repository.findDefaultForCategory(
      workspaceId,
      input.category,
    );
    const isDefault = !existingDefault;

    return this.repository.create({
      id: crypto.randomUUID(),
      workspaceId,
      name: input.name,
      description: input.description,
      category: input.category,
      color: input.color,
      icon: input.icon,
      position,
      isDefault,
    });
  }

  /**
   * Update a status.
   */
  async update(id: string, input: UpdateTaskStatusInput): Promise<TaskStatusRecord> {
    const status = await this.repository.findById(id);
    if (!status) {
      this.notFound('TaskStatus', id);
    }

    const updated = await this.repository.update(id, {
      name: input.name,
      description: input.description,
      color: input.color,
      icon: input.icon,
    });

    if (!updated) {
      throw new Error(`Failed to update status: ${id}`);
    }

    return updated;
  }

  /**
   * Delete a status.
   * Note: Tasks using this status should be handled by the caller.
   */
  async delete(id: string): Promise<void> {
    const status = await this.repository.findById(id);
    if (!status) {
      this.notFound('TaskStatus', id);
    }

    // If this was the default, we need to set another status as default
    if (status.isDefault) {
      const otherStatuses = await this.repository.findMany({
        workspaceId: status.workspaceId,
        category: status.category,
      });

      const newDefault = otherStatuses.find((s) => s.id !== id);
      if (newDefault) {
        await this.repository.setAsDefault(newDefault.id, status.workspaceId, status.category);
      }
    }

    const deleted = await this.repository.delete(id);
    if (!deleted) {
      throw new Error(`Failed to delete status: ${id}`);
    }
  }

  /**
   * Reorder statuses within a category.
   */
  async reorder(input: ReorderTaskStatusesInput): Promise<TaskStatusRecord[]> {
    const workspaceId = await this.resolveWorkspaceId(input.workspaceId);

    // Update positions based on the order in statusIds
    await Promise.all(
      input.statusIds.map((statusId, index) => this.repository.updatePosition(statusId, index)),
    );

    // Return the updated list
    return this.repository.findMany({ workspaceId, category: input.category });
  }

  /**
   * Set a status as the default for its category.
   */
  async setAsDefault(id: string, workspaceId?: string): Promise<TaskStatusRecord> {
    const status = await this.repository.findById(id);
    if (!status) {
      this.notFound('TaskStatus', id);
    }

    const resolvedWorkspaceId = workspaceId ?? status.workspaceId;
    await this.repository.setAsDefault(id, resolvedWorkspaceId, status.category);

    // Return the updated status
    const updated = await this.repository.findById(id);
    if (!updated) {
      throw new Error(`Failed to retrieve updated status: ${id}`);
    }

    return updated;
  }

  /**
   * Initialize default statuses for a workspace.
   * Called when creating a new workspace.
   */
  async initializeDefaultStatuses(workspaceId: string): Promise<TaskStatusRecord[]> {
    // Check if workspace already has statuses
    const hasStatuses = await this.repository.hasStatuses(workspaceId);
    if (hasStatuses) {
      return this.repository.findMany({ workspaceId });
    }

    // Create default statuses with proper positions and defaults
    const statusesToCreate = DEFAULT_TASK_STATUSES.map((status) => {
      const categoryStatuses = DEFAULT_TASK_STATUSES.filter((s) => s.category === status.category);
      const positionInCategory = categoryStatuses.indexOf(status);

      return {
        id: crypto.randomUUID(),
        workspaceId,
        name: status.name,
        description: status.description,
        category: status.category,
        color: status.color,
        icon: status.icon,
        position: positionInCategory,
        isDefault: status.name === DEFAULT_STATUS_NAMES_BY_CATEGORY[status.category],
      };
    });

    return this.repository.createMany(statusesToCreate);
  }

  /**
   * Resolve workspace ID, using user's default workspace if not specified.
   */
  private async resolveWorkspaceId(workspaceId?: string): Promise<string> {
    if (workspaceId) return workspaceId;

    const defaultWorkspaceId = await this.repository.getDefaultWorkspaceId(this.userId);
    if (!defaultWorkspaceId) {
      throw new Error('No workspace found for user');
    }

    return defaultWorkspaceId;
  }
}

/**
 * Create a task status service instance for a service context.
 */
export function createTaskStatusService(ctx: ServiceContext): TaskStatusService {
  return new TaskStatusService(ctx);
}
