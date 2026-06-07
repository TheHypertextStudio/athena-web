/**
 * `@docket/boundaries/mock` — deterministic, offline adapters backed by fixtures.
 *
 * @remarks
 * `InMemoryBillingGateway`, `MockAgentRuntime`, `MockConnector`, `CaptureMailer`,
 * `ConsoleMailer`, `LocalDiskBlob` — fully offline implementations of the ports used
 * by the autonomous build, tests, and `APP_MODE ∈ {local,test}`. They consume the
 * `../fixtures` sample data and never read the wall clock or use randomness, so the
 * suites that exercise the real business logic against them are stable.
 */
export { InMemoryBillingGateway, type InMemoryBillingGatewayOptions } from './billing';
export { MockAgentRuntime, type MockAgentRuntimeOptions } from './agent-runtime';
export { MockConnector, type MockConnectorOptions } from './connector';
export { CaptureMailer, type CaptureMailerOptions, ConsoleMailer } from './mailer';
export { LocalDiskBlob, type LocalDiskBlobOptions } from './blob';
