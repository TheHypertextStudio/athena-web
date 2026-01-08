/**
 * Analytics service types.
 *
 * @packageDocumentation
 */

/**
 * Time period for analytics.
 */
export type AnalyticsPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all';

/**
 * Task completion metrics.
 */
export interface TaskMetrics {
  total: number;
  completed: number;
  pending: number;
  inProgress: number;
  cancelled: number;
  overdue: number;
  completionRate: number;
  avgCompletionTime: number | null; // hours
}

/**
 * Project metrics.
 */
export interface ProjectMetrics {
  total: number;
  active: number;
  completed: number;
  onHold: number;
  tasksByProject: {
    projectId: string;
    projectName: string;
    totalTasks: number;
    completedTasks: number;
  }[];
}

/**
 * Time tracking metrics.
 */
export interface TimeMetrics {
  totalHours: number;
  avgHoursPerDay: number;
  byProject: {
    projectId: string | null;
    projectName: string | null;
    hours: number;
  }[];
  byDay: {
    date: string;
    hours: number;
  }[];
  byTask: {
    taskId: string;
    taskTitle: string;
    hours: number;
  }[];
}

/**
 * Productivity metrics.
 */
export interface ProductivityMetrics {
  tasksCompletedPerDay: number;
  focusHoursPerDay: number;
  streakDays: number;
  mostProductiveDay: string | null;
  mostProductiveHour: number | null;
  taskCompletionTrend: {
    date: string;
    count: number;
  }[];
}

/**
 * Activity metrics.
 */
export interface ActivityMetrics {
  totalActivities: number;
  byType: Record<string, number>;
  byDay: {
    date: string;
    count: number;
  }[];
}

/**
 * Dashboard summary.
 */
export interface DashboardSummary {
  period: AnalyticsPeriod;
  dateFrom: Date;
  dateTo: Date;
  tasks: TaskMetrics;
  projects: ProjectMetrics;
  time: TimeMetrics;
  productivity: ProductivityMetrics;
}

/**
 * Analytics query options.
 */
export interface AnalyticsOptions {
  userId: string;
  period: AnalyticsPeriod;
  dateFrom?: Date;
  dateTo?: Date;
  projectId?: string;
  workspaceId?: string;
}
