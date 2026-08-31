/** The product-facing categories Docket can infer from stored WebAuthn registration facts. */
export type PasskeyAuthenticatorKind =
  'synced' | 'device' | 'security-key' | 'nearby-device' | 'unknown';

/** The WebAuthn registration facts used to classify a passkey without guessing its brand. */
export interface PasskeyAuthenticatorFacts {
  readonly deviceType?: string | null | undefined;
  readonly backedUp?: boolean | null | undefined;
  readonly transports?: string | readonly string[] | null | undefined;
}

/** Normalize Better Auth's comma-separated transport storage into individual transport names. */
function normalizedTransports(
  transports: PasskeyAuthenticatorFacts['transports'],
): ReadonlySet<string> {
  const values = typeof transports === 'string' ? transports.split(',') : (transports ?? []);
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

/**
 * Classify a passkey by how its authenticator works rather than by an unreliable provider guess.
 *
 * @param facts - The device, backup, and transport facts stored by Better Auth.
 * @returns the narrow authenticator category Docket can support with the available evidence.
 */
export function passkeyAuthenticatorKind(
  facts: PasskeyAuthenticatorFacts,
): PasskeyAuthenticatorKind {
  const transports = normalizedTransports(facts.transports);
  const hasExternalHardware =
    transports.has('usb') || transports.has('nfc') || transports.has('ble');

  if (hasExternalHardware && !transports.has('internal')) return 'security-key';
  if (facts.deviceType === 'multiDevice' || facts.backedUp) return 'synced';
  if (transports.has('internal')) return 'device';
  if (transports.has('hybrid')) return 'nearby-device';
  return 'unknown';
}

/**
 * Return the concise label shown beside an authenticator-kind icon.
 *
 * @param kind - The inferred authenticator category.
 * @returns the user-facing category label.
 */
export function passkeyAuthenticatorKindLabel(kind: PasskeyAuthenticatorKind): string {
  switch (kind) {
    case 'synced':
      return 'Synced passkey';
    case 'device':
      return 'Device passkey';
    case 'security-key':
      return 'Security key';
    case 'nearby-device':
      return 'Nearby-device passkey';
    case 'unknown':
      return 'Passkey';
  }
}
