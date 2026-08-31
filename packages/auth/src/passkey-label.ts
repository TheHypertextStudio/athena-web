import { getAuthenticatorName } from '@better-auth/passkey';
import {
  passkeyAuthenticatorKind,
  passkeyAuthenticatorKindLabel,
  type PasskeyAuthenticatorFacts,
} from '@docket/types';
import Bowser from 'bowser';

/** The registration evidence available after Better Auth verifies a new credential. */
export interface PasskeyLabelFacts extends PasskeyAuthenticatorFacts {
  readonly aaguid?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
}

/** Build a stable browser and operating-system label from an HTTP User-Agent header. */
function browserLabel(userAgent: string | null | undefined): string | undefined {
  if (!userAgent?.trim()) return undefined;
  const parser = Bowser.getParser(userAgent);
  const browser = parser.getBrowserName();
  const operatingSystem = parser.getOSName();
  if (browser && operatingSystem) return `${browser} on ${operatingSystem}`;
  return browser || operatingSystem || undefined;
}

/**
 * Derive the best label the registration ceremony can support without asking the person to type.
 *
 * @param facts - The authenticator identifier, request User-Agent, and WebAuthn registration facts.
 * @returns a provider label, browser label, or conservative authenticator-kind fallback.
 */
export function derivePasskeyLabel(facts: PasskeyLabelFacts): string {
  const authenticatorName = facts.aaguid ? getAuthenticatorName(facts.aaguid) : undefined;
  if (authenticatorName) return authenticatorName;

  return (
    browserLabel(facts.userAgent) ?? passkeyAuthenticatorKindLabel(passkeyAuthenticatorKind(facts))
  );
}
