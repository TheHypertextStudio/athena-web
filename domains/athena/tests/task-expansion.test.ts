import { describe, expect, it } from 'vitest';

import { MockTaskSynthesizer } from '../src/task-drafting/adapters/deterministic';
import { constrainTaskExpansion, type TaskExpansionSynthesizer } from '../src/task-expansion';

describe('task expansion synthesis', () => {
  it('drops a model-invented resource URL that was not in the supplied task context', async () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Investigate checkout errors',
        description: 'Customers see a 500 after entering a postal code.',
        explicit: {},
        availableTasks: [],
      },
      {
        description: 'Customers see a 500 after entering a postal code.',
        resourceUrls: ['https://attacker.example/secret'],
      },
    );

    expect(result.resourceUrls).toEqual([]);
  });

  it('keeps authored text while adding selected template structure', async () => {
    const synthesizer = new MockTaskSynthesizer() as TaskExpansionSynthesizer;

    const result = await synthesizer.expandTask({
      taskId: 'task_1',
      title: 'Investigate checkout errors',
      description: 'Customers see a 500 after entering a postal code.',
      templateDescription: '## What happened\n\n## Expected result',
      explicit: { priority: 'high' },
      availableTasks: [],
    });

    expect(result.description).toContain('Customers see a 500 after entering a postal code.');
    expect(result.description).toContain('## What happened');
    expect(result.patch).toEqual({});
  });

  it('leaves uncertain metadata and relationships unset', async () => {
    const synthesizer = new MockTaskSynthesizer() as TaskExpansionSynthesizer;

    const result = await synthesizer.expandTask({
      taskId: 'task_1',
      title: 'Review the request',
      description: 'Please look at this when you can.',
      explicit: {},
      availableTasks: [],
    });

    expect(result.patch).toEqual({});
    expect(result.subtasks).toEqual([]);
    expect(result.dependencies).toEqual([]);
    expect(result.relatedTaskIds).toEqual([]);
    expect(result.resourceUrls).toEqual([]);
  });

  it('drops a dependency that does not make the expanded task ready or blocked', () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Investigate checkout errors',
        description: 'Customers see a 500 after entering a postal code.',
        explicit: {},
        availableTasks: [
          { id: 'task_2', title: 'Review gateway logs' },
          { id: 'task_3', title: 'Deploy the correction' },
        ],
      },
      {
        description: 'Customers see a 500 after entering a postal code.',
        dependencies: [{ blockingTaskId: 'task_2', blockedTaskId: 'task_3' } as never],
      },
    );

    expect(result.dependencies).toEqual([]);
  });

  it('drops a generated subtask without a quoted authored basis', () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Investigate checkout errors',
        description: 'Configure the new payment gateway before the release.',
        explicit: {},
        availableTasks: [],
      },
      {
        description: 'Configure the new payment gateway before the release.',
        subtasks: [
          {
            title: 'Configure the new payment gateway',
          } as never,
        ],
      },
    );

    expect(result.subtasks).toEqual([]);
  });

  it('keeps a generated subtask only when its quote names the contained outcome', () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Investigate checkout errors',
        description: 'Configure the new payment gateway before the release.',
        explicit: {},
        availableTasks: [],
      },
      {
        description: 'Configure the new payment gateway before the release.',
        subtasks: [
          {
            title: 'Configure the new payment gateway',
            evidence: 'Configure the new payment gateway before the release.',
          },
          {
            title: 'Notify customers',
            evidence: 'Configure the new payment gateway before the release.',
          },
        ],
      },
    );

    expect(result.subtasks).toEqual([
      {
        title: 'Configure the new payment gateway',
        evidence: 'Configure the new payment gateway before the release.',
      },
    ]);
  });

  it('drops a child whose generated description is quoted but whose visible title is invented', () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Investigate checkout errors',
        description: 'Confirm the gateway response before the release.',
        explicit: {},
        availableTasks: [],
      },
      {
        description: 'Confirm the gateway response before the release.',
        subtasks: [
          {
            title: 'Rebuild the payment platform',
            description: 'Confirm the gateway response',
            evidence: 'Confirm the gateway response before the release.',
          },
        ],
      },
    );

    expect(result.subtasks).toEqual([]);
  });

  it('keeps a dependency only when its quote names both tasks and their explicit wait', () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Resolve payment request',
        description: 'Wait for Review gateway logs before Resolve payment request.',
        explicit: {},
        availableTasks: [{ id: 'task_2', title: 'Review gateway logs' }],
      },
      {
        description: 'Wait for Review gateway logs before Resolve payment request.',
        dependencies: [
          {
            blockingTaskId: 'task_2',
            blockedTaskId: 'task_1',
            evidence: 'Wait for Review gateway logs before Resolve payment request.',
          },
          {
            blockingTaskId: 'task_2',
            blockedTaskId: 'task_1',
          } as never,
        ],
      },
    );

    expect(result.dependencies).toEqual([
      {
        blockingTaskId: 'task_2',
        blockedTaskId: 'task_1',
        evidence: 'Wait for Review gateway logs before Resolve payment request.',
      },
    ]);
  });

  it('drops a dependency quote that names both tasks without stating a block or wait', () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Resolve payment request',
        description: 'Review gateway logs and Resolve payment request are both part of this work.',
        explicit: {},
        availableTasks: [{ id: 'task_2', title: 'Review gateway logs' }],
      },
      {
        description: 'Review gateway logs and Resolve payment request are both part of this work.',
        dependencies: [
          {
            blockingTaskId: 'task_2',
            blockedTaskId: 'task_1',
            evidence: 'Review gateway logs and Resolve payment request are both part of this work.',
          },
        ],
      },
    );

    expect(result.dependencies).toEqual([]);
  });

  it('uses inferred labels only when neither a person nor the template supplied labels', () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Investigate checkout errors',
        description: 'Customers see a 500 after entering a postal code.',
        explicit: {},
        availableTasks: [],
      },
      {
        description: 'Customers see a 500 after entering a postal code.',
        patch: { labelIds: ['label_1'] },
      },
    );

    expect(result.patch.labelIds).toEqual(['label_1']);
  });

  it('keeps template labels ahead of inferred labels when the task has none', () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Investigate checkout errors',
        description: 'Customers see a 500 after entering a postal code.',
        explicit: {},
        templateDefaults: { labelIds: ['template_label'] },
        availableTasks: [],
      },
      {
        description: 'Customers see a 500 after entering a postal code.',
        patch: { labelIds: ['inferred_label'] },
      },
    );

    expect(result.patch.labelIds).toEqual(['template_label']);
  });

  it('keeps only URLs that the task already cites and adds selected resources to the description', () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Investigate checkout errors',
        description: 'Read https://docs.example/checkout and compare the logs.',
        explicit: {},
        availableTasks: [],
        resources: [
          { title: 'Runbook', url: 'https://docs.example/runbook' },
          { title: 'Local note', url: null },
        ],
      },
      {
        description: 'Use https://docs.example/runbook and https://new.example/invented.',
        resourceUrls: [
          'https://docs.example/checkout',
          'https://docs.example/runbook',
          'https://new.example/invented',
          'mailto:person@example.com',
        ],
      },
    );

    expect(result.resourceUrls).toEqual([
      'https://docs.example/checkout',
      'https://docs.example/runbook',
    ]);
    expect(result.description).toContain('https://docs.example/checkout');
    expect(result.description).toContain('https://docs.example/runbook');
    expect(result.description).not.toContain('https://new.example/invented');
  });

  it('uses template defaults and inferred values only for fields a person has not chosen', () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Investigate checkout errors',
        description: null,
        templateDescription: '## Done when\n\nThe checkout works.',
        templateDefaults: { priority: 'low', labelIds: ['template_label'] },
        explicit: {
          priority: 'high',
          assigneeId: null,
          projectId: 'project_1',
          dueDate: null,
          startDate: '2026-08-26',
          estimateMinutes: null,
          labelIds: ['person_label'],
        },
        availableTasks: [],
      },
      {
        description: '',
        patch: {
          priority: 'medium',
          assigneeId: 'person_1',
          projectId: 'project_2',
          dueDate: '2026-08-27',
          startDate: '2026-08-28',
          estimateMinutes: 45,
          labelIds: ['inferred_label'],
        },
      },
    );

    expect(result.description).toBe('## Done when\n\nThe checkout works.');
    expect(result.patch).toEqual({
      assigneeId: 'person_1',
      dueDate: '2026-08-27',
      estimateMinutes: 45,
    });
  });

  it('keeps a supported child once and drops blank, duplicate, and unsupported candidates', () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Prepare release',
        description: 'Update the deployment checklist before the release.',
        explicit: {},
        availableTasks: [],
      },
      {
        description: 'Update the deployment checklist before the release.',
        subtasks: [
          {
            title: 'Update the deployment checklist',
            description: 'Check the required production settings.',
            evidence: 'Update the deployment checklist before the release.',
          },
          {
            title: 'Update the deployment checklist',
            evidence: 'Update the deployment checklist before the release.',
          },
          { title: '   ', evidence: 'Update the deployment checklist before the release.' },
          { title: 'Update the deployment checklist', evidence: 4 as never },
        ],
      },
    );

    expect(result.subtasks).toEqual([
      {
        title: 'Update the deployment checklist',
        description: 'Check the required production settings.',
        evidence: 'Update the deployment checklist before the release.',
      },
    ]);
  });

  it('keeps only valid task links and ignores repeated or unknown related tasks', () => {
    const result = constrainTaskExpansion(
      {
        taskId: 'task_1',
        title: 'Resolve payment request',
        description: 'Resolve payment request cannot start until Review gateway logs is complete.',
        explicit: {},
        availableTasks: [{ id: 'task_2', title: 'Review gateway logs' }],
      },
      {
        description: 'Resolve payment request cannot start until Review gateway logs is complete.',
        dependencies: [
          {
            blockingTaskId: 'task_2',
            blockedTaskId: 'task_1',
            evidence: 'Resolve payment request cannot start until Review gateway logs is complete.',
          },
          {
            blockingTaskId: 'task_2',
            blockedTaskId: 'task_1',
            evidence: 'Resolve payment request cannot start until Review gateway logs is complete.',
          },
          {
            blockingTaskId: 'unknown',
            blockedTaskId: 'task_1',
            evidence: 'Resolve payment request cannot start until Review gateway logs is complete.',
          },
          {
            blockingTaskId: 'task_2',
            blockedTaskId: 'task_2',
            evidence: 'Resolve payment request cannot start until Review gateway logs is complete.',
          },
        ],
        relatedTaskIds: ['task_1', 'task_2', 'task_2', 'unknown'],
      },
    );

    expect(result.dependencies).toEqual([
      {
        blockingTaskId: 'task_2',
        blockedTaskId: 'task_1',
        evidence: 'Resolve payment request cannot start until Review gateway logs is complete.',
      },
    ]);
    expect(result.relatedTaskIds).toEqual(['task_2']);
  });
});
