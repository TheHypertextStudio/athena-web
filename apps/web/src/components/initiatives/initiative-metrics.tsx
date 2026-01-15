/**
 * Initiative metrics dashboard component.
 *
 * Displays rich analytics for an initiative including:
 * - Progress percentage
 * - Time spent/remaining
 * - Velocity
 * - Projected completion
 * - Burndown chart
 *
 * @packageDocumentation
 */

'use client';

import { useMemo } from 'react';
import { TrendingUp, Clock, Calendar, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
// Types are defined locally in InitiativeMetricsData interface

export interface InitiativeMetricsData {
  /** Total number of tasks */
  totalTasks: number;
  /** Number of completed tasks */
  completedTasks: number;
  /** Number of in-progress tasks */
  inProgressTasks: number;
  /** Number of pending tasks */
  pendingTasks: number;
  /** Total estimated minutes across all tasks */
  estimatedMinutes: number;
  /** Total logged/completed minutes */
  loggedMinutes: number;
  /** Remaining estimated minutes */
  remainingMinutes: number;
  /** Tasks completed per week (last 4 weeks) */
  weeklyCompletions: number[];
  /** Projects with their progress */
  projects: {
    id: string;
    name: string;
    totalTasks: number;
    completedTasks: number;
    health: 'on_track' | 'at_risk' | 'blocked';
  }[];
}

export interface InitiativeMetricsProps {
  /** Metrics data for the initiative */
  metrics: InitiativeMetricsData;
  /** Additional class names */
  className?: string;
}

/**
 * Metric card component.
 */
function MetricCard({
  label,
  value,
  subValue,
  icon: Icon,
  trend,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: { value: string; positive: boolean };
}) {
  return (
    <div className="bg-surface-container-high rounded-xl p-4">
      <div className="text-on-surface-variant flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium tracking-wide uppercase">{label}</span>
      </div>
      <div className="mt-2">
        <span className="text-on-surface text-2xl font-bold tabular-nums">{value}</span>
        {trend && (
          <span
            className={cn(
              'ml-2 text-sm font-medium',
              trend.positive
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400',
            )}
          >
            {trend.positive ? '+' : ''}
            {trend.value}
          </span>
        )}
      </div>
      {subValue && <div className="text-on-surface-variant mt-0.5 text-sm">{subValue}</div>}
    </div>
  );
}

/**
 * Large progress ring for the main progress metric.
 */
function LargeProgressRing({
  progress,
  size = 80,
  strokeWidth = 6,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="rotate-[-90deg]" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-surface-container-highest"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-primary transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold tabular-nums">{progress}%</span>
      </div>
    </div>
  );
}

/**
 * Simple sparkline chart for velocity.
 */
function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length === 0) return null;

  const max = Math.max(...data, 1);
  const width = 80;
  const height = 24;
  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - (value / max) * height;
      return `${String(x)},${String(y)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className={cn('text-primary', className)}>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

/**
 * Calculate velocity from weekly completions.
 */
function calculateVelocity(weeklyCompletions: number[]): { current: number; trend: number } {
  if (weeklyCompletions.length === 0) {
    return { current: 0, trend: 0 };
  }

  const current = weeklyCompletions[weeklyCompletions.length - 1] ?? 0;
  const average = weeklyCompletions.reduce((sum, v) => sum + v, 0) / weeklyCompletions.length;
  const trend = current - average;

  return { current, trend: Math.round(trend * 10) / 10 };
}

/**
 * Calculate projected completion date based on velocity.
 */
function calculateProjectedCompletion(remainingTasks: number, velocity: number): Date | null {
  if (velocity <= 0 || remainingTasks <= 0) return null;

  const weeksRemaining = remainingTasks / velocity;
  const daysRemaining = Math.ceil(weeksRemaining * 7);
  const projectedDate = new Date();
  projectedDate.setDate(projectedDate.getDate() + daysRemaining);

  return projectedDate;
}

/**
 * Format hours from minutes.
 */
function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${String(hours)}h`;
}

/**
 * Initiative metrics dashboard component.
 *
 * @example
 * ```tsx
 * <InitiativeMetrics metrics={metricsData} />
 * ```
 */
export function InitiativeMetrics({ metrics, className }: InitiativeMetricsProps) {
  const progress = useMemo(() => {
    if (metrics.totalTasks === 0) return 0;
    return Math.round((metrics.completedTasks / metrics.totalTasks) * 100);
  }, [metrics.completedTasks, metrics.totalTasks]);

  const velocity = useMemo(
    () => calculateVelocity(metrics.weeklyCompletions),
    [metrics.weeklyCompletions],
  );

  const projectedCompletion = useMemo(
    () =>
      calculateProjectedCompletion(metrics.totalTasks - metrics.completedTasks, velocity.current),
    [metrics.totalTasks, metrics.completedTasks, velocity.current],
  );

  return (
    <div className={cn('space-y-4', className)}>
      {/* Main metrics row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Progress */}
        <div className="bg-surface-container-high rounded-xl p-4">
          <div className="text-on-surface-variant flex items-center gap-2">
            <Target className="h-4 w-4" />
            <span className="text-xs font-medium tracking-wide uppercase">Progress</span>
          </div>
          <div className="mt-3 flex justify-center">
            <LargeProgressRing progress={progress} />
          </div>
        </div>

        {/* Time Spent */}
        <MetricCard
          label="Time Spent"
          value={formatHours(metrics.loggedMinutes)}
          subValue={`of ${formatHours(metrics.estimatedMinutes)} est`}
          icon={Clock}
        />

        {/* Velocity */}
        <div className="bg-surface-container-high rounded-xl p-4">
          <div className="text-on-surface-variant flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-medium tracking-wide uppercase">Velocity</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-on-surface text-2xl font-bold tabular-nums">
              {velocity.current}
            </span>
            <span className="text-on-surface-variant text-sm">tasks/wk</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <Sparkline data={metrics.weeklyCompletions} />
            {velocity.trend !== 0 && (
              <span
                className={cn(
                  'text-xs font-medium',
                  velocity.trend > 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400',
                )}
              >
                {velocity.trend > 0 ? '+' : ''}
                {velocity.trend}
              </span>
            )}
          </div>
        </div>

        {/* Projected Completion */}
        <MetricCard
          label="Projected"
          value={
            projectedCompletion
              ? projectedCompletion.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })
              : '-'
          }
          subValue={
            projectedCompletion
              ? projectedCompletion.toLocaleDateString('en-US', { year: 'numeric' })
              : 'Not enough data'
          }
          icon={Calendar}
        />
      </div>

      {/* Task breakdown */}
      <div className="bg-surface-container-high rounded-xl p-4">
        <h3 className="text-on-surface-variant text-sm font-medium">Task Breakdown</h3>
        <div className="mt-3 flex items-center gap-4">
          <div className="flex-1">
            <div className="bg-surface-container-highest flex h-2 overflow-hidden rounded-full">
              {metrics.totalTasks > 0 && (
                <>
                  <div
                    className="bg-green-500 transition-all duration-500"
                    style={{
                      width: `${String((metrics.completedTasks / metrics.totalTasks) * 100)}%`,
                    }}
                  />
                  <div
                    className="bg-blue-500 transition-all duration-500"
                    style={{
                      width: `${String((metrics.inProgressTasks / metrics.totalTasks) * 100)}%`,
                    }}
                  />
                </>
              )}
            </div>
          </div>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              {metrics.completedTasks} done
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              {metrics.inProgressTasks} active
            </span>
            <span className="flex items-center gap-1.5">
              <span className="bg-surface-container-highest h-2 w-2 rounded-full" />
              {metrics.pendingTasks} pending
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
