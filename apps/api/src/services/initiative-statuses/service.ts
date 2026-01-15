/**
 * Initiative status service - business logic for custom initiative statuses.
 *
 * @packageDocumentation
 */

import { BaseService, type ServiceContext } from '../../lib/service.js';
import { InitiativeStatusRepository, type InitiativeStatusRecord } from './repository.js';
import {
  type InitiativeStatusCategory,
  type CreateInitiativeStatusInput,
  type UpdateInitiativeStatusInput,
  type ReorderInitiativeStatusesInput,
  DEFAULT_INITIATIVE_STATUSES,
  DEFAULT_STATUS_NAMES_BY_CATEGORY,
} from './schemas.js';

export interface GroupedInitiativeStatuses {
  planning: InitiativeStatusRecord[];
  active: InitiativeStatusRecord[];
  completed: InitiativeStatusRecord[];
  archived: InitiativeStatusRecord[];
}

export class InitiativeStatusService extends BaseService {
  private readonly repository: InitiativeStatusRepository;

  constructor(ctx: ServiceContext, repository?: InitiativeStatusRepository) {
    super(ctx);
    this.repository = repository ?? new InitiativeStatusRepository();
  }

  /**
   * List all custom statuses for a workspace.
   * If no workspace is specified, uses the user's default workspace.
   */
  async list(
    workspaceId?: string,
    category?: InitiativeStatusCategory,
  ): Promise<InitiativeStatusRecord[]> {
    const resolvedWorkspaceId = await this.resolveWorkspaceId(workspaceId);
    return this.repository.findMany({ workspaceId: resolvedWorkspaceId, category });
  }

  /**
   * List all statuses grouped by category.
   */
  async listGrouped(workspaceId?: string): Promise<GroupedInitiativeStatuses> {
    const statuses = await this.list(workspaceId);

    return {
      planning: statuses.filter((s) => s.category === 'planning'),
      active: statuses.filter((s) => s.category === 'active'),
      completed: statuses.filter((s) => s.category === 'completed'),
      archived: statuses.filter((s) => s.category === 'archived'),
    };
  }

  /**
   * Get a status by ID.
   */
  async get(id: string): Promise<InitiativeStatusRecord> {
    const status = await this.repository.findById(id);
    if (!status) {
      this.notFound('InitiativeStatus', id);
    }
    return status;
  }

  /**
   * Get the default status for a category.
   */
  async getDefaultForCategory(
    category: InitiativeStatusCategory,
    workspaceId?: string,
  ): Promise<InitiativeStatusRecord | null> {
    const resolvedWorkspaceId = await this.resolveWorkspaceId(workspaceId);
    return this.repository.findDefaultForCategory(resolvedWorkspaceId, category);
  }

  /**
   * Create a new custom status.
   */
  async create(input: CreateInitiativeStatusInput): Promise<InitiativeStatusRecord> {
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
  async update(id: string, input: UpdateInitiativeStatusInput): Promise<InitiativeStatusRecord> {
    const status = await this.repository.findById(id);
    if (!status) {
      this.notFound('InitiativeStatus', id);
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
   * Note: Initiatives using this status should be handled by the caller.
   */
  async delete(id: string): Promise<void> {
    const status = await this.repository.findById(id);
    if (!status) {
      this.notFound('InitiativeStatus', id);
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
  async reorder(input: ReorderInitiativeStatusesInput): Promise<InitiativeStatusRecord[]> {
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
  async setAsDefault(id: string, workspaceId?: string): Promise<InitiativeStatusRecord> {
    const status = await this.repository.findById(id);
    if (!status) {
      this.notFound('InitiativeStatus', id);
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
  async initializeDefaultStatuses(workspaceId: string): Promise<InitiativeStatusRecord[]> {
    // Check if workspace already has statuses
    const hasStatuses = await this.repository.hasStatuses(workspaceId);
    if (hasStatuses) {
      return this.repository.findMany({ workspaceId });
    }

    // Create default statuses with proper positions and defaults
    const statusesToCreate = DEFAULT_INITIATIVE_STATUSES.map((status) => {
      const categoryStatuses = DEFAULT_INITIATIVE_STATUSES.filter(
        (s) => s.category === status.category,
      );
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
 * Create an initiative status service instance for a service context.
 */
export function createInitiativeStatusService(ctx: ServiceContext): InitiativeStatusService {
  return new InitiativeStatusService(ctx);
}
