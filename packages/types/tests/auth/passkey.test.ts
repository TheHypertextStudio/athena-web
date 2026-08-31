import { describe, expect, it } from 'vitest';

import {
  passkeyAuthenticatorKind,
  passkeyAuthenticatorKindLabel,
  type PasskeyAuthenticatorFacts,
  type PasskeyAuthenticatorKind,
} from '../../src/passkey';

describe('passkey authenticator presentation', () => {
  it.each<[PasskeyAuthenticatorFacts, PasskeyAuthenticatorKind]>([
    [{ transports: 'usb' }, 'security-key'],
    [{ transports: ['nfc'] }, 'security-key'],
    [{ transports: 'ble' }, 'security-key'],
    [{ transports: 'usb, internal' }, 'device'],
    [{ deviceType: 'multiDevice' }, 'synced'],
    [{ backedUp: true }, 'synced'],
    [{ transports: ' internal, ' }, 'device'],
    [{ transports: ['hybrid'] }, 'nearby-device'],
    [{ transports: null }, 'unknown'],
    [{}, 'unknown'],
  ])('classifies %# from stored WebAuthn facts', (facts, expected) => {
    expect(passkeyAuthenticatorKind(facts)).toBe(expected);
  });

  it.each<[PasskeyAuthenticatorKind, string]>([
    ['synced', 'Synced passkey'],
    ['device', 'Device passkey'],
    ['security-key', 'Security key'],
    ['nearby-device', 'Nearby-device passkey'],
    ['unknown', 'Passkey'],
  ])('labels %s as %s', (kind, label) => {
    expect(passkeyAuthenticatorKindLabel(kind)).toBe(label);
  });
});
