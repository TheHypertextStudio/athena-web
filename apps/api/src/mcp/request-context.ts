/**
 * `@docket/api` — the per-request MCP server handle, without threading it through every signature.
 *
 * @remarks
 * Descriptor resolution sits four or five calls below a tool handler and is reached from every
 * tool on the surface. Handing it the server explicitly would mean an extra parameter on
 * `resolveDescriptor`, `resolveOptional`, `resolveAcross`, `resolveSubject`, and every call site of
 * all four — for one capability that most of them never use.
 *
 * `AsyncLocalStorage` is the right tool for exactly this shape: a value scoped to one in-flight
 * request that deep code occasionally needs. It is per-request rather than module-global, so two
 * concurrent callers can never see each other's server — which a module-level variable would allow
 * the moment two requests overlap, and which would be a cross-tenant bug rather than a glitch.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { Elicitor } from './elicit';

/** What one in-flight MCP request carries beyond its arguments. */
interface RequestScope {
  /** The server handle, for server→client requests like elicitation. */
  readonly server: Elicitor;
}

const storage = new AsyncLocalStorage<RequestScope>();

/**
 * Run `fn` with `server` available to anything it calls.
 *
 * @param server - The per-request server.
 * @param fn - The work to run inside the scope.
 * @returns whatever `fn` returns.
 */
export function withRequestScope<T>(server: Elicitor, fn: () => Promise<T>): Promise<T> {
  return storage.run({ server }, fn);
}

/**
 * The current request's server, or null outside one.
 *
 * @remarks
 * Null is a normal answer, not an error: the agent loop and the test harness both call tool bodies
 * without an HTTP request around them, and neither can elicit. Callers treat null as "cannot ask".
 *
 * @returns the server, or null.
 */
export function currentElicitor(): Elicitor | null {
  return storage.getStore()?.server ?? null;
}
