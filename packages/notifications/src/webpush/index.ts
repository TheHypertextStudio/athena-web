/**
 * `@docket/notifications/webpush` — the browser-safe half of the Web Push contract.
 *
 * @remarks
 * Subscription and message shapes plus the elicitation→notification mapping. The signing and
 * encrypting sender is deliberately NOT re-exported here: it imports `node:crypto`, and this
 * subpath is imported by the web app.
 */
export * from './types';
export * from './elicitation';
