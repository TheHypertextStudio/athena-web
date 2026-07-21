/**
 * `@docket/integrations` — `MockLinearAgent`.
 *
 * @remarks
 * The offline test double for the Linear Agent platform boundary
 * ({@link import('./linear-agent')}), used in `APP_MODE=test`/local dev — and, practically,
 * everywhere until a real Agent app is registered with Linear. No network, no timers: every
 * OAuth/GraphQL call is answered deterministically and recorded so tests can assert on exactly
 * what was sent, mirroring {@link import('./mock-connector').MockConnector}'s record-and-replay
 * shape. Method names match the real module's exported function names 1:1 (minus the leading
 * `client` argument the real free functions take — here `this` plays that role), so a
 * composition root swapping the real adapter for this mock is a one-line change.
 */
import type {
  AgentActivityCreateInput,
  AgentSessionUpdateInput,
  ExchangeLinearAgentCodeInput,
  LinearAgentOAuthTokens,
  LinearAgentPort,
  RefreshLinearAgentTokenInput,
} from './linear-agent';

/** One `agentActivityCreate` call recorded by {@link MockLinearAgent}, plus its assigned fake id. */
export interface RecordedLinearAgentActivity extends AgentActivityCreateInput {
  readonly id: string;
}

/** One `agentSessionUpdate` call recorded by {@link MockLinearAgent}. */
export type RecordedLinearAgentSessionUpdate = AgentSessionUpdateInput;

/**
 * A deterministic, offline double for the Linear Agent platform boundary.
 *
 * @remarks
 * `exchangeLinearAgentCode`/`refreshLinearAgentToken` return a fixed-shape fake token pair
 * (never a real one — there is nothing to exchange with, offline); `agentActivityCreate`/
 * `agentSessionUpdate` append to {@link MockLinearAgent.activityLog}/
 * {@link MockLinearAgent.sessionUpdateLog} and return deterministic fake ids, so a test can
 * both drive the boundary and assert what the agent runtime tried to post.
 */
export class MockLinearAgent implements LinearAgentPort {
  private counter = 0;

  /** Every `agentActivityCreate` call received, in call order (record-only, no I/O). */
  readonly activityLog: RecordedLinearAgentActivity[] = [];

  /** Every `agentSessionUpdate` call received, in call order (record-only, no I/O). */
  readonly sessionUpdateLog: RecordedLinearAgentSessionUpdate[] = [];

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter.toString().padStart(6, '0')}`;
  }

  /** A deterministic fake token pair, shaped like a real {@link LinearAgentOAuthTokens}. */
  private fakeTokens(): LinearAgentOAuthTokens {
    return {
      accessToken: this.nextId('mock-linear-agent-token'),
      tokenType: 'Bearer',
      expiresIn: 86_400,
      scope: 'app:mentionable,app:assignable',
      refreshToken: this.nextId('mock-linear-agent-refresh'),
    };
  }

  /**
   * Mirrors {@link import('./linear-agent').exchangeLinearAgentCode} — a fake token pair, no
   * network. The input is intentionally unread: an offline double has no code to validate.
   */
  async exchangeLinearAgentCode(
    _input: ExchangeLinearAgentCodeInput,
  ): Promise<LinearAgentOAuthTokens> {
    return this.fakeTokens();
  }

  /**
   * Mirrors {@link import('./linear-agent').refreshLinearAgentToken} — a fresh fake token pair,
   * no network.
   */
  async refreshLinearAgentToken(
    _input: RefreshLinearAgentTokenInput,
  ): Promise<LinearAgentOAuthTokens> {
    return this.fakeTokens();
  }

  /**
   * Mirrors {@link import('./linear-agent').agentActivityCreate} — records the call onto
   * {@link MockLinearAgent.activityLog} and returns a deterministic fake activity id.
   */
  async agentActivityCreate(input: AgentActivityCreateInput): Promise<{ id: string }> {
    const id = this.nextId('mock-linear-activity');
    this.activityLog.push({ ...input, id });
    return { id };
  }

  /**
   * Mirrors {@link import('./linear-agent').agentSessionUpdate} — records the call onto
   * {@link MockLinearAgent.sessionUpdateLog}. No return value, matching the real mutation.
   */
  async agentSessionUpdate(input: AgentSessionUpdateInput): Promise<void> {
    this.sessionUpdateLog.push({ ...input });
  }
}
