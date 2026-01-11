/**
 * Mock API server for e2e tests.
 *
 * Provides a simple HTTP server that mocks the backend API
 * for testing server components that fetch data server-side.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';

export interface MockApiServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

export interface MockRoute {
  method: string;
  path: string;
  response: unknown;
  status?: number;
}

const DEFAULT_ROUTES: MockRoute[] = [
  // Integrations
  {
    method: 'GET',
    path: '/api/integrations',
    response: { data: [] },
  },
  // User profile (for auth checks)
  {
    method: 'GET',
    path: '/api/users/me',
    response: {
      id: 'test-user-123',
      email: 'test@example.com',
      name: 'Test User',
    },
  },
  // Billing/subscription
  {
    method: 'GET',
    path: '/api/billing/subscription',
    response: {
      planTier: 'free',
      status: 'active',
    },
  },
];

/**
 * Start a mock API server for e2e testing.
 */
export async function startMockApiServer(
  port = 4000,
  additionalRoutes: MockRoute[] = [],
): Promise<MockApiServer> {
  const routes = [...DEFAULT_ROUTES, ...additionalRoutes];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${String(port)}`);
    const method = req.method ?? 'GET';

    // Find matching route
    const route = routes.find((r) => r.method === method && url.pathname === r.path);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (route) {
      res.writeHead(route.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(route.response));
    } else {
      // Default 404 for unmatched routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', path: url.pathname }));
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port already in use, try to connect to see if it's our server
        console.log(`Port ${String(port)} in use, assuming mock server is already running`);
        resolve({
          server,
          port,
          close: () => Promise.resolve(),
        });
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      console.log(`Mock API server running on port ${String(port)}`);
      resolve({
        server,
        port,
        close: () =>
          new Promise((resolveClose) => {
            server.close(() => {
              resolveClose();
            });
          }),
      });
    });
  });
}

/**
 * Stop the mock API server.
 */
export async function stopMockApiServer(mockServer: MockApiServer): Promise<void> {
  await mockServer.close();
}
