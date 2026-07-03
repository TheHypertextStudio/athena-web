/**
 * `@docket/boundaries/ports` — the typed interfaces (ports) for every external edge.
 *
 * @remarks
 * Each port is a pure TS interface with no I/O: `BillingGateway`, `AgentRuntime`,
 * `Connector`, `Mailer`, `BlobStore` (plus the small DTOs each needs). Adapters in
 * `../real` and `../mock` implement them; {@link selectAdapter} chooses one per port
 * from the validated env. See `boundaries.md` for the full boundary catalogue.
 */
export type {
  BillingEvent,
  BillingEventType,
  BillingGateway,
  BillingPortalSessionResult,
  CheckoutSessionInput,
  CheckoutSessionResult,
  Subscription,
  SubscriptionStatus,
} from './billing';
export type {
  AgentRuntime,
  SessionActionBody,
  SessionActivity,
  SessionActivityApproval,
  SessionActivityType,
  StartSessionInput,
} from './agent-runtime';
export type {
  ConnectInput,
  ConnectionResult,
  Connector,
  ConnectorProvider,
  ExternalWriteResult,
  ImportWorkInput,
  ImportedItem,
  ItemProvenance,
  LinkResourceInput,
  LinkResult,
  ListContainersInput,
  MirrorResult,
  MirrorStatusInput,
  PushTaskInput,
  ResourceRef,
  TaskPushOp,
  WritableConnector,
} from './connector';
export { WRITE_BACK_CAPABLE_PROVIDERS } from './connector';
export type {
  FetchThreadInput,
  ListThreadsInput,
  MailAction,
  MailActionInput,
  MailActions,
  MailListPage,
  MailMessage,
  MailThread,
  MailThreadSummary,
} from './mail';
export { MAIL_CAPABLE_PROVIDERS } from './mail';
export { ConnectorError, isConnectorError } from './connector-error';
export type { TaskDraft, TaskDraftInput, TaskSynthesizer } from './task-synthesizer';
export { TITLE_MAX, truncateTitle } from './task-synthesizer';
export type { ConnectorErrorKind, ConnectorErrorOptions } from './connector-error';
export type {
  EventActorRef,
  EventDraft,
  EventEntityRef,
  InboundHeaders,
  InboundRouting,
  Observer,
  ObserverProvider,
  RawInboundEvent,
  VerifySignatureInput,
} from './observer';
export type {
  SummarizeInput,
  SummarizeResult,
  Summarizer,
  SummarizerObservation,
} from './summarizer';
export type { Mailer, OutboundMessage, SentMessage } from './mailer';
export type { BlobPutResult, BlobStore } from './blob';
