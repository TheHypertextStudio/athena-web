/**
 * `@docket/integrations/mcp-apps` — the browser-safe MCP Apps entry point.
 *
 * @remarks
 * The package barrel reaches Node-only edges (mail transports, provider HTTP clients, the MCP
 * network guard). The MCP Apps host bridge and sandbox proxy reach none of them — they are pure
 * message handling — so they get their own entry point and the web app imports that instead of
 * dragging a server-side dependency graph into a browser bundle.
 */
export * from './mcp-apps-host';
export * from './mcp-apps-sandbox';
