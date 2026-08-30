/** The supported Lovelace Lattice SDK surface used by Docket. */
export {
  LatticeClient,
  LatticeError,
  PersonalRuntimeRequiresUserTokenError,
  PersonalRuntimeUnreachableError,
  personalRuntimeTarget,
  type ChatCompletionsChoice as OpenAiChatCompletionChoice,
  type ChatCompletionsRequest,
  type ChatCompletionsResponse as OpenAiChatCompletionResponse,
  type ChatMessage as OpenAiChatMessage,
  type LatticeApiKeyCredential,
  type LatticeClientOptions,
  type LatticeCredential,
  type LatticeModelSelector,
  type LatticeOAuthCredential,
  type PersonalRuntimeChatCompletionsRequest,
  type PersonalRuntimeSelector,
  type PersonalRuntimeTarget,
  type PersonalRuntimeTextGenerationRequest,
  type TextGenerationRequest,
  type TextGenerationResponse,
} from '@reasonabletech/lattice-client';

export {
  PERSONAL_LATTICE_COMPATIBILITY_MODEL_ALIAS,
  type PersonalLatticeRuntimeResource,
  type PersonalLatticeRuntimeStatus,
} from '@lovelace-ai/compute';

/** Production gateway default used in Docket-owned assertions and operator output. */
export const LATTICE_GATEWAY_BASE_URL = 'https://lattice.uselovelace.com';
