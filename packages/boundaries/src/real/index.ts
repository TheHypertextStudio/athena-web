/**
 * `@docket/boundaries/real` — the env-driven adapters that talk to real services.
 *
 * @remarks
 * `RealStripeGateway`, `RealProviderRuntime`, `RealConnector`, `RealMailer`,
 * `RealBlob` — each constructed purely from validated env values and performing its
 * I/O through an injectable {@link HttpClient}. Selected only when the required env
 * value is present and real-shaped (see {@link selectAdapter}). Flipping to prod is
 * purely supplying env values; no third code path exists.
 */
export { defaultHttpClient, type HttpClient } from './http';
export { RealStripeGateway, type RealStripeGatewayConfig } from './billing';
export { RealProviderRuntime, type RealProviderRuntimeConfig } from './agent-runtime';
export { RealConnector, type RealConnectorConfig } from './connector';
export { RealMailer, type RealMailerConfig } from './mailer';
export { RealBlob, type RealBlobConfig } from './blob';
