/**
 * Mock implementations for testing.
 *
 * @packageDocumentation
 */

export * from './calendar.js';

interface LogEntry {
  level: string;
  message: string;
  data?: unknown;
}

/**
 * Create a mock logger that captures log calls.
 */
export function createMockLogger() {
  const logs: LogEntry[] = [];

  return {
    logs,
    debug: (message: string, data?: unknown) => logs.push({ level: 'debug', message, data }),
    info: (message: string, data?: unknown) => logs.push({ level: 'info', message, data }),
    warn: (message: string, data?: unknown) => logs.push({ level: 'warn', message, data }),
    error: (message: string, data?: unknown) => logs.push({ level: 'error', message, data }),
    clear: () => logs.splice(0, logs.length),
  };
}

/**
 * Create a mock fetch function.
 */
export function createMockFetch(responses: Map<string, Response>) {
  return (input: string | URL | Request): Promise<Response> => {
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      url = input.url;
    }

    const response = responses.get(url);

    if (!response) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    return Promise.resolve(response.clone());
  };
}

/**
 * Create a mock response.
 */
export function createMockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Wait for all pending promises to resolve.
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Create a deferred promise for testing async flows.
 */
export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
