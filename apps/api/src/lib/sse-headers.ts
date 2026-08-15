/**
 * `@docket/api` — the response headers a Server-Sent Events stream needs to survive the network.
 *
 * @remarks
 * Hono's `streamSSE` sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and
 * `Connection: keep-alive`. Those are the three the SSE specification talks about, and they are
 * not enough to get a stream through the machines between this process and a browser.
 *
 * Two more matter, and both fail in the same direction — the connection looks alive at each end
 * while nothing arrives:
 *
 * - **`X-Accel-Buffering: no`.** nginx and several other reverse proxies buffer a proxied
 *   response by default and only flush when the buffer fills. A stream that emits a small frame
 *   every few seconds, and a heartbeat when it has nothing to say, never fills anything — so the
 *   client sits in silence past its own timeout while the proxy holds the frames. This header is
 *   the conventional opt-out, honored by nginx and by most managed proxies that imitate it.
 * - **`no-transform`.** Without it an intermediary is free to compress or otherwise rewrite the
 *   body (RFC 9111 §5.2.2.6). Compressing an event stream reintroduces exactly the buffering
 *   `X-Accel-Buffering` just turned off, because a compressor has to accumulate input before it
 *   can emit anything. The MCP transport already sends `no-cache, no-transform` for this reason;
 *   this makes the product's own streams say the same thing.
 *
 * Wrap the value `streamSSE` returns, rather than setting headers on the context first:
 * `streamSSE` writes its own `Cache-Control` while building the response, so anything set
 * beforehand is overwritten and silently lost.
 */

/**
 * Declare a response un-bufferable and un-rewritable by anything between here and the client.
 *
 * @param response - The streaming response to annotate.
 * @returns the same response, with the streaming headers applied.
 */
export function declareStreaming(response: Response): Response {
  response.headers.set('Cache-Control', 'no-cache, no-transform');
  response.headers.set('X-Accel-Buffering', 'no');
  return response;
}
