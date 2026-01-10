/**
 * Base service pattern for all application services.
 *
 * @packageDocumentation
 */

import { NotFoundError, UnauthorizedError, ForbiddenError, BusinessRuleError } from './errors.js';

/**
 * Context passed to all services.
 * Contains information about the current request/user.
 */
export interface ServiceContext {
  /** The authenticated user's ID */
  userId: string;
  /** Optional request ID for tracing */
  requestId?: string;
}

/**
 * Standard pagination parameters.
 */
export interface PaginationParams {
  limit: number;
  offset: number;
}

/**
 * Standard paginated result wrapper.
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Base class for all application services.
 *
 * Provides common utilities for error handling and context access.
 * All services should extend this class.
 *
 * @example
 * ```typescript
 * export class TaskService extends BaseService {
 *   async getTask(id: string): Promise<Task> {
 *     const task = await this.repository.findById(id);
 *     if (!task) {
 *       this.notFound('Task', id);
 *     }
 *     if (task.userId !== this.ctx.userId) {
 *       this.forbidden();
 *     }
 *     return task;
 *   }
 * }
 * ```
 */
export abstract class BaseService {
  protected readonly ctx: ServiceContext;

  constructor(ctx: ServiceContext) {
    this.ctx = ctx;
  }

  /**
   * Get the current user's ID.
   */
  protected get userId(): string {
    return this.ctx.userId;
  }

  /**
   * Throw a NotFoundError. This method never returns.
   */
  protected notFound(entity: string, id: string): never {
    throw new NotFoundError(entity, id);
  }

  /**
   * Throw an UnauthorizedError. This method never returns.
   */
  protected unauthorized(message?: string): never {
    throw new UnauthorizedError(message);
  }

  /**
   * Throw a ForbiddenError. This method never returns.
   */
  protected forbidden(message?: string): never {
    throw new ForbiddenError(message);
  }

  /**
   * Throw a BusinessRuleError. This method never returns.
   */
  protected businessRule(code: string, message: string): never {
    throw new BusinessRuleError(code, message);
  }

  /**
   * Create a paginated result from a data array and total count.
   */
  protected paginate<T>(data: T[], total: number, params: PaginationParams): PaginatedResult<T> {
    return {
      data,
      total,
      limit: params.limit,
      offset: params.offset,
      hasMore: params.offset + data.length < total,
    };
  }
}

/**
 * Create a service context from route handler context.
 *
 * @example
 * ```typescript
 * taskRoutes.get('/:id', requireAuth, async (c) => {
 *   const ctx = createServiceContext(c);
 *   const service = new TaskService(ctx);
 *   const task = await service.get(c.req.param('id'));
 *   return c.json({ data: task });
 * });
 * ```
 */
export function createServiceContext(c: {
  get: (key: string) => unknown;
  req: { header: (name: string) => string | undefined };
}): ServiceContext {
  const userId = c.get('userId');
  if (typeof userId !== 'string') {
    throw new UnauthorizedError('User ID not found in context');
  }

  return {
    userId,
    requestId: c.req.header('x-request-id'),
  };
}
