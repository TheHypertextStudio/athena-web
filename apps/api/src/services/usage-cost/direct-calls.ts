import { LatticeAgentTurnRuntime } from '@docket/athena/turn/adapters/lattice';
/** Capture direct provider calls without confusing them with canonical session runs. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { MockAgentTurnRuntime, type AgentTurnRuntime, type TurnUsage } from '@docket/athena/turn';
import { aiCallUsage, db } from '@docket/db';

/** Attribution supplied by the authorized caller, never inferred from model content. */
export interface AiUsageScope {
  readonly source: string;
  readonly userId: string | null;
  readonly organizationId: string | null;
}
/** One completed or interrupted provider invocation. */
export type AiCallRecord = AiUsageScope &
  Pick<
    typeof aiCallUsage.$inferInsert,
    'model' | 'backend' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'
  >;
/** Persistence boundary shared by streaming and direct-message adapters. */
export type AiUsageRecorder = (record: AiCallRecord) => Promise<void>;
const scopeStorage = new AsyncLocalStorage<AiUsageScope>();

/** Bind attribution to one asynchronous operation without leaking it to concurrent requests. */
export function withAiUsage<T>(scope: AiUsageScope, operation: () => Promise<T>): Promise<T> {
  return scopeStorage.run(scope, operation);
}

/** Record metering failures separately while preserving the provider's original outcome. */
export async function recordAiCall(record: AiCallRecord): Promise<void> {
  try {
    await db.insert(aiCallUsage).values(record);
  } catch (error) {
    console.error('ai_call_usage_persistence_failed', { source: record.source, error });
  }
}

function measurement(scope: AiUsageScope, usage?: TurnUsage, backend?: 'lattice'): AiCallRecord {
  return {
    ...scope,
    model: usage?.model ?? null,
    backend: backend ?? null,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null,
    cacheWriteTokens: usage?.cacheCreationTokens ?? null,
  };
}

/** Retain terminal counts; early cancellation and provider failure remain explicitly unmeasured. */
export function meterTurnRuntime(
  runtime: AgentTurnRuntime,
  scope: AiUsageScope,
  record: AiUsageRecorder = recordAiCall,
): AgentTurnRuntime {
  if (runtime instanceof MockAgentTurnRuntime) return runtime;
  return {
    async *streamTurn(input) {
      let usage: TurnUsage | undefined;
      let backend: 'lattice' | undefined =
        runtime instanceof LatticeAgentTurnRuntime ? 'lattice' : undefined;
      try {
        for await (const event of runtime.streamTurn(input)) {
          if (event.type === 'turn_end') {
            usage = event.usage;
            backend = event.usageBackend;
          }
          yield event;
        }
      } finally {
        await record(measurement(scope, usage, backend));
      }
    },
  };
}

interface ProviderMessage {
  readonly model: string;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_read_input_tokens?: number | null;
    readonly cache_creation_input_tokens?: number | null;
  };
}

/** Capture the SDK response before its consumer parses output, including malformed responses. */
export function meterMessageCreator<Input, Output extends ProviderMessage>(
  create: (input: Input) => Promise<Output>,
  record: AiUsageRecorder = recordAiCall,
): (input: Input) => Promise<Output> {
  return async (input) => {
    const scope = scopeStorage.getStore();
    let message: Output | undefined;
    try {
      message = await create(input);
      return message;
    } finally {
      if (scope)
        await record(
          measurement(
            scope,
            message
              ? {
                  model: message.model,
                  inputTokens: message.usage.input_tokens,
                  outputTokens: message.usage.output_tokens,
                  cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
                  cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
                }
              : undefined,
          ),
        );
    }
  };
}
