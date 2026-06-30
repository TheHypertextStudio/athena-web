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
export {
  RealStripeGateway,
  type RealStripeGatewayConfig,
  type EmbeddedCheckoutSessionResult,
} from './billing';
export { RealProviderRuntime, type RealProviderRuntimeConfig } from './agent-runtime';
export { RealConnector, type RealConnectorConfig } from './connector';
export {
  buildAppJwt,
  decodeAppPrivateKey,
  mintInstallationToken,
  resolveInstallationAccount,
  InstallationTokenStore,
  type AppJwtInput,
  type GitHubAppConfig,
  type InstallationToken,
} from './connector-github-app';
export { RealLinearObserver, type RealLinearObserverConfig } from './observer-linear';
export { RealGitHubObserver, type RealGitHubObserverConfig } from './observer-github';
export {
  RealSummarizer,
  type RealSummarizerConfig,
  type MessageCreator,
  buildRequest as buildSummarizerRequest,
  extractMarkdown,
  defaultMessageCreator,
  DEFAULT_SUMMARIZER_MODEL,
} from './summarizer';
export {
  RealMailer,
  type RealMailerConfig,
  SmtpMailer,
  smtpConfigFromEnv,
  toSendMailOptions,
  defaultSmtpTransportFactory,
  type SmtpMailerConfig,
  type SmtpEnv,
  type SendMailOptions,
  type SmtpTransport,
  type SmtpTransportFactory,
} from './mailer';
export { RealBlob, type RealBlobConfig } from './blob';
export {
  RealTaskSynthesizer,
  type RealTaskSynthesizerConfig,
  DEFAULT_SYNTHESIS_MODEL,
} from './task-synthesizer';
