/**
 * Task service exports.
 *
 * @packageDocumentation
 */

export { TaskService } from './service.js';
export { TaskRepository, type TaskWithRelations, type TaskRecord } from './repository.js';
export {
  TaskStatus,
  TaskPriority,
  ListTasksInput,
  CreateTaskInput,
  UpdateTaskInput,
  TaskIdParam,
  TaskTagParams,
  TaskDependencyParams,
} from './schemas.js';
export type {
  TaskStatus as TaskStatusType,
  TaskPriority as TaskPriorityType,
  ListTasksInput as ListTasksInputType,
  CreateTaskInput as CreateTaskInputType,
  UpdateTaskInput as UpdateTaskInputType,
} from './schemas.js';
