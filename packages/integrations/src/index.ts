/**
 * Provider integration contracts, fixtures, test doubles, and concrete adapters.
 *
 * @remarks
 * This package owns third-party provider surfaces such as connectors, mail actions,
 * work graph reads, and activity observers. Runtime composition lives in the app layer.
 */
export * from './connector';
export * from './connector-error';
export * from './event-detail';
export * from './fixtures';
export * from './github-app';
export * from './http';
export * from './json';
export * from './linear-agent';
export * from './mail';
export * from './mcp-connector';
export * from './mcp-oauth';
export * from './mock-connector';
export * from './mock-linear-agent';
export * from './mock-observer';
export * from './observer';
export * from './observer-github';
export * from './observer-linear';
export * from './observer-slack';
export * from './provider-client';
export * from './push';
export * from './real-connector';
export * from './sms';
export * from './work-graph';
