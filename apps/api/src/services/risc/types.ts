/**
 * RISC (Cross-Account Protection) Types
 *
 * Type definitions for Google's Cross-Account Protection (RISC) protocol.
 * See: https://developers.google.com/identity/protocols/risc
 *
 * @packageDocumentation
 */

import type { JWTPayload } from 'jose';

// =============================================================================
// Event Type URIs
// =============================================================================

/**
 * RISC event type URIs as defined in the RISC and OAuth security event specs.
 */
export const RISC_EVENT_TYPES = {
  // Standard RISC events (https://schemas.openid.net/secevent/risc/...)
  SESSIONS_REVOKED: 'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
  TOKENS_REVOKED: 'https://schemas.openid.net/secevent/risc/event-type/tokens-revoked',
  ACCOUNT_DISABLED: 'https://schemas.openid.net/secevent/risc/event-type/account-disabled',
  ACCOUNT_ENABLED: 'https://schemas.openid.net/secevent/risc/event-type/account-enabled',
  CREDENTIAL_CHANGE_REQUIRED:
    'https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required',
  VERIFICATION: 'https://schemas.openid.net/secevent/risc/event-type/verification',

  // OAuth security events (https://schemas.openid.net/secevent/oauth/...)
  OAUTH_TOKENS_REVOKED: 'https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked',
  OAUTH_TOKEN_REVOKED: 'https://schemas.openid.net/secevent/oauth/event-type/token-revoked',
} as const;

/** Union type of all known event type URIs. */
export type RISCEventTypeUri = (typeof RISC_EVENT_TYPES)[keyof typeof RISC_EVENT_TYPES];

// =============================================================================
// Subject Types
// =============================================================================

/**
 * Issuer-subject identifier.
 * The most common subject type - identifies a user by their Google account ID.
 */
export interface IssSubSubject {
  subject_type: 'iss-sub';
  /** Issuer (e.g., 'https://accounts.google.com'). */
  iss: string;
  /** Subject identifier (Google user ID). */
  sub: string;
  /** Optional email address. */
  email?: string;
}

/**
 * ID token claims subject identifier.
 * Identifies a user by email from their ID token claims.
 */
export interface IdTokenClaimsSubject {
  subject_type: 'id_token_claims';
  /** Issuer. */
  iss: string;
  /** Email address from the ID token. */
  email: string;
}

/**
 * Token subject identifier.
 * Used for OAuth token-revoked events to identify a specific token.
 */
export interface TokenSubject {
  subject_type: 'token';
  /** Type of token (currently only refresh_token is used). */
  token_type: 'refresh_token';
  /**
   * Algorithm used to identify the token:
   * - 'prefix': First 16 characters of the token
   * - 'hash_base64_sha256': Base64 SHA-256 hash
   * - 'hash_base64url_sha256': Base64URL SHA-256 hash
   */
  token_identifier_alg: 'prefix' | 'hash_base64_sha256' | 'hash_base64url_sha256';
  /** The token identifier (prefix or hash). */
  token: string;
}

/** Union of all subject types. */
export type RISCSubject = IssSubSubject | IdTokenClaimsSubject | TokenSubject;

// =============================================================================
// Event Payloads
// =============================================================================

/**
 * Base event payload structure.
 */
export interface RISCEventPayload {
  /** Subject of the event. */
  subject?: RISCSubject;
  /** Reason for the event (used in account-disabled, verification). */
  reason?: string;
  /** State parameter (used in verification events). */
  state?: string;
}

/**
 * Decoded RISC JWT payload.
 */
export interface RISCTokenPayload extends JWTPayload {
  /** Map of event type URIs to their payloads. */
  events: Record<string, RISCEventPayload>;
}

// =============================================================================
// Stream Management Types
// =============================================================================

/**
 * RISC stream delivery configuration.
 */
export interface RISCStreamDelivery {
  /** Delivery method (always 'push' for webhooks). */
  delivery_method: 'https://schemas.openid.net/secevent/risc/delivery-method/push';
  /** Webhook URL to receive events. */
  url: string;
}

/**
 * RISC stream configuration returned by Google.
 */
export interface RISCStreamConfig {
  /** Delivery configuration. */
  delivery: RISCStreamDelivery;
  /** List of requested event type URIs. */
  events_requested: string[];
  /** List of event types Google will actually deliver. */
  events_supported?: string[];
  /** List of event types being delivered. */
  events_delivered?: string[];
}

/**
 * Stream status response.
 */
export interface RISCStreamStatus {
  /** Whether the stream is enabled or disabled. */
  status: 'enabled' | 'disabled';
}

/**
 * Error response from RISC API.
 */
export interface RISCApiError {
  error: {
    code: number;
    message: string;
    status: string;
  };
}

// =============================================================================
// Processing Result Types
// =============================================================================

/**
 * Result of processing a RISC event.
 */
export interface RISCProcessingResult {
  /** Whether processing was successful. */
  success: boolean;
  /** List of event types that were processed. */
  eventTypes: string[];
  /** Whether this was a duplicate event (already processed). */
  duplicate?: boolean;
}

/**
 * User lookup result from subject resolution.
 */
export interface ResolvedUser {
  /** Internal user ID. */
  userId: string;
  /** User's email address. */
  userEmail: string;
}
