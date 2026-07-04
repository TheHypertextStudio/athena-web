import { describe, expect, it } from 'vitest';

import { type DiscordMessage, expandMentionedUserIds } from '../src/expand';

const noRoles = { membersOfRole: () => [] as string[] };

describe('expandMentionedUserIds', () => {
  it('collects direct @user mentions', () => {
    const msg: DiscordMessage = {
      id: 'M1',
      channel_id: 'C1',
      guild_id: 'G1',
      mentions: [{ id: 'U2' }, { id: 'U3' }],
    };
    expect(expandMentionedUserIds(msg, noRoles)).toEqual(['U2', 'U3']);
  });

  it('expands @role mentions to role members', () => {
    const msg: DiscordMessage = {
      id: 'M1',
      channel_id: 'C1',
      guild_id: 'G1',
      mention_roles: ['R1'],
    };
    const opts = { membersOfRole: (r: string) => (r === 'R1' ? ['U5', 'U6'] : []) };
    expect(expandMentionedUserIds(msg, opts)).toEqual(['U5', 'U6']);
  });

  it('adds the replied-to author for a reply', () => {
    const msg: DiscordMessage = {
      id: 'M1',
      channel_id: 'C1',
      guild_id: 'G1',
      referenced_message: { author: { id: 'U9' } },
    };
    expect(expandMentionedUserIds(msg, noRoles)).toEqual(['U9']);
  });

  it('adds DM recipients for a message with no guild', () => {
    const msg: DiscordMessage = { id: 'M1', channel_id: 'C1' };
    expect(
      expandMentionedUserIds(msg, { membersOfRole: () => [], dmRecipientIds: ['U7'] }),
    ).toEqual(['U7']);
  });

  it('does not add DM recipients for a guild message', () => {
    const msg: DiscordMessage = {
      id: 'M1',
      channel_id: 'C1',
      guild_id: 'G1',
      mentions: [{ id: 'U2' }],
    };
    expect(
      expandMentionedUserIds(msg, { membersOfRole: () => [], dmRecipientIds: ['U7'] }),
    ).toEqual(['U2']);
  });

  it('deduplicates across mention kinds and excludes the author', () => {
    const msg: DiscordMessage = {
      id: 'M1',
      channel_id: 'C1',
      guild_id: 'G1',
      author: { id: 'U1' },
      mentions: [{ id: 'U2' }, { id: 'U2' }],
      mention_roles: ['R1'],
      referenced_message: { author: { id: 'U1' } }, // the author replying to themselves — excluded
    };
    const opts = { membersOfRole: (r: string) => (r === 'R1' ? ['U2', 'U4'] : []) };
    expect(expandMentionedUserIds(msg, opts)).toEqual(['U2', 'U4']);
  });
});
