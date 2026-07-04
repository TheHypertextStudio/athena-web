/**
 * `@docket/discord-relay` — the entrypoint: hold the Discord Gateway socket and forward mentions.
 *
 * @remarks
 * The one always-on process Docket's serverless core can't be (see
 * `docs/engineering/specs/discord-observation.md`). It opens the Discord Gateway WebSocket with the
 * `MESSAGE_CONTENT` privileged intent, caches guild role membership (for `@role` expansion), and on
 * every `MESSAGE_CREATE` forwards mention-bearing messages to Docket's token ingest edge via the
 * pure {@link forwardMessage}. It holds NO business logic and NO Docket DB access — Docket's
 * `inbound_event` inbox is the source of truth, so a crash/reconnect loses nothing but a little
 * latency (the unique `(provider, external_event_id)` index makes any re-delivery a no-op).
 *
 * This module is the IO boundary (a live WebSocket) — it is verified by really running against a
 * test guild, not by unit tests (excluded from coverage). The testable logic lives in `expand.ts`
 * and `relay.ts`. Resume/sharding are intentionally out of scope for v1: on disconnect the relay
 * reconnects fresh, and Docket's inbox dedups anything re-sent.
 *
 * Config (env, fail-fast — no hidden defaults):
 * - `DISCORD_BOT_TOKEN`     — the bot token whose Gateway session this holds.
 * - `DOCKET_INGEST_URL`     — Docket's Discord ingest base: the API origin (`API_URL`) + `/internal/ingest/discord`.
 * - `DOCKET_INGEST_TOKEN`   — the per-integration `event_subscription.ingestToken`.
 */
import { forwardMessage } from './relay';
import type { DiscordMessage } from './expand';

/** Discord Gateway intents this relay needs (privileged: GUILD_MEMBERS, MESSAGE_CONTENT). */
const INTENTS =
  (1 << 0) | // GUILDS — guild lifecycle (role cache)
  (1 << 1) | // GUILD_MEMBERS — role membership for @role expansion (privileged)
  (1 << 9) | // GUILD_MESSAGES
  (1 << 12) | // DIRECT_MESSAGES
  (1 << 15); // MESSAGE_CONTENT — the message body (privileged)

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

/** Read a required env var or exit — no silent defaults (config fail-fast). */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[discord-relay] missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

/** The relay's resolved runtime config. */
interface RelayConfig {
  readonly botToken: string;
  readonly ingestUrl: string;
  readonly ingestToken: string;
}

/** Guild role → member user ids, cached from GUILD_CREATE, for `@role` mention expansion. */
type RoleMembers = Map<string, Map<string, Set<string>>>; // guildId -> roleId -> userIds

/** Build the `membersOfRole` resolver for a guild from the cache. */
function membersOfRoleFor(cache: RoleMembers, guildId: string | undefined) {
  return (roleId: string): string[] => {
    if (!guildId) return [];
    const byRole = cache.get(guildId);
    const set = byRole?.get(roleId);
    return set ? [...set] : [];
  };
}

/** Ingest a GUILD_CREATE payload into the role-membership cache. */
function cacheGuild(cache: RoleMembers, guild: Record<string, unknown>): void {
  const guildId = typeof guild['id'] === 'string' ? guild['id'] : undefined;
  if (!guildId) return;
  const byRole = new Map<string, Set<string>>();
  const members = Array.isArray(guild['members']) ? (guild['members'] as unknown[]) : [];
  for (const m of members) {
    const rec = m as Record<string, unknown>;
    const user = rec['user'] as Record<string, unknown> | undefined;
    const userId = typeof user?.['id'] === 'string' ? user['id'] : undefined;
    const roles = Array.isArray(rec['roles']) ? (rec['roles'] as unknown[]) : [];
    if (!userId) continue;
    for (const roleId of roles) {
      if (typeof roleId !== 'string') continue;
      let members = byRole.get(roleId);
      if (!members) {
        members = new Set();
        byRole.set(roleId, members);
      }
      members.add(userId);
    }
  }
  cache.set(guildId, byRole);
}

/** Open the Gateway socket and wire heartbeat + identify + dispatch handling. */
function connect(config: RelayConfig): void {
  const ws = new WebSocket(GATEWAY_URL);
  const roleCache: RoleMembers = new Map();
  let seq: number | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const send = (payload: unknown): void => {
    ws.send(JSON.stringify(payload));
  };

  ws.addEventListener('message', (event) => {
    const frame = JSON.parse(String(event.data)) as {
      op: number;
      s: number | null;
      t: string | null;
      d: unknown;
    };
    if (typeof frame.s === 'number') seq = frame.s;

    if (frame.op === 10) {
      // HELLO — start heartbeat, then IDENTIFY.
      const interval = (frame.d as { heartbeat_interval: number }).heartbeat_interval;
      heartbeat = setInterval(() => {
        send({ op: 1, d: seq });
      }, interval);
      send({
        op: 2,
        d: {
          token: config.botToken,
          intents: INTENTS,
          properties: { os: 'linux', browser: 'docket-relay', device: 'docket-relay' },
        },
      });
      return;
    }
    if (frame.op !== 0) return; // only dispatches from here

    if (frame.t === 'GUILD_CREATE') {
      cacheGuild(roleCache, frame.d as Record<string, unknown>);
      return;
    }
    if (frame.t === 'MESSAGE_CREATE') {
      const message = frame.d as DiscordMessage;
      void forwardMessage(message, {
        ingestUrl: config.ingestUrl,
        ingestToken: config.ingestToken,
        membersOfRole: membersOfRoleFor(roleCache, message.guild_id ?? undefined),
      }).catch((err: unknown) => {
        // Log and move on — Docket's inbox dedups, and the next delivery/retry is idempotent.
        console.error('[discord-relay] forward failed:', err);
      });
    }
  });

  ws.addEventListener('close', () => {
    if (heartbeat) clearInterval(heartbeat);
    console.warn('[discord-relay] gateway closed; reconnecting in 5s');
    setTimeout(() => {
      connect(config);
    }, 5_000);
  });

  ws.addEventListener('error', (err) => {
    console.error('[discord-relay] gateway error:', err);
  });
}

/** Boot the relay from env. */
function main(): void {
  const config: RelayConfig = {
    botToken: requireEnv('DISCORD_BOT_TOKEN'),
    ingestUrl: requireEnv('DOCKET_INGEST_URL'),
    ingestToken: requireEnv('DOCKET_INGEST_TOKEN'),
  };
  console.log('[discord-relay] connecting to the Discord Gateway…');
  connect(config);
}

main();
