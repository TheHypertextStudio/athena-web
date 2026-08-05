/**
 * The hardened outbound HTTP boundary, under a name that is not about MCP.
 *
 * @remarks
 * The implementation lives in `mcp-network.ts` because MCP was the first caller, but nothing about
 * it is MCP-specific: it is HTTPS-only, resolves DNS and rejects every non-public address, pins the
 * validated address at connect time so a rebind cannot swap it, re-validates on every redirect hop
 * while stripping credentials cross-origin, and bounds redirects, time, headers, and body size.
 *
 * This module exists so a second caller — URL unfurling, which fetches genuinely attacker-chosen
 * URLs — reaches the same code by an honest name instead of copying it. A second implementation of
 * an SSRF guard is how the first one stops being true.
 */
export {
  createMcpSafeFetch as createSafeOutboundFetch,
  mcpSafeFetch as safeOutboundFetch,
  type McpDnsLookup as SafeDnsLookup,
  type McpLookupAddress as SafeLookupAddress,
  type McpNetworkLimits as SafeNetworkLimits,
  type McpPinnedRequest as SafePinnedRequest,
} from './mcp-network';
