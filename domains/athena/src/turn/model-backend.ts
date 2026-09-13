/**
 * Model-backend selection for Athena turns.
 *
 * This is the single domain decision point for which model serves a turn, whether it is routed,
 * and which credential belongs to that backend. Delivery runtimes consume the resolved descriptor
 * and runtime rather than duplicating tier selection in containers or request handlers.
 */
import type { AgentTurnRuntime } from './turn';
import { MockAgentTurnRuntime } from './turn';
import { RealAgentTurnRuntime } from './adapters/anthropic';
import {
  DEFAULT_VERTEX_LOCATION,
  DEFAULT_VERTEX_MODEL,
  VertexAgentTurnRuntime,
} from './adapters/vertex';

/** Supported Athena model backend tiers. */
export type ModelBackendId =
  'cloudflare-router' | 'anthropic-direct' | 'vertex' | 'lattice' | 'mock';

/** Every supported tier, in the deliberate preference order Athena uses. */
export const MODEL_BACKEND_IDS: readonly ModelBackendId[] = [
  'lattice',
  'cloudflare-router',
  'anthropic-direct',
  'vertex',
  'mock',
];

/** Application-owned description of a selected model backend. */
export interface ModelBackendDescriptor {
  /** Stable backend id. */
  readonly id: ModelBackendId;
  /** Application-owned label safe to render in operator-facing surfaces. */
  readonly label: string;
  /** Whether traffic passes through Cloudflare's model router. */
  readonly routed: boolean;
  /** Whether an operator, rather than Docket, supplied the endpoint and credential. */
  readonly userSupplied: boolean;
  /** Endpoint used for turns, or null for the provider default endpoint. */
  readonly baseURL: string | null;
  /** Model id Athena requests. */
  readonly model: string;
}

/** The selected descriptor plus a lazy builder for the matching turn runtime. */
export interface ModelBackend {
  /** Safe description of the selected tier. */
  readonly descriptor: ModelBackendDescriptor;
  /** Build the runtime only if a turn actually needs to run. */
  turnRuntime(): AgentTurnRuntime;
}

/** Configuration an operator provides for an Anthropic-compatible Lattice endpoint. */
export interface LatticeBackendConfig {
  /** Messages-compatible endpoint. */
  readonly baseURL: string;
  /** Operator credential for that endpoint. */
  readonly apiKey: string;
  /** Optional model override. */
  readonly model?: string;
}

/** Environment values that influence model-backend selection. */
export interface ModelBackendEnv {
  /** Local and test modes always use the deterministic script. */
  readonly APP_MODE?: 'local' | 'test' | 'production';
  /** Docket-owned Anthropic provider key. */
  readonly ANTHROPIC_API_KEY?: string;
  /** Cloudflare model-router endpoint. */
  readonly CLOUDFLARE_AI_GATEWAY_BASE_URL?: string;
  /** Cloudflare model-router credential. */
  readonly CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
  /** Model override for the selected tier. */
  readonly ATHENA_MODEL?: string;
  /** Google Cloud project used with Application Default Credentials. */
  readonly GOOGLE_CLOUD_PROJECT?: string;
  /** Vertex location. The global endpoint is the default. */
  readonly GOOGLE_CLOUD_LOCATION?: string;
  /** Operator-supplied Lattice endpoint. */
  readonly ATHENA_LATTICE_BASE_URL?: string;
  /** Operator-supplied Lattice credential. */
  readonly ATHENA_LATTICE_API_KEY?: string;
}

/** Optional injection points for tests and delivery-level composition. */
export interface ResolveModelBackendOptions {
  /** Force a tier instead of deriving it from the environment. */
  readonly force?: ModelBackendId;
  /** Substitute the live runtime builder without mutating global state. */
  readonly buildTurnRuntime?: (
    descriptor: ModelBackendDescriptor,
    credential: string,
  ) => AgentTurnRuntime;
}

/** Default model for every live Athena tier. */
export const DEFAULT_ATHENA_MODEL = 'claude-opus-4-8';

/** Model id the deterministic local backend reports without making a request. */
export const MOCK_ATHENA_MODEL = 'mock-turn-script';

/** Application-owned labels for all known tiers. */
const BACKEND_LABEL: Readonly<Record<ModelBackendId, string>> = {
  'cloudflare-router': 'Docket model router',
  'anthropic-direct': 'Docket direct model access',
  vertex: 'Docket Vertex AI',
  lattice: 'Your Lovelace Lattice instance',
  mock: 'Local scripted model',
};

/** Error thrown when a selected backend lacks the configuration it requires. */
export class ModelBackendConfigError extends Error {
  /** Id of the invalid backend tier. */
  readonly backendId: ModelBackendId;

  /** Create an error that lists every missing configuration key. */
  constructor(backendId: ModelBackendId, missing: readonly string[]) {
    super(`Athena model backend "${backendId}" is missing config: ${missing.join(', ')}`);
    this.name = 'ModelBackendConfigError';
    this.backendId = backendId;
  }
}

/** Whether a configuration value is present rather than empty or whitespace-only. */
function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Select a tier from the environment without building its runtime. */
export function selectModelBackendId(env: ModelBackendEnv): ModelBackendId {
  if (env.APP_MODE === 'local' || env.APP_MODE === 'test') return 'mock';
  if (present(env.ATHENA_LATTICE_BASE_URL) && present(env.ATHENA_LATTICE_API_KEY)) return 'lattice';
  if (present(env.CLOUDFLARE_AI_GATEWAY_BASE_URL) && present(env.CLOUDFLARE_AI_GATEWAY_TOKEN)) {
    return 'cloudflare-router';
  }
  if (present(env.ANTHROPIC_API_KEY)) return 'anthropic-direct';
  if (present(env.GOOGLE_CLOUD_PROJECT)) return 'vertex';
  return 'anthropic-direct';
}

function describeVertexBackend(env: ModelBackendEnv): ModelBackendDescriptor {
  if (!present(env.GOOGLE_CLOUD_PROJECT)) {
    throw new ModelBackendConfigError('vertex', ['GOOGLE_CLOUD_PROJECT']);
  }
  return {
    id: 'vertex',
    label: BACKEND_LABEL.vertex,
    routed: false,
    userSupplied: false,
    baseURL: 'https://aiplatform.googleapis.com',
    model: present(env.ATHENA_MODEL) ? env.ATHENA_MODEL : DEFAULT_VERTEX_MODEL,
  };
}

function describeAnthropicDirectBackend(
  env: ModelBackendEnv,
  model: string,
): ModelBackendDescriptor {
  if (!present(env.ANTHROPIC_API_KEY)) {
    throw new ModelBackendConfigError('anthropic-direct', ['ANTHROPIC_API_KEY']);
  }
  return {
    id: 'anthropic-direct',
    label: BACKEND_LABEL['anthropic-direct'],
    routed: false,
    userSupplied: false,
    baseURL: null,
    model,
  };
}

/** Build a safe descriptor for one tier, or identify all missing required values. */
function describeBackend(id: ModelBackendId, env: ModelBackendEnv): ModelBackendDescriptor {
  const model = present(env.ATHENA_MODEL) ? env.ATHENA_MODEL : DEFAULT_ATHENA_MODEL;

  switch (id) {
    case 'mock':
      return {
        id,
        label: BACKEND_LABEL[id],
        routed: false,
        userSupplied: false,
        baseURL: null,
        model: MOCK_ATHENA_MODEL,
      };

    case 'lattice': {
      const missing = [
        ...(present(env.ATHENA_LATTICE_BASE_URL) ? [] : ['ATHENA_LATTICE_BASE_URL']),
        ...(present(env.ATHENA_LATTICE_API_KEY) ? [] : ['ATHENA_LATTICE_API_KEY']),
      ];
      if (missing.length > 0) throw new ModelBackendConfigError(id, missing);
      return {
        id,
        label: BACKEND_LABEL[id],
        routed: false,
        userSupplied: true,
        baseURL: env.ATHENA_LATTICE_BASE_URL ?? null,
        model,
      };
    }

    case 'cloudflare-router': {
      const missing = [
        ...(present(env.CLOUDFLARE_AI_GATEWAY_BASE_URL) ? [] : ['CLOUDFLARE_AI_GATEWAY_BASE_URL']),
        ...(present(env.CLOUDFLARE_AI_GATEWAY_TOKEN) ? [] : ['CLOUDFLARE_AI_GATEWAY_TOKEN']),
        ...(present(env.ANTHROPIC_API_KEY) ? [] : ['ANTHROPIC_API_KEY']),
      ];
      if (missing.length > 0) throw new ModelBackendConfigError(id, missing);
      return {
        id,
        label: BACKEND_LABEL[id],
        routed: true,
        userSupplied: false,
        baseURL: env.CLOUDFLARE_AI_GATEWAY_BASE_URL ?? null,
        model,
      };
    }

    case 'anthropic-direct':
      return describeAnthropicDirectBackend(env, model);

    case 'vertex':
      return describeVertexBackend(env);
  }
}

/** Return the selected tier's credential after {@link describeBackend} has validated it. */
function backendCredential(id: ModelBackendId, env: ModelBackendEnv): string {
  if (id === 'lattice') return env.ATHENA_LATTICE_API_KEY ?? '';
  if (id === 'mock' || id === 'vertex') return '';
  return env.ANTHROPIC_API_KEY ?? '';
}

/** Build the live Anthropic-compatible adapter for a resolved descriptor. */
function defaultTurnRuntime(
  descriptor: ModelBackendDescriptor,
  credential: string,
  env: ModelBackendEnv,
): AgentTurnRuntime {
  if (descriptor.id === 'mock') return new MockAgentTurnRuntime();
  if (descriptor.id === 'vertex') {
    return new VertexAgentTurnRuntime({
      projectId: env.GOOGLE_CLOUD_PROJECT ?? '',
      location: present(env.GOOGLE_CLOUD_LOCATION)
        ? env.GOOGLE_CLOUD_LOCATION
        : DEFAULT_VERTEX_LOCATION,
      model: descriptor.model,
    });
  }

  return new RealAgentTurnRuntime({
    apiKey: credential,
    model: descriptor.model,
    ...(descriptor.baseURL ? { baseURL: descriptor.baseURL } : {}),
    ...(descriptor.routed && present(env.CLOUDFLARE_AI_GATEWAY_TOKEN)
      ? { gatewayToken: env.CLOUDFLARE_AI_GATEWAY_TOKEN }
      : {}),
  });
}

/**
 * Resolve Athena's model backend and lazily build the matching one-turn runtime.
 *
 * The descriptor intentionally omits credentials. A runtime is constructed only when a delivery
 * path runs a turn, so ordinary API requests do not require eager SDK client construction.
 */
export function resolveModelBackend(
  env: ModelBackendEnv,
  options: ResolveModelBackendOptions = {},
): ModelBackend {
  const id = options.force ?? selectModelBackendId(env);
  const descriptor = describeBackend(id, env);
  const credential = backendCredential(id, env);
  let built: AgentTurnRuntime | undefined;

  return {
    descriptor,
    turnRuntime(): AgentTurnRuntime {
      built ??= options.buildTurnRuntime
        ? options.buildTurnRuntime(descriptor, credential)
        : defaultTurnRuntime(descriptor, credential, env);
      return built;
    },
  };
}
