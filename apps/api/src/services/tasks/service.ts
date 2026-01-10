/**
 * Task service - business logic for task operations.
 *
 * @packageDocumentation
 */

import { BaseService, type ServiceContext } from '../../lib/service.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { TaskRepository, type TaskWithRelations, type TaskRecord } from './repository.js';
import type { ListTasksInput, CreateTaskInput, UpdateTaskInput } from './schemas.js';

export class TaskService extends BaseService {
  private readonly repository: TaskRepository;

  constructor(ctx: ServiceContext, repository?: TaskRepository) {
    super(ctx);
    this.repository = repository ?? new TaskRepository();
  }

  async list(input: ListTasksInput): Promise<TaskWithRelations[]> {
    return this.repository.findMany({
      userId: this.userId,
      projectId: input.projectId,
      status: input.status,
      priority: input.priority,
      limit: input.limit,
      offset: input.offset,
    });
  }

  async get(id: string): Promise<TaskWithRelations> {
    const task = await this.repository.findById(id, this.userId);
    if (!task) {
      this.notFound('Task', id);
    }
    return task;
  }

  async create(input: CreateTaskInput): Promise<TaskWithRelations> {
    const id = crypto.randomUUID();

    await this.repository.create({
      id,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      deadline: input.deadline,
      estimatedMinutes: input.estimatedMinutes,
      projectId: input.projectId,
      assigneeId: input.assigneeId,
      creatorId: this.userId,
    });

    if (input.tagIds && input.tagIds.length > 0) {
      await this.repository.addTags(id, input.tagIds);
    }

    const created = await this.repository.findById(id, this.userId);
    if (!created) {
      throw new Error('Failed to create task');
    }
    return created;
  }

  async update(id: string, input: UpdateTaskInput): Promise<TaskWithRelations> {
    const existing = await this.repository.findById(id, this.userId);
    if (!existing) {
      this.notFound('Task', id);
    }

    await this.repository.update(id, {
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      deadline: input.deadline,
      estimatedMinutes: input.estimatedMinutes,
      projectId: input.projectId,
      assigneeId: input.assigneeId,
    });

    if (input.tagIds !== undefined) {
      await this.repository.replaceTags(id, input.tagIds);
    }

    const updated = await this.repository.findById(id, this.userId);
    if (!updated) {
      throw new Error('Failed to update task');
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.findByIdAsCreator(id, this.userId);
    if (!existing) {
      this.notFound('Task', id);
    }
    await this.repository.delete(id);
  }

  async addTag(taskId: string, tagId: string): Promise<void> {
    const task = await this.repository.findById(taskId, this.userId);
    if (!task) {
      this.notFound('Task', taskId);
    }

    const tag = await this.repository.findTagByOwner(tagId, this.userId);
    if (!tag) {
      this.notFound('Tag', tagId);
    }

    await this.repository.addTag(taskId, tagId);
  }

  async removeTag(taskId: string, tagId: string): Promise<void> {
    const task = await this.repository.findById(taskId, this.userId);
    if (!task) {
      this.notFound('Task', taskId);
    }
    await this.repository.removeTag(taskId, tagId);
  }

  async getDependencies(taskId: string): Promise<TaskRecord[]> {
    const task = await this.repository.findById(taskId, this.userId);
    if (!task) {
      this.notFound('Task', taskId);
    }
    return this.repository.findDependencies(taskId);
  }

  async addDependency(taskId: string, dependsOnId: string): Promise<void> {
    if (taskId === dependsOnId) {
      throw new BusinessRuleError('SELF_DEPENDENCY', 'A task cannot depend on itself');
    }

    const task = await this.repository.findById(taskId, this.userId);
    if (!task) {
      this.notFound('Task', taskId);
    }

    const dependsOnTask = await this.repository.findById(dependsOnId, this.userId);
    if (!dependsOnTask) {
      this.notFound('Task', dependsOnId);
    }

    const hasReverse = await this.repository.hasDependency(dependsOnId, taskId);
    if (hasReverse) {
      throw new BusinessRuleError('CIRCULAR_DEPENDENCY', 'Circular dependency detected');
    }

    const id = crypto.randomUUID();
    await this.repository.addDependency(id, taskId, dependsOnId);
  }

  async removeDependency(taskId: string, dependsOnId: string): Promise<void> {
    const task = await this.repository.findById(taskId, this.userId);
    if (!task) {
      this.notFound('Task', taskId);
    }
    await this.repository.removeDependency(taskId, dependsOnId);
  }
}
