/**
 * `@docket/discord-relay` — expand a Discord message's mentions into a flat set of user ids.
 *
 * @remarks
 * The one piece of real logic in the relay. Discord expresses "you were mentioned" four different
 * ways; Docket's substrate only wants a flat list of concrete user ids (it keeps the model simple —
 * see `docs/engineering/specs/discord-observation.md`). This pure function does that expansion:
 * direct `@user` mentions, `@role` mentions (expanded to role members via guild state the relay
 * caches), replies (the replied-to author), and DMs (the recipient). The message author is removed
 * (you aren't "mentioned" by your own message). No IO — the caller supplies role membership + DM
 * recipients so this stays unit-testable.
 */

/** The subset of a Discord `MESSAGE_CREATE` `d` object the relay reads. */
export interface DiscordMessage {
  /** The message snowflake (dedup id). */
  readonly id: string;
  /** The channel the message was posted in. */
  readonly channel_id: string;
  /** The guild the channel belongs to; absent/null for a direct message. */
  readonly guild_id?: string | null;
  /** The message body (requires the MESSAGE_CONTENT intent). */
  readonly content?: string;
  /** The message author. */
  readonly author?: { readonly id: string };
  /** Users directly `@`-mentioned in the message. */
  readonly mentions?: readonly { readonly id: string }[];
  /** Role ids `@`-mentioned in the message. */
  readonly mention_roles?: readonly string[];
  /** The message this one replies to, when it is a reply. */
  readonly referenced_message?: { readonly author?: { readonly id: string } } | null;
}

/** How the relay resolves the mention kinds it can't read off the message alone. */
export interface ExpandOptions {
  /** Resolve a role id to its member user ids (from the guild state the relay caches). */
  readonly membersOfRole: (roleId: string) => readonly string[];
  /** For a DM channel, the recipient user id(s); ignored for guild messages. */
  readonly dmRecipientIds?: readonly string[];
}

/**
 * Expand a message's direct/`@role`/reply/DM mentions into a flat, de-duplicated set of user ids,
 * excluding the author.
 *
 * @param message - The Discord message object.
 * @param opts - Role-member + DM-recipient resolution.
 * @returns the concrete mentioned user ids (order-stable by first appearance).
 */
export function expandMentionedUserIds(message: DiscordMessage, opts: ExpandOptions): string[] {
  const ids = new Set<string>();
  for (const m of message.mentions ?? []) ids.add(m.id);
  for (const roleId of message.mention_roles ?? []) {
    for (const uid of opts.membersOfRole(roleId)) ids.add(uid);
  }
  const replyTarget = message.referenced_message?.author?.id;
  if (replyTarget) ids.add(replyTarget);
  if (!message.guild_id) {
    for (const uid of opts.dmRecipientIds ?? []) ids.add(uid);
  }
  // You aren't mentioned by your own message.
  if (message.author?.id) ids.delete(message.author.id);
  return [...ids];
}
