/**
 * Test fixtures for Project Athena.
 *
 * @packageDocumentation
 */

import { faker } from '@faker-js/faker';
import type {
  Task,
  TaskId,
  UserId,
  ProjectId,
  Project,
  Initiative,
  InitiativeId,
  Event,
  EventId,
  TaskStatus,
  TaskPriority,
  ProjectStatus,
  InitiativeStatus,
} from '@athena/types';

/**
 * Create a mock Task fixture.
 */
export function createTaskFixture(overrides: Partial<Task> = {}): Task {
  const now = new Date();
  return {
    id: faker.string.uuid() as TaskId,
    title: faker.lorem.sentence({ min: 3, max: 8 }),
    description: faker.lorem.paragraph(),
    status: 'pending' as TaskStatus,
    priority: 'medium' as TaskPriority,
    deadline: faker.date.future(),
    estimatedMinutes: faker.number.int({ min: 15, max: 480 }),
    projectId: undefined,
    assigneeId: undefined,
    creatorId: faker.string.uuid() as UserId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock Project fixture.
 */
export function createProjectFixture(overrides: Partial<Project> = {}): Project {
  const now = new Date();
  return {
    id: faker.string.uuid() as ProjectId,
    name: faker.commerce.productName(),
    description: faker.lorem.paragraph(),
    status: 'active' as ProjectStatus,
    deadline: faker.date.future(),
    initiativeId: undefined,
    ownerId: faker.string.uuid() as UserId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock Initiative fixture.
 */
export function createInitiativeFixture(overrides: Partial<Initiative> = {}): Initiative {
  const now = new Date();
  return {
    id: faker.string.uuid() as InitiativeId,
    name: faker.company.catchPhrase(),
    description: faker.lorem.paragraph(),
    status: 'active' as InitiativeStatus,
    parentId: undefined,
    ownerId: faker.string.uuid() as UserId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock Event fixture.
 */
export function createEventFixture(overrides: Partial<Event> = {}): Event {
  const now = new Date();
  const startTime = faker.date.future();
  const endTime = new Date(startTime.getTime() + faker.number.int({ min: 30, max: 180 }) * 60000);

  return {
    id: faker.string.uuid() as EventId,
    title: faker.lorem.sentence({ min: 3, max: 6 }),
    description: faker.lorem.paragraph(),
    startTime,
    endTime,
    isAllDay: false,
    location: faker.location.streetAddress(),
    recurrenceRule: undefined,
    creatorId: faker.string.uuid() as UserId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create multiple fixtures.
 */
export function createMany<T>(
  factory: (overrides?: Partial<T>) => T,
  count: number,
  overrides: Partial<T> = {},
): T[] {
  return Array.from({ length: count }, () => factory(overrides));
}
