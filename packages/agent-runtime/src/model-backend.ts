/**
 * `@docket/agent-runtime` — the model-backend seam Athena's turn loop runs on.
 *
 * @remarks
 * Athena has exactly one place where "which model, reached how, paid for by whom" is decided.
 * That decision is deliberately NOT spread across the container, the loop and the summarizer:
 * every one of them asks {@link resolveModelBackend} and gets back a descriptor plus a ready
 * {@link AgentTurnRuntime}.
 *
 * Why the seam exists at all, rather than "just call Anthropic": the product ships on
 * Cloudflare's model router with Docket's own keys (so a customer needs no AI account to use
 * Athena), and a later tier lets an operator point Athena at their own Lovelace Lattice
 * instance instead. Those two are the SAME shape — an Anthropic-Messages-compatible endpoint
 * reached at a different base URL with a different credential — so they must not be two code
 * paths that drift. {@link ModelBackendId} enumerates the tiers; adding one is a compile error
 * everywhere it must be handled.
 *
 * The descriptor carries application-owned copy only. Nothing here ever surfaces a provider
 * error string, a key, or a URL to a person.
 */
import type { AgentTurnRuntime } from './agent-turn';
import { MockAgentTurnRuntime } from './agent-turn';
import { RealAgentTurnRuntime } from './real-agent-turn';

/** Which backend tier is serving Athena's turns. */
export type ModelBackendId = 'cloudflare-router' | 'anthropic-direct' | 'lattice' | 'mock';

/** Every backend tier, in the order {@link resolveModelBackend} prefers them. */
export const MODEL_BACKEND_IDS: readonly ModelBackendId[] = [
  'lattice',
  'cloudflare-router',
  'anthropic-direct',
  'mock',
];

/**
 * What a backend is, in terms a surface may render.
 *
 * @remarks
 * `label` is application-owned copy. `baseURL` is present for operator diagnostics only and is
 * never rendered to an end user; it never carries a credential (credentials travel in headers,
 * which this type has no field for on purpose).
 */
export interface ModelBackendDescriptor {
  /** The tier. */
  readonly id: ModelBackendId;
  /** Application-owned name for this tier. */
  readonly label: string;
  /** True when traffic is routed through Cloudflare rather than sent to the provider directly. */
  readonly routed: boolean;
  /** True when the credential and endpoint belong to the operator, not to Docket. */
  readonly userSupplied: boolean;
  /** The endpoint turns are sent to, or `null` when the provider default applies. */
  readonly baseURL: string | null;
  /** The model id turns are requested with. */
  readonly model: string;
}

/** A resolved backend: what it is, and the turn runtime that speaks to it. */
export interface ModelBackend {
  /** What this backend is. */
  readonly descriptor: ModelBackendDescriptor;
  /** Build (or return) the turn runtime for this backend. */
  turnRuntime(): AgentTurnRuntime;
}

/**
 * An operator-owned Lovelace Lattice instance.
 *
 * @remarks
 * Lattice exposes an Anthropic-Messages-compatible surface, which is exactly why it plugs into
 * this seam rather than needing an adapter of its own: the only things that change are the base
 * URL, the credential, and the default model id.
 */
export interface LatticeBackendConfig {
  /** The instance's Messages-compatible base URL. */
  readonly baseURL: string;
  /** The instance credential. */
  readonly apiKey: string;
  /** Model id override for this instance. */
  readonly model?: string;
}

/** The environment values the seam reads. */
export interface ModelBackendEnv {
  /** `local`/`test` select the deterministic mock backend. */
  readonly APP_MODE?: 'local' | 'test' | 'production' | undefined;
  /** Docket's own provider key. */
  readonly ANTHROPIC_API_KEY?: string | undefined;
  /** Cloudflare model-router base URL. */
  readonly CLOUDFLARE_AI_GATEWAY_BASE_URL?: string | undefined;
  /** Cloudflare model-router credential. */
  readonly CLOUDFLARE_AI_GATEWAY_TOKEN?: string | undefined;
  /** Model id override applied to whichever tier is selected. */
  readonly ATHENA_MODEL?: string | undefined;
  /** Operator-supplied Lovelace Lattice base URL. */
  readonly ATHENA_LATTICE_BASE_URL?: string | undefined;
  /** Operator-supplied Lovelace Lattice credential. */
  readonly ATHENA_LATTICE_API_KEY?: string | undefined;
}

/** Optional injection points; tests and the container use these instead of monkey-patching. */
export interface ResolveModelBackendOptions {
  /** Force a tier instead of deriving it from the environment. */
  readonly force?: ModelBackendId;
  /** Build the turn runtime for a resolved descriptor (tests substitute a fake edge). */
  readonly buildTurnRuntime?: (
    descriptor: ModelBackendDescriptor,
    credential: string,
  ) => AgentTurnRuntime;
}

/** The model id Athena requests when nothing overrides it. */
export const DEFAULT_ATHENA_MODEL = 'claude-opus-4-8';

/** The model the deterministic local backend reports; no request is ever made with it. */
export const MOCK_ATHENA_MODEL = 'mock-turn-script';

/** Application-owned copy for each tier. */
const BACKEND_LABEL: Readonly<Record<ModelBackendId, string>> = {
  'cloudflare-router': 'Docket model router',
  'anthropic-direct': 'Docket direct model access',
  lattice: 'Your Lovelace Lattice instance',
  mock: 'Local scripted model',
};

/** Thrown when a tier is selected but its configuration is incomplete. */
export class ModelBackendConfigError extends Error {
  /** The tier whose configuration is incomplete. */
  readonly backendId: ModelBackendId;

  /**
   * @param backendId - The tier that could not be built.
   * @param missing - The environment variable names that must be set.
   */
  constructor(backendId: ModelBackendId, missing: readonly string[]) {
    super(`Athena model backend "${backendId}" is missing config: ${missing.join(', ')}`);
    this.name = 'ModelBackendConfigError';
    this.backendId = backendId;
  }
}

/** True for a value that is present and not an empty/whitespace placeholder. */
function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Decide which tier the environment selects, without building anything.
 *
 * @remarks
 * Preference order is deliberate and is the product decision, not a fallback chain of
 * convenience: an operator who configured their own Lattice instance meant it, so it wins;
 * otherwise Docket's own routed access is the default the product ships with; direct provider
 * access exists for the case where the router is unavailable; and local/test always run the
 * deterministic script so no test can accidentally spend money or need a network.
 *
 * @param env - The environment to read.
 * @returns the selected tier.
 */
export function selectModelBackendId(env: ModelBackendEnv): ModelBackendId {
  if (env.APP_MODE === 'local' || env.APP_MODE === 'test') return 'mock';
  if (present(env.ATHENA_LATTICE_BASE_URL) && present(env.ATHENA_LATTICE_API_KEY)) return 'lattice';
  if (present(env.CLOUDFLARE_AI_GATEWAY_BASE_URL) && present(env.CLOUDFLARE_AI_GATEWAY_TOKEN)) {
    return 'cloudflare-router';
  }
  return 'anthropic-direct';
}

/** Build the descriptor for one tier, or explain exactly which variables are missing. */
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
        /* v8 ignore next -- unreachable: the `missing` check above already required
           `present(env.ATHENA_LATTICE_BASE_URL)`, so it is always a defined, non-empty string
           here; this only narrows the `string | undefined` env field's type. */
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
        /* v8 ignore next -- unreachable: the `missing` check above already required
           `present(env.CLOUDFLARE_AI_GATEWAY_BASE_URL)`, so it is always a defined, non-empty
           string here; this only narrows the `string | undefined` env field's type. */
        baseURL: env.CLOUDFLARE_AI_GATEWAY_BASE_URL ?? null,
        model,
      };
    }
    case 'anthropic-direct': {
      if (!present(env.ANTHROPIC_API_KEY)) {
        throw new ModelBackendConfigError(id, ['ANTHROPIC_API_KEY']);
      }
      return {
        id,
        label: BACKEND_LABEL[id],
        routed: false,
        userSupplied: false,
        baseURL: null,
        model,
      };
    }
  }
}

/** The credential a tier authenticates its turns with. */
function backendCredential(id: ModelBackendId, env: ModelBackendEnv): string {
  // `resolveModelBackend` always calls `describeBackend` (which validates the tier's required
  // variables and throws `ModelBackendConfigError` when one is missing) before this — so by the
  // time this runs, whichever credential a resolved `id` needs is already known to be present.
  // The `?? ''` fallbacks below are therefore never actually exercised at runtime; they stay
  // un-ignored because the `if (id === …)` branch they share a line with IS meaningfully tested.
  if (id === 'lattice') return env.ATHENA_LATTICE_API_KEY ?? '';
  if (id === 'mock') return '';
  return env.ANTHROPIC_API_KEY ?? '';
}

/** Build the live turn runtime for a descriptor, honouring the router's extra credential. */
function defaultTurnRuntime(
  descriptor: ModelBackendDescriptor,
  credential: string,
  env: ModelBackendEnv,
): AgentTurnRuntime {
  if (descriptor.id === 'mock') return new MockAgentTurnRuntime();
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
 * Resolve the model backend Athena's turns run on.
 *
 * @remarks
 * The runtime is built lazily: constructing a live SDK client at resolve time would make a
 * process that never runs a turn still require a credential.
 *
 * @param env - The environment to read.
 * @param options - Force a tier, or substitute the runtime construction (tests).
 * @returns the descriptor and a lazily-built turn runtime.
 * @throws {ModelBackendConfigError} When the selected tier's configuration is incomplete.
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
