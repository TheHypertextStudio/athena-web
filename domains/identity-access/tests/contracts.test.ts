import { describe, expect, it } from 'vitest';

import { ActorOut } from '../src/contracts/actor';
import {
  IdentityDeleteOut,
  IdentityListOut,
  IdentityOut,
  IdentityProvider,
} from '../src/contracts/identity';
import {
  InvitationAccept,
  InvitationOut,
  InvitationRevokeOut,
  MemberInvite,
  MemberOut,
  MemberRemoveOut,
  MemberUpdate,
} from '../src/contracts/member';
import { OAuthClientMetadataOut } from '../src/contracts/oauth-client';
import { OFFLINE_ACCESS_SCOPE, OAUTH_ISSUABLE_SCOPES } from '../src/contracts/oauth-scope';
import { PublicConfigOut, SignInProvider } from '../src/contracts/public-config';
import { SESSION_OWNER_HEADER, SessionListOut, SessionOut } from '../src/contracts/session';

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const NOW = '2026-08-31T12:00:00.000Z';

describe('identity and access contracts', () => {
  it('keeps actors and memberships organization-scoped', () => {
    expect(
      ActorOut.parse({
        id: ID,
        organizationId: OTHER_ID,
        kind: 'human',
        displayName: 'Ada',
        status: 'active',
        roleId: ID,
      }).kind,
    ).toBe('human');
    expect(ActorOut.safeParse({ id: ID, kind: 'service' }).success).toBe(false);

    expect(
      MemberOut.parse({
        actorId: ID,
        organizationId: OTHER_ID,
        displayName: 'Ada',
        status: 'active',
        roleId: ID,
        createdAt: NOW,
      }).status,
    ).toBe('active');
    expect(MemberInvite.parse({ email: 'ada@example.com', roleId: ID }).email).toBe(
      'ada@example.com',
    );
    expect(MemberInvite.safeParse({ email: 'not-an-email', roleId: ID }).success).toBe(false);
    expect(MemberUpdate.parse({ status: 'suspended' }).status).toBe('suspended');
    expect(InvitationAccept.parse({ token: 'opaque' }).token).toBe('opaque');
    expect(
      InvitationOut.parse({
        id: ID,
        organizationId: OTHER_ID,
        email: 'ada@example.com',
        roleId: ID,
        asGuest: false,
        status: 'pending',
        expiresAt: NOW,
        createdAt: NOW,
      }).status,
    ).toBe('pending');
    expect(MemberRemoveOut.parse({ id: ID, removed: true }).removed).toBe(true);
    expect(InvitationRevokeOut.parse({ id: ID, revoked: true }).revoked).toBe(true);
  });

  it('describes linked identities without exposing credentials', () => {
    const identity = IdentityOut.parse({
      accountId: 'provider-account',
      provider: 'google',
      email: 'ada@example.com',
      name: 'Ada',
      picture: null,
      scopes: ['openid'],
      linkedAt: NOW,
      connectionCount: 1,
    });
    expect(identity.provider).toBe('google');
    expect(IdentityProvider.safeParse('password').success).toBe(false);
    expect(IdentityListOut.parse({ items: [identity] }).items).toHaveLength(1);
    expect(IdentityDeleteOut.parse({ status: true }).status).toBe(true);
  });

  it('keeps client, session, and public configuration fields narrow', () => {
    expect(OAuthClientMetadataOut.parse({ name: 'Claude', icon: null }).name).toBe('Claude');
    expect(OAUTH_ISSUABLE_SCOPES).toContain(OFFLINE_ACCESS_SCOPE);
    expect(SignInProvider.parse('apple')).toBe('apple');
    expect(
      PublicConfigOut.parse({
        appMode: 'production',
        oauthProviders: ['google'],
        googleServerClientId: null,
        connectors: ['calendar'],
        mcpUrl: null,
      }).connectors,
    ).toEqual(['calendar']);

    const session = SessionOut.parse({
      id: ID,
      current: true,
      ipAddress: null,
      userAgent: null,
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: NOW,
    });
    expect(SessionListOut.parse({ items: [session] }).items).toHaveLength(1);
    expect(SESSION_OWNER_HEADER).toBe('X-Docket-Session-Owner');
  });
});
