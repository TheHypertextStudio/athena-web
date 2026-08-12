/** Behavioral contract tests for Docket's named recurrence unions. */
import { describe, expect, it } from 'vitest';

import {
  AfterCompletionSchedule,
  CalendarProcessBindingCreate,
  CalendarProcessBindingOut,
  DailySchedule,
  MonthlySchedule,
  ProcessDefinitionCreate,
  ProcessDefinitionDetailOut,
  ProcessDefinitionUpdate,
  ProcessInstanceItem,
  RecurrenceSeriesCreate,
  RecurrenceSeriesDetailOut,
  RecurrenceSeriesLifecycle,
  RecurrenceSeriesOut,
  RecurrenceSeriesRevisionOut,
  ProcessStepTiming,
  ProcessTaskSpec,
  ProcessTrigger,
  RecurrenceSchedule,
  RecurringTaskCreate,
  SeriesEdit,
  WeeklySchedule,
  YearlySchedule,
} from '../../src/recurrence';

const TEAM_ID = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

describe('RecurrenceSchedule', () => {
  it('accepts each named calendar schedule arm', () => {
    const schedules = [
      {
        kind: 'daily',
        interval: 1,
        startDate: '2026-08-12',
        timezone: 'America/Los_Angeles',
        end: { kind: 'never' },
      },
      {
        kind: 'weekly',
        interval: 1,
        weekdays: ['monday', 'wednesday', 'friday'],
        startDate: '2026-08-12',
        timezone: 'America/Los_Angeles',
        end: { kind: 'on_date', date: '2026-12-31' },
      },
      {
        kind: 'monthly',
        interval: 1,
        pattern: { kind: 'day_of_month', day: 15, overflow: 'skip' },
        startDate: '2026-08-12',
        timezone: 'America/Los_Angeles',
        end: { kind: 'after_count', count: 8 },
      },
      {
        kind: 'yearly',
        interval: 1,
        month: 8,
        day: 12,
        overflow: 'skip',
        startDate: '2026-08-12',
        timezone: 'America/Los_Angeles',
        end: { kind: 'never' },
      },
      { kind: 'after_completion', interval: 2, unit: 'week' },
    ];

    for (const schedule of schedules) {
      expect(RecurrenceSchedule.safeParse(schedule).success).toBe(true);
    }
  });

  it('rejects a weekly schedule with no selected day', () => {
    const result = WeeklySchedule.safeParse({
      kind: 'weekly',
      interval: 1,
      weekdays: [],
      startDate: '2026-08-12',
      timezone: 'America/Los_Angeles',
      end: { kind: 'never' },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'weekdays')).toBe(true);
  });

  it('rejects duplicate weekdays instead of silently changing the rule', () => {
    expect(
      WeeklySchedule.safeParse({
        kind: 'weekly',
        interval: 1,
        weekdays: ['monday', 'monday'],
        startDate: '2026-08-12',
        timezone: 'America/Los_Angeles',
        end: { kind: 'never' },
      }).success,
    ).toBe(false);
  });

  it('rejects impossible calendar bounds and non-positive intervals', () => {
    expect(
      DailySchedule.safeParse({
        kind: 'daily',
        interval: 0,
        startDate: '2026-02-30',
        timezone: 'America/Los_Angeles',
        end: { kind: 'never' },
      }).success,
    ).toBe(false);
    expect(
      YearlySchedule.safeParse({
        kind: 'yearly',
        interval: 1,
        month: 13,
        day: 1,
        overflow: 'skip',
        startDate: '2026-08-12',
        timezone: 'America/Los_Angeles',
        end: { kind: 'never' },
      }).success,
    ).toBe(false);
  });

  it('requires a valid monthly discriminated pattern', () => {
    expect(
      MonthlySchedule.safeParse({
        kind: 'monthly',
        interval: 1,
        pattern: { kind: 'day_of_month', day: 0, overflow: 'skip' },
        startDate: '2026-08-12',
        timezone: 'America/Los_Angeles',
        end: { kind: 'never' },
      }).success,
    ).toBe(false);
    expect(
      MonthlySchedule.safeParse({
        kind: 'monthly',
        interval: 1,
        pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'sunday' },
        startDate: '2026-08-12',
        timezone: 'America/Los_Angeles',
        end: { kind: 'never' },
      }).success,
    ).toBe(true);
  });

  it('preserves ordered relative windows for generated projects', () => {
    expect(
      ProcessDefinitionCreate.safeParse({
        name: 'Workshop',
        creationMode: 'all_at_once',
        project: {
          key: 'workshop',
          name: 'Workshop',
          status: 'planned',
          startOffsetDays: 4,
          targetOffsetDays: 3,
          labelIds: [],
          timing: { kind: 'on_trigger' },
        },
        milestones: [],
        tasks: [
          {
            key: 'host',
            title: 'Host workshop',
            teamId: TEAM_ID,
            priority: 'none',
            labelIds: [],
            timing: { kind: 'on_trigger' },
          },
        ],
        dependencies: [],
      }).success,
    ).toBe(false);
  });

  it('keeps completion-anchored schedules free of calendar-only fields', () => {
    expect(
      AfterCompletionSchedule.safeParse({ kind: 'after_completion', interval: 1, unit: 'month' })
        .success,
    ).toBe(true);
    expect(
      AfterCompletionSchedule.safeParse({
        kind: 'after_completion',
        interval: 1,
        unit: 'month',
        weekdays: ['monday'],
      }).success,
    ).toBe(false);
  });
});

describe('RecurringTaskCreate', () => {
  it('defaults routine behavior to skip and a four-week rolling horizon', () => {
    const parsed = RecurringTaskCreate.parse({
      task: { title: 'Run six miles', teamId: TEAM_ID },
      schedule: {
        kind: 'weekly',
        interval: 1,
        weekdays: ['monday', 'wednesday', 'friday'],
        startDate: '2026-08-12',
        timezone: 'America/Los_Angeles',
        end: { kind: 'never' },
      },
    });

    expect(parsed.missedPolicy).toBe('skip');
    expect(parsed.materialization).toEqual({ horizonDays: 28, minimumOccurrences: 2 });
  });

  it('does not accept calendar missed policies for completion-anchored work', () => {
    const result = RecurringTaskCreate.safeParse({
      task: { title: 'Replace filter', teamId: TEAM_ID },
      schedule: { kind: 'after_completion', interval: 3, unit: 'month' },
      missedPolicy: 'carry',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'missedPolicy')).toBe(
      true,
    );
  });

  it('does not accept rolling materialization for completion-anchored work', () => {
    const result = RecurringTaskCreate.safeParse({
      task: { title: 'Replace filter', teamId: TEAM_ID },
      schedule: { kind: 'after_completion', interval: 3, unit: 'month' },
      materialization: { horizonDays: 28, minimumOccurrences: 2 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'materialization')).toBe(
      true,
    );
  });
});

describe('ProcessTrigger', () => {
  it('accepts manual, calendar, completion, and event triggers as named arms', () => {
    const triggers = [
      { kind: 'manual' },
      {
        kind: 'calendar',
        schedule: {
          kind: 'daily',
          interval: 1,
          startDate: '2026-08-12',
          timezone: 'America/Los_Angeles',
          end: { kind: 'never' },
        },
        missedPolicy: 'skip',
        materialization: { horizonDays: 28, minimumOccurrences: 2 },
      },
      { kind: 'after_completion', interval: 3, unit: 'month' },
      { kind: 'event', event: { kind: 'created', subjectType: 'calendar_event' } },
    ];

    for (const trigger of triggers) {
      expect(ProcessTrigger.safeParse(trigger).success).toBe(true);
    }
  });

  it('rejects an event trigger that cannot match an event', () => {
    expect(ProcessTrigger.safeParse({ kind: 'event', event: {} }).success).toBe(false);
  });
});

describe('CalendarProcessBinding', () => {
  it('keeps the authoring command small and returns explicit series provenance', () => {
    expect(
      CalendarProcessBindingCreate.parse({
        calendarItemId: '01BX5ZZKBKACTAV9WEVGEMMVRA',
        processDefinitionId: '01BX5ZZKBKACTAV9WEVGEMMVRB',
      }),
    ).toEqual({
      calendarItemId: '01BX5ZZKBKACTAV9WEVGEMMVRA',
      processDefinitionId: '01BX5ZZKBKACTAV9WEVGEMMVRB',
    });

    expect(
      CalendarProcessBindingOut.parse({
        id: 'binding-1',
        organizationId: '01BX5ZZKBKACTAV9WEVGEMMVRC',
        calendarItemId: '01BX5ZZKBKACTAV9WEVGEMMVRA',
        calendarLayerId: '01BX5ZZKBKACTAV9WEVGEMMVRD',
        externalSeriesId: 'provider-series-1',
        scope: 'event_series',
        processDefinitionId: '01BX5ZZKBKACTAV9WEVGEMMVRB',
        recurrenceSeriesId: '01BX5ZZKBKACTAV9WEVGEMMVRE',
        seriesName: 'Monthly transit meetup work',
        createdAt: '2026-08-12T00:00:00.000Z',
      }).scope,
    ).toBe('event_series');
  });
});

describe('ProcessStepTiming', () => {
  it('supports trigger-relative work before and after the occurrence', () => {
    expect(ProcessStepTiming.safeParse({ kind: 'on_trigger' }).success).toBe(true);
    expect(
      ProcessStepTiming.safeParse({ kind: 'relative_to_trigger', offsetDays: -14 }).success,
    ).toBe(true);
    expect(
      ProcessStepTiming.safeParse({
        kind: 'after_step_completion',
        stepKey: 'host-workshop',
        offsetDays: 1,
      }).success,
    ).toBe(true);
  });

  it('rejects a negative delay after another step completes', () => {
    expect(
      ProcessStepTiming.safeParse({
        kind: 'after_step_completion',
        stepKey: 'interview',
        offsetDays: -1,
      }).success,
    ).toBe(false);
  });
});

describe('ProcessDefinitionCreate', () => {
  const workshopProcess = {
    name: 'Intro to Urbanism Workshop Series',
    creationMode: 'all_at_once',
    project: {
      key: 'workshop',
      name: 'Intro to Urbanism Workshop',
      teamId: TEAM_ID,
      timing: { kind: 'on_trigger' },
    },
    milestones: [],
    tasks: [
      {
        key: 'publish',
        title: 'Publish event to website and other platforms',
        teamId: TEAM_ID,
        projectKey: 'workshop',
        timing: { kind: 'relative_to_trigger', offsetDays: -14 },
      },
      {
        key: 'host',
        title: 'Host workshop',
        teamId: TEAM_ID,
        projectKey: 'workshop',
        timing: { kind: 'on_trigger' },
      },
      {
        key: 'follow-up',
        title: 'Send follow-ups to attendees',
        teamId: TEAM_ID,
        projectKey: 'workshop',
        timing: { kind: 'after_step_completion', stepKey: 'host', offsetDays: 1 },
      },
    ],
    dependencies: [{ blockingStepKey: 'host', blockedStepKey: 'follow-up' }],
  } as const;

  it('accepts a project-shaped process with relative timing and dependencies', () => {
    expect(ProcessDefinitionCreate.safeParse(workshopProcess).success).toBe(true);
  });

  it('rejects duplicate step keys', () => {
    const result = ProcessDefinitionCreate.safeParse({
      ...workshopProcess,
      tasks: [workshopProcess.tasks[0], { ...workshopProcess.tasks[1], key: 'publish' }],
      dependencies: [],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'tasks')).toBe(true);
  });

  it('rejects references to a step that is not in the revision', () => {
    const result = ProcessDefinitionCreate.safeParse({
      ...workshopProcess,
      dependencies: [{ blockingStepKey: 'missing', blockedStepKey: 'follow-up' }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'dependencies')).toBe(
      true,
    );
  });

  it('includes milestone keys when validating compatible generated references', () => {
    expect(
      ProcessDefinitionCreate.safeParse({
        ...workshopProcess,
        milestones: [
          {
            key: 'event-day',
            projectKey: 'workshop',
            name: 'Event day',
          },
        ],
        tasks: workshopProcess.tasks.map((task) => {
          if (task.key === 'host') return { ...task, milestoneKey: 'event-day' };
          if (task.key === 'follow-up') return { ...task, parentTaskKey: 'host' };
          return task;
        }),
      }).success,
    ).toBe(true);
  });

  it('supports task-only processes without a generated project', () => {
    expect(
      ProcessDefinitionCreate.safeParse({
        name: 'Daily run',
        tasks: [{ key: 'run', title: 'Run six miles', teamId: TEAM_ID }],
      }).success,
    ).toBe(true);
  });

  it('rejects a task that references an unknown generated project', () => {
    const result = ProcessDefinitionCreate.safeParse({
      ...workshopProcess,
      tasks: [{ ...workshopProcess.tasks[0], projectKey: 'missing-project' }],
      dependencies: [],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'dependencies')).toBe(
      true,
    );
  });
});

describe('ProcessDefinitionUpdate', () => {
  it('requires at least one mutable metadata field', () => {
    expect(ProcessDefinitionUpdate.safeParse({ name: 'Workshop series' }).success).toBe(true);
    expect(ProcessDefinitionUpdate.safeParse({}).success).toBe(false);
  });
});

describe('ProcessTaskSpec', () => {
  const fixedTask = {
    key: 'repeat-task',
    title: 'Run six miles',
    teamId: TEAM_ID,
    projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    milestoneId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
    cycleId: '01BX5ZZKBKACTAV9WEVGEMMVRY',
    parentTaskId: '01BX5ZZKBKACTAV9WEVGEMMVRX',
    startOffsetDays: 0,
    dueOffsetDays: 2,
  } as const;

  it('preserves fixed composer references and relative start and due dates', () => {
    expect(ProcessTaskSpec.safeParse(fixedTask).success).toBe(true);
  });

  it('rejects choosing both fixed and generated references', () => {
    const result = ProcessTaskSpec.safeParse({ ...fixedTask, projectKey: 'generated-project' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'projectId')).toBe(true);
  });

  it('rejects a due-date offset before the task starts', () => {
    const result = ProcessTaskSpec.safeParse({
      ...fixedTask,
      startOffsetDays: 3,
      dueOffsetDays: 2,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'dueOffsetDays')).toBe(
      true,
    );
  });
});

describe('ProcessInstanceItem', () => {
  it('discriminates generated projects, milestones, and tasks', () => {
    const items = [
      {
        kind: 'project',
        stepKey: 'workshop',
        projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      },
      {
        kind: 'milestone',
        stepKey: 'event',
        milestoneId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
      },
      {
        kind: 'task',
        stepKey: 'host',
        taskId: '01BX5ZZKBKACTAV9WEVGEMMVRY',
      },
    ];

    for (const item of items) {
      expect(ProcessInstanceItem.safeParse(item).success).toBe(true);
    }
  });
});

describe('SeriesEdit', () => {
  it('requires an occurrence date when editing only one occurrence', () => {
    expect(
      SeriesEdit.safeParse({
        scope: 'occurrence',
        scheduledFor: '2026-09-12',
        resolution: { kind: 'reschedule', scheduledFor: '2026-09-13' },
      }).success,
    ).toBe(true);
    expect(
      SeriesEdit.safeParse({
        scope: 'occurrence',
        resolution: { kind: 'reschedule', scheduledFor: '2026-09-13' },
      }).success,
    ).toBe(false);
  });

  it('represents future edits as a new trigger boundary', () => {
    expect(
      SeriesEdit.safeParse({
        scope: 'future',
        effectiveFrom: '2026-10-01',
        trigger: { kind: 'manual' },
      }).success,
    ).toBe(true);
  });
});

describe('process and series API contracts', () => {
  it('represents a reusable process together with its immutable current revision', () => {
    expect(
      ProcessDefinitionDetailOut.safeParse({
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        organizationId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
        name: 'Intro to Urbanism Workshop Series',
        description: null,
        status: 'published',
        latestRevisionNumber: 1,
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        revision: {
          id: '01BX5ZZKBKACTAV9WEVGEMMVRY',
          definitionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          number: 1,
          creationMode: 'all_at_once',
          milestones: [],
          tasks: [{ key: 'host', title: 'Host workshop', teamId: TEAM_ID }],
          dependencies: [],
          publishedAt: '2026-08-11T00:00:00.000Z',
          createdAt: '2026-08-11T00:00:00.000Z',
        },
      }).success,
    ).toBe(true);
  });

  it('creates a series from one complete discriminated trigger', () => {
    expect(
      RecurrenceSeriesCreate.safeParse({
        processDefinitionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        name: 'Book Club Season',
        trigger: {
          kind: 'calendar',
          schedule: {
            kind: 'monthly',
            interval: 2,
            pattern: { kind: 'day_of_month', day: 1, overflow: 'skip' },
            startDate: '2026-09-01',
            timezone: 'America/Los_Angeles',
            end: { kind: 'after_count', count: 6 },
          },
          missedPolicy: 'resolve',
          materialization: { horizonDays: 28, minimumOccurrences: 2 },
        },
      }).success,
    ).toBe(true);
  });

  it('keeps non-calendar series in the output through the trigger union', () => {
    expect(
      RecurrenceSeriesOut.safeParse({
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        organizationId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
        processDefinitionId: '01BX5ZZKBKACTAV9WEVGEMMVRY',
        processRevisionId: '01BX5ZZKBKACTAV9WEVGEMMVRX',
        name: 'Coordinator check-in',
        status: 'active',
        trigger: { kind: 'after_completion', interval: 1, unit: 'month' },
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        pausedAt: null,
        endedAt: null,
      }).success,
    ).toBe(true);
  });

  it('keeps immutable trigger revisions distinct from occurrence history', () => {
    const revision = {
      id: '01BX5ZZKBKACTAV9WEVGEMMVRW',
      seriesId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      processRevisionId: '01BX5ZZKBKACTAV9WEVGEMMVRX',
      number: 2,
      effectiveFrom: '2026-10-01',
      trigger: { kind: 'after_completion', interval: 1, unit: 'month' },
      createdAt: '2026-08-11T00:00:00.000Z',
    };
    expect(RecurrenceSeriesRevisionOut.safeParse(revision).success).toBe(true);
    expect(
      RecurrenceSeriesDetailOut.safeParse({
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        organizationId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
        processDefinitionId: '01BX5ZZKBKACTAV9WEVGEMMVRY',
        processRevisionId: '01BX5ZZKBKACTAV9WEVGEMMVRX',
        name: 'Coordinator check-in',
        status: 'active',
        trigger: revision.trigger,
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        pausedAt: null,
        endedAt: null,
        revisions: [revision],
        occurrences: [],
      }).success,
    ).toBe(true);
  });

  it('discriminates pause, resume, and end lifecycle commands', () => {
    for (const command of [{ action: 'pause' }, { action: 'resume' }, { action: 'end' }]) {
      expect(RecurrenceSeriesLifecycle.safeParse(command).success).toBe(true);
    }
  });
});
