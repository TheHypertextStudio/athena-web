/**
 * MCP (Model Context Protocol) integration tests.
 *
 * Tests actual MCP server functionality using mocked database.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../../src/services/mcp/server.js';

type MockQueryFn<T> = ((...args: unknown[]) => Promise<T>) & {
  mockResolvedValue: (val: T) => MockQueryFn<T>;
  mockResolvedValueOnce: (val: T) => MockQueryFn<T>;
  mockClear: () => void;
};

interface MockDb {
  query: Record<string, Record<string, MockQueryFn<unknown>>>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

const parseJson = (text: string): unknown => JSON.parse(text) as unknown;

const getTextContent = (content: unknown): { type: 'text'; text: string } => {
  if (!content || typeof content !== 'object') {
    throw new Error('Expected content block');
  }
  const typed = content as { type?: string; text?: string };
  if (typed.type !== 'text' || typeof typed.text !== 'string') {
    throw new Error('Expected text content');
  }
  return { type: 'text', text: typed.text };
};

// Create mock database
const mockDb = vi.hoisted((): MockDb => {
  const mockFn = <T>(returnValue: T): MockQueryFn<T> => {
    let currentReturn = returnValue;
    const onceValues: T[] = [];
    const fn = Object.assign(
      (..._args: unknown[]) => {
        const nextValue = onceValues.length > 0 ? onceValues.shift() : undefined;
        const resolved = nextValue ?? currentReturn;
        return Promise.resolve(resolved);
      },
      {
        mockResolvedValue: (val: T) => {
          currentReturn = val;
          return fn;
        },
        mockResolvedValueOnce: (val: T) => {
          onceValues.push(val);
          return fn;
        },
        mockClear: () => {
          onceValues.length = 0;
        },
      },
    );
    return fn as MockQueryFn<T>;
  };
  return {
    query: {
      initiatives: { findMany: mockFn([]), findFirst: mockFn(null) },
      projects: { findMany: mockFn([]), findFirst: mockFn(null) },
      tasks: { findMany: mockFn([]), findFirst: mockFn(null) },
      events: { findMany: mockFn([]), findFirst: mockFn(null) },
      eventParticipants: { findMany: mockFn([]), findFirst: mockFn(null) },
      moments: { findMany: mockFn([]), findFirst: mockFn(null) },
      activityStreams: { findMany: mockFn([]), findFirst: mockFn(null) },
      activities: { findMany: mockFn([]), findFirst: mockFn(null) },
      tags: { findMany: mockFn([]), findFirst: mockFn(null) },
      timeEntries: { findMany: mockFn([]), findFirst: mockFn(null) },
      workspaces: { findMany: mockFn([]), findFirst: mockFn(null) },
      userSettings: { findFirst: mockFn(null) },
      subscriptions: { findFirst: mockFn(null) },
      linkedIntegrations: { findMany: mockFn([]), findFirst: mockFn(null) },
      taskDependencies: { findMany: mockFn([]), findFirst: mockFn(null) },
      projectDependencies: { findMany: mockFn([]), findFirst: mockFn(null) },
      onboardingProgress: { findFirst: mockFn(null) },
      users: {
        findFirst: mockFn({
          id: 'test-user-id',
          name: 'Test User',
          email: 'test@example.com',
          emailVerified: true,
          createdAt: new Date(),
        }),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({})),
        returning: vi.fn(() => Promise.resolve([{ id: 'new-id' }])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(undefined)),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(undefined)),
    })),
  };
});

vi.mock('../../src/db/index.js', () => ({ db: mockDb }));

describe('MCP Server - Resources', () => {
  let client: Client;
  let serverTransport: InMemoryTransport;
  let clientTransport: InMemoryTransport;

  beforeEach(async () => {
    // Reset mocks
    Object.values(mockDb.query).forEach((entity) => {
      Object.values(entity).forEach((fn) => {
        fn.mockClear();
      });
    });
    mockDb.insert.mockClear();
    mockDb.update.mockClear();
    mockDb.delete.mockClear();

    // Create in-memory transport pair for testing
    [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    // Create and connect MCP server
    const mcpServer = createMcpServer('test-user-id');
    await mcpServer.connect(serverTransport);

    // Create client
    client = new Client({
      name: 'test-client',
      version: '1.0.0',
    });
    await client.connect(clientTransport);
  });

  it('should list all available resources', async () => {
    const result = await client.listResources();

    expect(result.resources).toBeDefined();
    expect(result.resources.length).toBeGreaterThan(0);

    const resourceUris = result.resources.map((r) => r.uri);
    expect(resourceUris).toContain('athena://tasks');
    expect(resourceUris).toContain('athena://tasks/today');
    expect(resourceUris).toContain('athena://tasks/pending');
    expect(resourceUris).toContain('athena://projects');
    expect(resourceUris).toContain('athena://events');
    expect(resourceUris).toContain('athena://events/upcoming');
    expect(resourceUris).toContain('athena://initiatives');
    expect(resourceUris).toContain('athena://agenda');
  });

  it('should list resource templates', async () => {
    const result = await client.listResourceTemplates();

    expect(result.resourceTemplates).toBeDefined();
    const templateUris = result.resourceTemplates.map((t) => t.uriTemplate);
    expect(templateUris).toContain('athena://tasks/{taskId}');
    expect(templateUris).toContain('athena://projects/{projectId}');
    expect(templateUris).toContain('athena://events/{eventId}');
    expect(templateUris).toContain('athena://initiatives/{initiativeId}');
  });

  it('should read tasks resource with actual data', async () => {
    const mockTasks = [
      {
        id: 'task-1',
        title: 'Test Task 1',
        status: 'pending',
        priority: 'high',
        creatorId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'task-2',
        title: 'Test Task 2',
        status: 'completed',
        priority: 'medium',
        creatorId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockDb.query.tasks.findMany.mockResolvedValue(mockTasks);

    const result = await client.readResource({ uri: 'athena://tasks' });

    expect(result.contents).toBeDefined();
    expect(result.contents.length).toBe(1);
    expect(result.contents[0].mimeType).toBe('application/json');

    const data = parseJson(result.contents[0].text as string) as { title: string }[];
    expect(data.length).toBe(2);
    expect(data[0].title).toBe('Test Task 1');
    expect(data[1].title).toBe('Test Task 2');
  });

  it('should read task by template URI', async () => {
    const mockTask = {
      id: 'task-123',
      title: 'Template Task',
      status: 'pending',
      priority: 'medium',
      creatorId: 'test-user-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDb.query.tasks.findFirst.mockResolvedValue(mockTask);

    const result = await client.readResource({ uri: 'athena://tasks/task-123' });

    expect(result.contents).toBeDefined();
    const data = parseJson(result.contents[0].text as string) as { id: string; title: string };
    expect(data.id).toBe('task-123');
    expect(data.title).toBe('Template Task');
  });

  it('should read projects resource', async () => {
    const mockProjects = [
      {
        id: 'project-1',
        name: 'Project Alpha',
        ownerId: 'test-user-id',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockDb.query.projects.findMany.mockResolvedValue(mockProjects);

    const result = await client.readResource({ uri: 'athena://projects' });

    expect(result.contents).toBeDefined();
    const data = parseJson(result.contents[0].text as string) as { name: string }[];
    expect(data[0].name).toBe('Project Alpha');
  });

  it('should read initiatives resource', async () => {
    const mockInitiatives = [
      {
        id: 'initiative-1',
        name: 'Initiative One',
        ownerId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockDb.query.initiatives.findMany.mockResolvedValue(mockInitiatives);

    const result = await client.readResource({ uri: 'athena://initiatives' });

    expect(result.contents).toBeDefined();
    const data = parseJson(result.contents[0].text as string) as { name: string }[];
    expect(data[0].name).toBe('Initiative One');
  });

  it('should read events resource', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        title: 'Team Meeting',
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600000),
        creatorId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockDb.query.events.findMany.mockResolvedValue(mockEvents);

    const result = await client.readResource({ uri: 'athena://events' });

    expect(result.contents).toBeDefined();
    const data = parseJson(result.contents[0].text as string) as { title: string }[];
    expect(data[0].title).toBe('Team Meeting');
  });

  it('should read upcoming events resource', async () => {
    const mockEvents = [
      {
        id: 'event-1',
        title: 'Upcoming Event',
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600000),
        creatorId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockDb.query.events.findMany.mockResolvedValue(mockEvents);

    const result = await client.readResource({ uri: 'athena://events/upcoming' });

    expect(result.contents).toBeDefined();
    const data = parseJson(result.contents[0].text as string) as { title: string }[];
    expect(data[0].title).toBe('Upcoming Event');
  });

  it('should read tasks due today resource', async () => {
    const mockTasks = [
      {
        id: 'task-1',
        title: 'Today Task',
        status: 'pending',
        priority: 'medium',
        creatorId: 'test-user-id',
        deadline: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockDb.query.tasks.findMany.mockResolvedValue(mockTasks);

    const result = await client.readResource({ uri: 'athena://tasks/today' });

    expect(result.contents).toBeDefined();
    const data = parseJson(result.contents[0].text as string) as { title: string }[];
    expect(data[0].title).toBe('Today Task');
  });

  it('should read pending tasks resource', async () => {
    const mockTasks = [
      {
        id: 'task-1',
        title: 'Pending Task',
        status: 'pending',
        priority: 'high',
        creatorId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockDb.query.tasks.findMany.mockResolvedValue(mockTasks);

    const result = await client.readResource({ uri: 'athena://tasks/pending' });

    expect(result.contents).toBeDefined();
    const data = parseJson(result.contents[0].text as string) as { title: string }[];
    expect(data[0].title).toBe('Pending Task');
  });

  it('should read agenda with tasks and events', async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    mockDb.query.tasks.findMany.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Due today',
        deadline: today,
        status: 'pending',
        creatorId: 'test-user-id',
      },
    ]);
    mockDb.query.events.findMany.mockResolvedValue([
      { id: 'event-1', title: 'Meeting today', startTime: today, creatorId: 'test-user-id' },
    ]);

    const result = await client.readResource({ uri: 'athena://agenda' });

    expect(result.contents).toBeDefined();
    const data = parseJson(result.contents[0].text as string) as {
      date: string;
      tasks: unknown[];
      events: unknown[];
    };
    expect(data.date).toBeDefined();
    expect(data.tasks).toBeDefined();
    expect(data.events).toBeDefined();
  });
});

describe('MCP Server - Tools', () => {
  let client: Client;
  let serverTransport: InMemoryTransport;
  let clientTransport: InMemoryTransport;

  beforeEach(async () => {
    Object.values(mockDb.query).forEach((entity) => {
      Object.values(entity).forEach((fn) => {
        fn.mockClear();
      });
    });
    mockDb.insert.mockClear();
    mockDb.update.mockClear();
    mockDb.delete.mockClear();

    [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    const mcpServer = createMcpServer('test-user-id');
    await mcpServer.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  it('should list all available tools', async () => {
    const result = await client.listTools();

    expect(result.tools).toBeDefined();
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain('list_tasks');
    expect(toolNames).toContain('create_task');
    expect(toolNames).toContain('update_task');
    expect(toolNames).toContain('complete_task');
    expect(toolNames).toContain('list_events');
    expect(toolNames).toContain('create_event');
    expect(toolNames).toContain('update_event');
    expect(toolNames).toContain('search_tasks');
    expect(toolNames).toContain('get_agenda');
    expect(toolNames).toContain('get_availability');
  });

  it('should call list_tasks tool with filters', async () => {
    const mockTasks = [
      { id: 'task-1', title: 'List Task', status: 'pending', creatorId: 'test-user-id' },
    ];
    mockDb.query.tasks.findMany.mockResolvedValue(mockTasks);

    const result = await client.callTool({
      name: 'list_tasks',
      arguments: {
        status: 'pending',
        limit: 10,
      },
    });

    const content = getTextContent(result.content[0]);
    const data = parseJson(content.text) as { items: { title: string }[]; nextCursor?: string };
    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.title).toBe('List Task');
  });

  it('should call create_task tool and create a task', async () => {
    const result = await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'New Task from MCP',
        description: 'Created via MCP tool call',
        priority: 'high',
      },
    });

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    const content = getTextContent(result.content[0]);
    expect(content.type).toBe('text');
    const payload = parseJson(content.text) as { action: string; title: string; taskId: string };
    expect(payload.action).toBe('create_task');
    expect(payload.title).toBe('New Task from MCP');
    expect(payload.taskId).toBeDefined();
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should call update_task tool', async () => {
    const taskId = '550e8400-e29b-41d4-a716-446655440005';
    const existingTask = {
      id: taskId,
      title: 'Old Title',
      creatorId: 'test-user-id',
    };
    mockDb.query.tasks.findFirst.mockResolvedValue(existingTask);

    const result = await client.callTool({
      name: 'update_task',
      arguments: {
        taskId,
        title: 'Updated Title',
      },
    });

    expect(result.content).toBeDefined();
    const content = getTextContent(result.content[0]);
    const payload = parseJson(content.text) as { action: string; taskId: string };
    expect(payload.action).toBe('update_task');
    expect(payload.taskId).toBe(taskId);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should call complete_task tool with valid task', async () => {
    const taskId = '550e8400-e29b-41d4-a716-446655440001';
    const existingTask = {
      id: taskId,
      title: 'Existing Task',
      status: 'pending',
      creatorId: 'test-user-id',
    };
    mockDb.query.tasks.findFirst.mockResolvedValue(existingTask);

    const result = await client.callTool({
      name: 'complete_task',
      arguments: {
        taskId,
      },
    });

    expect(result.content).toBeDefined();
    const content = getTextContent(result.content[0]);
    expect(content.type).toBe('text');
    const payload = parseJson(content.text) as { action: string; taskId: string };
    expect(payload.action).toBe('complete_task');
    expect(payload.taskId).toBe(taskId);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should return error when completing non-existent task', async () => {
    mockDb.query.tasks.findFirst.mockResolvedValue(null);
    const taskId = '550e8400-e29b-41d4-a716-446655440002';

    const result = await client.callTool({
      name: 'complete_task',
      arguments: {
        taskId,
      },
    });

    expect(result.content).toBeDefined();
    const content = getTextContent(result.content[0]);
    const payload = parseJson(content.text) as { error: string };
    expect(payload.error).toBe('task_not_found');
    expect(result.isError).toBe(true);
  });

  it('should call search_tasks tool and find matching tasks', async () => {
    const matchingTasks = [
      {
        id: 'task-1',
        title: 'API Development',
        description: 'Build REST API',
        status: 'pending',
        creatorId: 'test-user-id',
      },
      {
        id: 'task-2',
        title: 'API Testing',
        description: 'Write tests',
        status: 'pending',
        creatorId: 'test-user-id',
      },
    ];
    mockDb.query.tasks.findMany.mockResolvedValue(matchingTasks);

    const result = await client.callTool({
      name: 'search_tasks',
      arguments: {
        query: 'API',
      },
    });

    expect(result.content).toBeDefined();
    const content = getTextContent(result.content[0]);
    const data = parseJson(content.text) as { title: string }[];
    expect(data.length).toBe(2);
    expect(data.every((t: { title: string }) => t.title.includes('API'))).toBe(true);
  });

  it('should respect search_tasks limit', async () => {
    const matchingTasks = Array.from({ length: 12 }).map((_, index) => ({
      id: `task-${String(index)}`,
      title: `API Task ${String(index)}`,
      description: 'Build REST API',
      status: 'pending',
      creatorId: 'test-user-id',
    }));
    mockDb.query.tasks.findMany.mockResolvedValue(matchingTasks);

    const result = await client.callTool({
      name: 'search_tasks',
      arguments: {
        query: 'API',
        limit: 5,
      },
    });

    const content = getTextContent(result.content[0]);
    const data = parseJson(content.text) as unknown[];
    expect(data.length).toBe(5);
  });

  it('should call list_events tool', async () => {
    const mockEvents = [
      { id: 'event-1', title: 'List Event', startTime: new Date(), creatorId: 'test-user-id' },
    ];
    mockDb.query.events.findMany.mockResolvedValue(mockEvents);

    const result = await client.callTool({
      name: 'list_events',
      arguments: {
        limit: 5,
      },
    });

    const content = getTextContent(result.content[0]);
    const data = parseJson(content.text) as { items: { title: string }[]; nextCursor?: string };
    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.title).toBe('List Event');
  });

  it('should call create_event tool', async () => {
    const result = await client.callTool({
      name: 'create_event',
      arguments: {
        title: 'Project Kickoff',
        startTime: new Date().toISOString(),
        description: 'Initial project meeting',
      },
    });

    expect(result.content).toBeDefined();
    const content = getTextContent(result.content[0]);
    const payload = parseJson(content.text) as { action: string; title: string; eventId: string };
    expect(payload.action).toBe('create_event');
    expect(payload.title).toBe('Project Kickoff');
    expect(payload.eventId).toBeDefined();
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should call update_event tool', async () => {
    const eventId = '550e8400-e29b-41d4-a716-446655440006';
    const existingEvent = {
      id: eventId,
      title: 'Planning Session',
      creatorId: 'test-user-id',
    };
    mockDb.query.events.findFirst.mockResolvedValue(existingEvent);

    const result = await client.callTool({
      name: 'update_event',
      arguments: {
        eventId,
        title: 'Updated Session',
      },
    });

    expect(result.content).toBeDefined();
    const content = getTextContent(result.content[0]);
    const payload = parseJson(content.text) as { action: string; eventId: string };
    expect(payload.action).toBe('update_event');
    expect(payload.eventId).toBe(eventId);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should call get_agenda tool for specific date', async () => {
    mockDb.query.tasks.findMany.mockResolvedValue([
      {
        id: 't1',
        title: 'Task for date',
        deadline: new Date(),
        status: 'pending',
        creatorId: 'test-user-id',
      },
    ]);
    mockDb.query.events.findMany.mockResolvedValue([
      { id: 'e1', title: 'Event for date', startTime: new Date(), creatorId: 'test-user-id' },
    ]);

    const result = await client.callTool({
      name: 'get_agenda',
      arguments: {
        date: new Date().toISOString().split('T')[0],
      },
    });

    expect(result.content).toBeDefined();
    const content = getTextContent(result.content[0]);
    const data = parseJson(content.text) as { date: string; tasks: unknown[]; events: unknown[] };
    expect(data.date).toBeDefined();
    expect(data.tasks).toBeDefined();
    expect(data.events).toBeDefined();
  });

  it('should call get_availability tool', async () => {
    mockDb.query.events.findMany.mockResolvedValue([
      {
        id: 'e1',
        title: 'Busy',
        startTime: new Date('2026-01-05T10:00:00Z'),
        endTime: new Date('2026-01-05T11:00:00Z'),
      },
    ]);

    const result = await client.callTool({
      name: 'get_availability',
      arguments: {
        startDate: '2026-01-05T09:00:00Z',
        endDate: '2026-01-05T12:00:00Z',
      },
    });

    const content = getTextContent(result.content[0]);
    const data = parseJson(content.text) as { range: unknown; busy: unknown[]; free: unknown[] };
    expect(data.range).toBeDefined();
    expect(data.busy.length).toBe(1);
    expect(data.free.length).toBeGreaterThan(0);
  });
});

describe('MCP Server - Prompts', () => {
  let client: Client;
  let serverTransport: InMemoryTransport;
  let clientTransport: InMemoryTransport;

  beforeEach(async () => {
    Object.values(mockDb.query).forEach((entity) => {
      Object.values(entity).forEach((fn) => {
        fn.mockClear();
      });
    });
    mockDb.insert.mockClear();
    mockDb.update.mockClear();
    mockDb.delete.mockClear();

    [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    const mcpServer = createMcpServer('test-user-id');
    await mcpServer.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  it('should list all available prompts', async () => {
    const result = await client.listPrompts();

    expect(result.prompts).toBeDefined();
    const promptNames = result.prompts.map((p) => p.name);
    expect(promptNames).toContain('daily_summary');
    expect(promptNames).toContain('daily_planning');
    expect(promptNames).toContain('task_planning');
    expect(promptNames).toContain('progress_report');
    expect(promptNames).toContain('task_breakdown');
    expect(promptNames).toContain('weekly_review');
  });

  it('should get daily_summary prompt with agenda summary', async () => {
    mockDb.query.tasks.findMany.mockResolvedValue([
      {
        id: 't1',
        title: 'Summary task',
        deadline: new Date(),
        status: 'completed',
        creatorId: 'test-user-id',
      },
    ]);
    mockDb.query.events.findMany.mockResolvedValue([
      { id: 'e1', title: 'Summary event', startTime: new Date(), creatorId: 'test-user-id' },
    ]);

    const result = await client.getPrompt({ name: 'daily_summary' });

    expect(result.messages).toBeDefined();
    const content = result.messages[0].content as { type: 'text'; text: string };
    expect(content.text).toContain('daily summary');
  });

  it('should get daily_planning prompt with agenda context', async () => {
    mockDb.query.tasks.findMany.mockResolvedValue([
      {
        id: 't1',
        title: 'Morning task',
        deadline: new Date(),
        status: 'pending',
        creatorId: 'test-user-id',
      },
    ]);
    mockDb.query.events.findMany.mockResolvedValue([
      { id: 'e1', title: 'Team standup', startTime: new Date(), creatorId: 'test-user-id' },
    ]);

    const result = await client.getPrompt({ name: 'daily_planning' });

    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0].role).toBe('user');

    const content = result.messages[0].content as { type: 'text'; text: string };
    expect(content.text).toContain('agenda');
    expect(content.text).toContain('prioritize');
  });

  it('should get task_planning prompt', async () => {
    mockDb.query.tasks.findMany.mockResolvedValue([
      { id: 't1', title: 'Priority task', status: 'pending', creatorId: 'test-user-id' },
    ]);

    const result = await client.getPrompt({ name: 'task_planning' });

    expect(result.messages).toBeDefined();
    const content = result.messages[0].content as { type: 'text'; text: string };
    expect(content.text).toContain('pending tasks');
  });

  it('should get progress_report prompt', async () => {
    mockDb.query.tasks.findMany.mockResolvedValue([
      { id: 't1', title: 'Progress task', status: 'pending', creatorId: 'test-user-id' },
    ]);

    const result = await client.getPrompt({ name: 'progress_report', arguments: {} });

    expect(result.messages).toBeDefined();
    const content = result.messages[0].content as { type: 'text'; text: string };
    expect(content.text).toContain('progress report');
  });

  it('should get task_breakdown prompt with task context', async () => {
    const taskId = '550e8400-e29b-41d4-a716-446655440003';
    const taskToBreakdown = {
      id: taskId,
      title: 'Implement authentication',
      description: 'Add OAuth and session management',
      priority: 'high',
      creatorId: 'test-user-id',
    };
    mockDb.query.tasks.findFirst.mockResolvedValue(taskToBreakdown);

    const result = await client.getPrompt({
      name: 'task_breakdown',
      arguments: { taskId },
    });

    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);

    const content = result.messages[0].content as { type: 'text'; text: string };
    expect(content.text).toContain('Implement authentication');
    expect(content.text).toContain('subtasks');
  });

  it('should return task_breakdown prompt error for missing task', async () => {
    mockDb.query.tasks.findFirst.mockResolvedValue(null);
    const taskId = '550e8400-e29b-41d4-a716-446655440004';

    const result = await client.getPrompt({
      name: 'task_breakdown',
      arguments: { taskId },
    });

    expect(result.messages).toBeDefined();
    const content = result.messages[0].content as { type: 'text'; text: string };
    expect(content.text).toContain('Task not found');
  });

  it('should get weekly_review prompt with accomplishments', async () => {
    mockDb.query.tasks.findMany
      .mockResolvedValueOnce([{ id: 't1', title: 'Completed task', status: 'completed' }]) // completed tasks
      .mockResolvedValueOnce([{ id: 't2', title: 'Pending task', status: 'pending' }]); // pending tasks
    mockDb.query.events.findMany.mockResolvedValue([
      { id: 'e1', title: 'Upcoming event', startTime: new Date() },
    ]);

    const result = await client.getPrompt({ name: 'weekly_review' });

    expect(result.messages).toBeDefined();
    const content = result.messages[0].content as { type: 'text'; text: string };
    expect(content.text).toContain('weekly');
    expect(content.text).toContain('reflect');
  });
});

describe('MCP Server - Utilities', () => {
  let client: Client;
  let serverTransport: InMemoryTransport;
  let clientTransport: InMemoryTransport;

  beforeEach(async () => {
    Object.values(mockDb.query).forEach((entity) => {
      Object.values(entity).forEach((fn) => {
        fn.mockClear();
      });
    });
    mockDb.insert.mockClear();
    mockDb.update.mockClear();
    mockDb.delete.mockClear();

    [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    const mcpServer = createMcpServer('test-user-id');
    await mcpServer.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  it('should return completion options for resource template IDs', async () => {
    const mockTasks = [
      { id: 'task-111', title: 'Alpha task', creatorId: 'test-user-id' },
      { id: 'task-222', title: 'Beta task', creatorId: 'test-user-id' },
    ];
    mockDb.query.tasks.findMany.mockResolvedValue(mockTasks);

    const result = await client.complete({
      ref: { type: 'ref/resource', uri: 'athena://tasks/{taskId}' },
      argument: { name: 'taskId', value: 'task-1' },
    });

    expect(result.completion.values).toContain('task-111');
  });

  it('should include a next cursor when list_tasks has more data', async () => {
    const mockTasks = Array.from({ length: 3 }).map((_, index) => ({
      id: `task-${String(index)}`,
      title: `Task ${String(index)}`,
      status: 'pending',
      creatorId: 'test-user-id',
    }));
    mockDb.query.tasks.findMany.mockResolvedValue(mockTasks);

    const result = await client.callTool({
      name: 'list_tasks',
      arguments: {
        limit: 2,
      },
    });

    const content = getTextContent(result.content[0]);
    const data = parseJson(content.text) as { items: { title: string }[]; nextCursor?: string };
    expect(data.items).toHaveLength(2);
    expect(data.nextCursor).toBe('2');
  });

  it('should emit resource list changed notifications for task changes', async () => {
    const notificationPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('resource list change not received'));
      }, 1000);
      client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'Notification Task',
      },
    });

    await notificationPromise;
  });

  it('should emit resource updated notifications for subscribed resources', async () => {
    const notificationPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('resource update not received'));
      }, 1000);
      client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
        clearTimeout(timeout);
        resolve(notification.params.uri);
      });
    });

    await client.subscribeResource({ uri: 'athena://tasks' });
    await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'Subscribed Task',
      },
    });

    const uri = await notificationPromise;
    expect(uri.startsWith('athena://tasks')).toBe(true);
  });
});
