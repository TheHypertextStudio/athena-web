/**
 * Analytics service for productivity metrics.
 *
 * @packageDocumentation
 */

import { db } from '../../db/index.js';
import { tasks, projects, timeEntries } from '../../db/schema/index.js';
import { eq, and, or, gte, lte, isNull } from 'drizzle-orm';
import type {
  AnalyticsOptions,
  AnalyticsPeriod,
  TaskMetrics,
  ProjectMetrics,
  TimeMetrics,
  ProductivityMetrics,
  DashboardSummary,
} from './types.js';

/**
 * Analytics service for productivity insights.
 */
export class AnalyticsService {
  /**
   * Get dashboard summary.
   */
  async getDashboard(options: AnalyticsOptions): Promise<DashboardSummary> {
    const { dateFrom, dateTo } = this.getDateRange(
      options.period,
      options.dateFrom,
      options.dateTo,
    );

    const [taskMetrics, projectMetrics, timeMetrics, productivityMetrics] = await Promise.all([
      this.getTaskMetrics({ ...options, dateFrom, dateTo }),
      this.getProjectMetrics({ ...options, dateFrom, dateTo }),
      this.getTimeMetrics({ ...options, dateFrom, dateTo }),
      this.getProductivityMetrics({ ...options, dateFrom, dateTo }),
    ]);

    return {
      period: options.period,
      dateFrom,
      dateTo,
      tasks: taskMetrics,
      projects: projectMetrics,
      time: timeMetrics,
      productivity: productivityMetrics,
    };
  }

  /**
   * Get task metrics.
   */
  async getTaskMetrics(
    options: AnalyticsOptions & { dateFrom: Date; dateTo: Date },
  ): Promise<TaskMetrics> {
    const { userId, dateFrom, dateTo, projectId } = options;

    const conditions = [
      or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      isNull(tasks.deletedAt),
      gte(tasks.createdAt, dateFrom),
      lte(tasks.createdAt, dateTo),
    ];

    if (projectId) {
      conditions.push(eq(tasks.projectId, projectId));
    }

    const allTasks = await db.query.tasks.findMany({
      where: and(...conditions),
      columns: {
        id: true,
        status: true,
        deadline: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const now = new Date();
    const completed = allTasks.filter((t) => t.status === 'completed');
    const pending = allTasks.filter((t) => t.status === 'pending');
    const inProgress = allTasks.filter((t) => t.status === 'in_progress');
    const cancelled = allTasks.filter((t) => t.status === 'cancelled');
    const overdue = allTasks.filter(
      (t) => t.deadline && t.deadline < now && t.status !== 'completed' && t.status !== 'cancelled',
    );

    // Calculate average completion time (using updatedAt as proxy for completion time)
    let avgCompletionTime: number | null = null;
    const completionTimes = completed.map((t) => {
      const created = t.createdAt.getTime();
      // Use updatedAt as proxy for completion time since there's no completedAt field
      const completedTime = t.updatedAt.getTime();
      return (completedTime - created) / (1000 * 60 * 60); // hours
    });

    if (completionTimes.length > 0) {
      avgCompletionTime = completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length;
    }

    return {
      total: allTasks.length,
      completed: completed.length,
      pending: pending.length,
      inProgress: inProgress.length,
      cancelled: cancelled.length,
      overdue: overdue.length,
      completionRate: allTasks.length > 0 ? completed.length / allTasks.length : 0,
      avgCompletionTime,
    };
  }

  /**
   * Get project metrics.
   */
  async getProjectMetrics(
    options: AnalyticsOptions & { dateFrom: Date; dateTo: Date },
  ): Promise<ProjectMetrics> {
    const { userId } = options;

    const allProjects = await db.query.projects.findMany({
      where: and(eq(projects.ownerId, userId), isNull(projects.deletedAt)),
      columns: {
        id: true,
        name: true,
        status: true,
      },
    });

    // Get task counts by project
    const tasksByProject = await Promise.all(
      allProjects.map(async (project) => {
        const projectTasks = await db.query.tasks.findMany({
          where: and(eq(tasks.projectId, project.id), isNull(tasks.deletedAt)),
          columns: { id: true, status: true },
        });

        return {
          projectId: project.id,
          projectName: project.name,
          totalTasks: projectTasks.length,
          completedTasks: projectTasks.filter((t) => t.status === 'completed').length,
        };
      }),
    );

    return {
      total: allProjects.length,
      active: allProjects.filter((p) => p.status === 'active').length,
      completed: allProjects.filter((p) => p.status === 'completed').length,
      onHold: allProjects.filter((p) => p.status === 'on_hold').length,
      tasksByProject: tasksByProject.sort((a, b) => b.totalTasks - a.totalTasks).slice(0, 10),
    };
  }

  /**
   * Get time tracking metrics.
   */
  async getTimeMetrics(
    options: AnalyticsOptions & { dateFrom: Date; dateTo: Date },
  ): Promise<TimeMetrics> {
    const { userId, dateFrom, dateTo } = options;

    const conditions = [
      eq(timeEntries.userId, userId),
      gte(timeEntries.startTime, dateFrom),
      lte(timeEntries.startTime, dateTo),
    ];

    const entries = await db.query.timeEntries.findMany({
      where: and(...conditions),
      with: {
        task: {
          columns: { id: true, title: true, projectId: true },
          with: {
            project: { columns: { id: true, name: true } },
          },
        },
      },
    });

    // Helper to calculate duration from startTime and endTime
    const getDurationMs = (entry: { startTime: Date; endTime: Date | null }): number => {
      if (!entry.endTime) return 0;
      return entry.endTime.getTime() - entry.startTime.getTime();
    };

    // Calculate total hours
    const totalMs = entries.reduce((sum, e) => sum + getDurationMs(e), 0);
    const totalHours = totalMs / (1000 * 60 * 60);

    // Days in range
    const days = Math.max(
      1,
      Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const avgHoursPerDay = totalHours / days;

    // Group by project
    const byProjectMap = new Map<string, { name: string | null; hours: number }>();
    for (const entry of entries) {
      const projectIdKey = entry.task?.projectId ?? 'no-project';
      const projectName = entry.task?.project?.name ?? null;
      const hours = getDurationMs(entry) / (1000 * 60 * 60);

      const existing = byProjectMap.get(projectIdKey);
      if (existing) {
        existing.hours += hours;
      } else {
        byProjectMap.set(projectIdKey, { name: projectName, hours });
      }
    }

    const byProject = Array.from(byProjectMap.entries())
      .map(([id, data]) => ({
        projectId: id === 'no-project' ? null : id,
        projectName: data.name,
        hours: Math.round(data.hours * 100) / 100,
      }))
      .sort((a, b) => b.hours - a.hours);

    // Group by day
    const byDayMap = new Map<string, number>();
    for (const entry of entries) {
      const dateParts = entry.startTime.toISOString().split('T');
      const date = dateParts[0] ?? '';
      const hours = getDurationMs(entry) / (1000 * 60 * 60);
      byDayMap.set(date, (byDayMap.get(date) ?? 0) + hours);
    }

    const byDay = Array.from(byDayMap.entries())
      .map(([date, hours]) => ({ date, hours: Math.round(hours * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Group by task
    const byTaskMap = new Map<string, { title: string; hours: number }>();
    for (const entry of entries) {
      if (!entry.taskId || !entry.task) continue;
      const hours = getDurationMs(entry) / (1000 * 60 * 60);
      const existing = byTaskMap.get(entry.taskId);
      if (existing) {
        existing.hours += hours;
      } else {
        byTaskMap.set(entry.taskId, { title: entry.task.title, hours });
      }
    }

    const byTask = Array.from(byTaskMap.entries())
      .map(([taskId, data]) => ({
        taskId,
        taskTitle: data.title,
        hours: Math.round(data.hours * 100) / 100,
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 10);

    return {
      totalHours: Math.round(totalHours * 100) / 100,
      avgHoursPerDay: Math.round(avgHoursPerDay * 100) / 100,
      byProject,
      byDay,
      byTask,
    };
  }

  /**
   * Get productivity metrics.
   */
  async getProductivityMetrics(
    options: AnalyticsOptions & { dateFrom: Date; dateTo: Date },
  ): Promise<ProductivityMetrics> {
    const { userId, dateFrom, dateTo } = options;

    // Get completed tasks (using updatedAt as proxy for completion date since there's no completedAt field)
    const completedTasks = await db.query.tasks.findMany({
      where: and(
        or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
        eq(tasks.statusCategory, 'done'),
        isNull(tasks.deletedAt),
        gte(tasks.updatedAt, dateFrom),
        lte(tasks.updatedAt, dateTo),
      ),
      columns: { id: true, updatedAt: true },
    });

    // Get time entries for focus hours
    const entries = await db.query.timeEntries.findMany({
      where: and(
        eq(timeEntries.userId, userId),
        gte(timeEntries.startTime, dateFrom),
        lte(timeEntries.startTime, dateTo),
      ),
      columns: { startTime: true, endTime: true },
    });

    // Days in range
    const days = Math.max(
      1,
      Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)),
    );

    // Tasks per day
    const tasksCompletedPerDay = completedTasks.length / days;

    // Helper to calculate duration from startTime and endTime
    const getEntryDurationMs = (entry: { startTime: Date; endTime: Date | null }): number => {
      if (!entry.endTime) return 0;
      return entry.endTime.getTime() - entry.startTime.getTime();
    };

    // Focus hours per day
    const totalFocusMs = entries.reduce((sum, e) => sum + getEntryDurationMs(e), 0);
    const focusHoursPerDay = totalFocusMs / (1000 * 60 * 60) / days;

    // Completion by day for trend and finding most productive day (using updatedAt as proxy)
    const completionByDay = new Map<string, number>();
    for (const task of completedTasks) {
      const dateParts = task.updatedAt.toISOString().split('T');
      const date = dateParts[0] ?? '';
      completionByDay.set(date, (completionByDay.get(date) ?? 0) + 1);
    }

    const taskCompletionTrend = Array.from(completionByDay.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Most productive day
    let mostProductiveDay: string | null = null;
    let maxCount = 0;
    for (const [date, count] of completionByDay) {
      if (count > maxCount) {
        maxCount = count;
        mostProductiveDay = date;
      }
    }

    // Most productive hour (from time entries)
    const hourCounts = new Map<number, number>();
    for (const entry of entries) {
      const hour = entry.startTime.getHours();
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    }

    let mostProductiveHour: number | null = null;
    let maxHourCount = 0;
    for (const [hour, count] of hourCounts) {
      if (count > maxHourCount) {
        maxHourCount = count;
        mostProductiveHour = hour;
      }
    }

    // Calculate streak (consecutive days with completed tasks, using updatedAt as proxy)
    const streakDays = this.calculateStreak(completedTasks.map((t) => t.updatedAt));

    return {
      tasksCompletedPerDay: Math.round(tasksCompletedPerDay * 100) / 100,
      focusHoursPerDay: Math.round(focusHoursPerDay * 100) / 100,
      streakDays,
      mostProductiveDay,
      mostProductiveHour,
      taskCompletionTrend,
    };
  }

  /**
   * Calculate date range for period.
   */
  private getDateRange(
    period: AnalyticsPeriod,
    customFrom?: Date,
    customTo?: Date,
  ): { dateFrom: Date; dateTo: Date } {
    if (customFrom && customTo) {
      return { dateFrom: customFrom, dateTo: customTo };
    }

    const now = new Date();
    const dateTo = customTo ?? now;
    let dateFrom: Date;

    switch (period) {
      case 'day':
        dateFrom = new Date(now);
        dateFrom.setHours(0, 0, 0, 0);
        break;
      case 'week':
        dateFrom = new Date(now);
        dateFrom.setDate(now.getDate() - 7);
        break;
      case 'month':
        dateFrom = new Date(now);
        dateFrom.setMonth(now.getMonth() - 1);
        break;
      case 'quarter':
        dateFrom = new Date(now);
        dateFrom.setMonth(now.getMonth() - 3);
        break;
      case 'year':
        dateFrom = new Date(now);
        dateFrom.setFullYear(now.getFullYear() - 1);
        break;
      case 'all':
      default:
        dateFrom = new Date(0); // Beginning of time
        break;
    }

    return { dateFrom: customFrom ?? dateFrom, dateTo };
  }

  /**
   * Calculate streak of consecutive days.
   */
  private calculateStreak(completionDates: Date[]): number {
    if (completionDates.length === 0) return 0;

    // Get unique dates
    const dates = [
      ...new Set(
        completionDates.map((d) => {
          const parts = d.toISOString().split('T');
          return parts[0] ?? '';
        }),
      ),
    ]
      .sort()
      .reverse();

    let streak = 0;
    const todayParts = new Date().toISOString().split('T');
    const today = todayParts[0] ?? '';

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      if (date === undefined) break;
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() - i);
      const expectedParts = expectedDate.toISOString().split('T');
      const expected = expectedParts[0] ?? '';

      if (date === expected || (i === 0 && date === today)) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }
}

// Singleton instance
let analyticsServiceInstance: AnalyticsService | null = null;

/**
 * Get the shared analytics service instance.
 */
export function getAnalyticsService(): AnalyticsService {
  analyticsServiceInstance ??= new AnalyticsService();
  return analyticsServiceInstance;
}
