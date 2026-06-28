/**
 * Initiative metrics builder.
 *
 * @packageDocumentation
 */

import type { initiatives, projects, tasks } from '../../db/schema/index.js';
import type { InitiativeMetricsResponse } from './schemas.js';

type InitiativeRow = typeof initiatives.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

type InitiativeWithProjects = InitiativeRow & {
  projects: (ProjectRow & { tasks: TaskRow[] })[];
};

export function buildInitiativeMetrics(
  initiative: InitiativeWithProjects,
): InitiativeMetricsResponse['data'] {
  const allTasks = initiative.projects.flatMap((project) => project.tasks);

  const taskCounts = {
    total: allTasks.length,
    completed: allTasks.filter((task) => task.status === 'completed').length,
    inProgress: allTasks.filter((task) => task.status === 'in_progress').length,
    pending: allTasks.filter((task) => task.status === 'pending').length,
  };

  const projectStats = initiative.projects.map((project) => {
    const projectTasks = project.tasks;
    const completed = projectTasks.filter((task) => task.status === 'completed').length;
    const total = projectTasks.length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    let health: 'on_track' | 'at_risk' | 'blocked' = 'on_track';
    const pendingTasks = projectTasks.filter((task) => task.status === 'pending').length;
    const hasStaleWork = total > 5 && pendingTasks > total * 0.8;
    if (hasStaleWork) {
      health = 'blocked';
    } else if (progress < 25 && total > 5) {
      health = 'at_risk';
    }

    return {
      id: project.id,
      name: project.name,
      totalTasks: total,
      completedTasks: completed,
      progress,
      health,
    };
  });

  const estimatedMinutes = allTasks.reduce(
    (sum, task) => sum + (task.estimatedMinutes ?? 0),
    0,
  );
  const loggedMinutes = allTasks
    .filter((task) => task.status === 'completed')
    .reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0);
  const remainingMinutes = estimatedMinutes - loggedMinutes;

  const now = new Date();
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const weeklyCompletions: number[] = [0, 0, 0, 0];

  for (const task of allTasks) {
    if (task.status !== 'completed') {
      continue;
    }
    const completedAt = task.updatedAt;
    if (completedAt < fourWeeksAgo) {
      continue;
    }
    const weeksAgo = Math.floor(
      (now.getTime() - completedAt.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
    if (weeksAgo >= 0 && weeksAgo < 4) {
      const index = 3 - weeksAgo;
      weeklyCompletions[index] = (weeklyCompletions[index] ?? 0) + 1;
    }
  }

  const currentVelocity = weeklyCompletions[3] ?? 0;
  const averageVelocity = weeklyCompletions.reduce((sum, value) => sum + value, 0) / 4;
  const velocityTrend = Math.round((currentVelocity - averageVelocity) * 10) / 10;

  let projectedCompletion: Date | null = null;
  const remainingTasks = taskCounts.total - taskCounts.completed;
  if (currentVelocity > 0 && remainingTasks > 0) {
    const weeksRemaining = remainingTasks / currentVelocity;
    const daysRemaining = Math.ceil(weeksRemaining * 7);
    const projected = new Date();
    projected.setDate(projected.getDate() + daysRemaining);
    projectedCompletion = projected;
  }

  return {
    taskCounts,
    projectStats,
    timeStats: {
      estimatedMinutes,
      loggedMinutes,
      remainingMinutes,
    },
    velocity: {
      current: currentVelocity,
      average: Math.round(averageVelocity * 10) / 10,
      trend: velocityTrend,
      weeklyCompletions,
    },
    projectedCompletion,
  };
}
