/**
 * `@docket/discord-relay` — build the ingest envelope + forward a mention-bearing message to Docket.
 *
 * @remarks
 * The relay's only outbound: an HTTP POST to Docket's token-routed ingest edge
 * (`POST /internal/ingest/discord/:token`), authenticated by the per-integration ingest token (not
 * a Discord signature — the relay is a trusted Docket component). The forwarded envelope mirrors a
 * Gateway dispatch (`{ t, d }`) plus the relay's flat mention expansion (`mentioned_user_ids`),
 * which the Discord observer's `normalize` reads. Only messages that actually mention someone are
 * forwarded — the relay is a filter, not a firehose. `fetch` is injected so this is unit-testable
 * without a network.
 */
import { type DiscordMessage, type ExpandOptions, expandMentionedUserIds } from './expand';

/** The envelope the relay POSTs to Docket (mirrors a Gateway `MESSAGE_CREATE` dispatch). */
export interface RelayEnvelope {
  /** The Gateway dispatch type. */
  readonly t: 'MESSAGE_CREATE';
  /** The Discord message object, forwarded as-is. */
  readonly d: DiscordMessage;
  /** The relay's flat mention expansion (direct/@role/reply/DM → concrete user ids). */
  readonly mentioned_user_ids: readonly string[];
}

/** Where + how to reach Docket's token ingest edge. */
export interface ForwardConfig {
  /** The ingest base URL: the API origin (`API_URL`) + `/internal/ingest/discord`. */
  readonly ingestUrl: string;
  /** The per-integration ingest token (the `event_subscription.ingestToken`). */
  readonly ingestToken: string;
  /** Injected HTTP transport (defaults to the global `fetch`). */
  readonly fetch?: typeof fetch;
}

/** Build the relay envelope for a message + its expanded mentions. */
export function buildEnvelope(
  message: DiscordMessage,
  mentionedUserIds: readonly string[],
): RelayEnvelope {
  return { t: 'MESSAGE_CREATE', d: message, mentioned_user_ids: mentionedUserIds };
}

/**
 * Forward one message to Docket's token ingest edge, iff it mentions someone.
 *
 * @param message - The Discord message object.
 * @param config - Ingest target + token + role/DM resolution.
 * @returns `true` when forwarded and accepted; `false` when the message mentions nobody (skipped).
 * @throws when the ingest edge is unreachable or rejects the delivery (the caller decides retry).
 */
export async function forwardMessage(
  message: DiscordMessage,
  config: ForwardConfig & ExpandOptions,
): Promise<boolean> {
  const mentioned = expandMentionedUserIds(message, config);
  if (mentioned.length === 0) return false;
  const doFetch = config.fetch ?? fetch;
  const url = `${config.ingestUrl.replace(/\/+$/, '')}/${config.ingestToken}`;
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildEnvelope(message, mentioned)),
  });
  if (!res.ok) {
    throw new Error(`ingest edge rejected the delivery: ${String(res.status)}`);
  }
  return true;
}
