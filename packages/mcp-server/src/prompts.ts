import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { CreateAthenaMcpServerOptions } from './types.js';
import { asRecord, getStringField } from './utils.js';
import { eventScope, projectOwnerScope, taskOwnerScope, taskScope } from './queries.js';

const loadTodayAgenda = async (
  db: CreateAthenaMcpServerOptions['db'],
  tasks: CreateAthenaMcpServerOptions['schema']['tasks'],
  events: CreateAthenaMcpServerOptions['schema']['events'],
  userId: string,
) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [todayTasks, todayEvents] = await Promise.all([
    db.query.tasks.findMany({
      where: and(
        taskScope(tasks, userId),
        gte(tasks.deadline, today),
        lte(tasks.deadline, tomorrow),
      ),
    }),
    db.query.events.findMany({
      where: and(
        eventScope(events, userId),
        gte(events.startTime, today),
        lte(events.startTime, tomorrow),
      ),
      orderBy: [events.startTime],
    }),
  ]);

  return {
    date: today.toISOString().split('T')[0],
    tasks: todayTasks,
    events: todayEvents,
  };
};

export function registerPrompts(server: McpServer, options: CreateAthenaMcpServerOptions): void {
  const { userId, db, schema } = options;
  const { tasks, events, projects } = schema;

  server.registerPrompt(
    'daily_summary',
    {
      description: "Summarize today's tasks and events",
    },
    async () => {
      const agenda = await loadTodayAgenda(db, tasks, events, userId);
      const { tasks: todayTasks, events: todayEvents } = agenda;

      const completedTasks = todayTasks.filter((task) => task.status === 'completed');

      const agendaWithSummary = {
        ...agenda,
        summary: {
          totalTasks: (todayTasks as unknown[]).length,
          completedTasks: completedTasks.length,
          totalEvents: (todayEvents as unknown[]).length,
        },
      };

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Here is my agenda for today:\n\n${JSON.stringify(agendaWithSummary, null, 2)}\n\nGive me a concise daily summary and highlight any critical items.`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'daily_planning',
    {
      description: 'Generate a daily planning prompt based on current tasks and events',
    },
    async () => {
      const agenda = await loadTodayAgenda(db, tasks, events, userId);

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Here is my agenda for today:\n\n${JSON.stringify(agenda, null, 2)}\n\nHelp me plan my day. What should I prioritize? Are there any scheduling conflicts?`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'task_planning',
    {
      description: 'Plan tasks for the next work session',
    },
    async () => {
      const pendingTasks = await db.query.tasks.findMany({
        where: and(taskScope(tasks, userId), eq(tasks.status, 'pending')),
        orderBy: [desc(tasks.priority)],
        limit: 15,
      });

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Here are my highest-priority pending tasks:\n\n${JSON.stringify(pendingTasks, null, 2)}\n\nHelp me plan the next work session. Suggest an order and timeboxing strategy.`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'progress_report',
    {
      description: 'Generate a progress report for a project or initiative',
      argsSchema: {
        projectId: z.uuid().optional().describe('Project to report on'),
        initiativeId: z.uuid().optional().describe('Initiative to report on'),
      },
    },
    async (args) => {
      let projectIds: string[] | null = null;

      if (args.projectId) {
        projectIds = [args.projectId];
      }

      if (args.initiativeId) {
        const linkedProjects = await db.query.projects.findMany({
          where: and(
            projectOwnerScope(projects, userId),
            eq(projects.initiativeId, args.initiativeId),
          ),
        });
        projectIds = linkedProjects
          .map((project) => getStringField(project, 'id'))
          .filter((id): id is string => id !== null);
      }

      const filterByProjects = projectIds !== null;
      const projectFilterIds = projectIds ?? [];
      let relevantTasks: unknown[] = [];

      if (!filterByProjects) {
        relevantTasks = await db.query.tasks.findMany({
          where: taskScope(tasks, userId),
        });
      } else if (projectFilterIds.length > 0) {
        relevantTasks = await db.query.tasks.findMany({
          where: and(taskScope(tasks, userId), inArray(tasks.projectId, projectFilterIds)),
        });
      }

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Here is the current task set for this scope:\n\n${JSON.stringify(relevantTasks, null, 2)}\n\nWrite a progress report highlighting completed work, blockers, and next steps.`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'task_breakdown',
    {
      description: 'Help break down a complex task into subtasks',
      argsSchema: {
        taskId: z.uuid().describe('Task ID to break down'),
      },
    },
    async (args) => {
      const task = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, args.taskId), taskScope(tasks, userId)),
      });

      if (!task) {
        return {
          messages: [
            { role: 'user', content: { type: 'text', text: `Task not found: ${args.taskId}` } },
          ],
        };
      }

      const taskRecord = asRecord(task);
      const title = taskRecord ? (getStringField(taskRecord, 'title') ?? 'Untitled') : 'Untitled';
      const description = taskRecord
        ? (getStringField(taskRecord, 'description') ?? 'No description')
        : 'No description';
      const priority = taskRecord
        ? (getStringField(taskRecord, 'priority') ?? 'unknown')
        : 'unknown';

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `I have the following task:\n\nTitle: ${title}\nDescription: ${description}\nPriority: ${priority}\n\nHelp me break this down into smaller, actionable subtasks.`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'weekly_review',
    {
      description: 'Generate a weekly review prompt with accomplishments and upcoming work',
    },
    async () => {
      const now = new Date();
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      const [completedTasks, pendingTasks, upcomingEvents] = await Promise.all([
        db.query.tasks.findMany({
          where: and(
            taskOwnerScope(tasks, userId),
            eq(tasks.status, 'completed'),
            gte(tasks.updatedAt, weekAgo),
          ),
        }),
        db.query.tasks.findMany({
          where: and(taskScope(tasks, userId), eq(tasks.status, 'pending')),
        }),
        db.query.events.findMany({
          where: and(
            eventScope(events, userId),
            gte(events.startTime, now),
            lte(events.startTime, nextWeek),
          ),
          orderBy: [events.startTime],
        }),
      ]);

      const completedCount = String((completedTasks as unknown[]).length);
      const pendingCount = String((pendingTasks as unknown[]).length);

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Here is my weekly review data:\n\nCompleted tasks this week (${completedCount}):\n${completedTasks.map((task) => `- ${getStringField(task, 'title') ?? 'Untitled'}`).join('\n')}\n\nPending tasks (${pendingCount}):\n${pendingTasks.map((task) => `- ${getStringField(task, 'title') ?? 'Untitled'}`).join('\n')}\n\nUpcoming events:\n${JSON.stringify(upcomingEvents, null, 2)}\n\nHelp me reflect on my week. What went well? What could improve? What should I focus on next week?`,
            },
          },
        ],
      };
    },
  );
}
