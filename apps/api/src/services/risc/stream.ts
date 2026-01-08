/**
 * RISC Stream Management Service
 *
 * Handles registration and management of RISC (Cross-Account Protection) streams
 * with Google's RISC API.
 *
 * See: https://developers.google.com/identity/protocols/risc
 *
 * @packageDocumentation
 */

import { SignJWT, importPKCS8 } from 'jose';
import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import { RISC_EVENT_TYPES, type RISCStreamConfig, type RISCStreamStatus } from './types.js';

// =============================================================================
// Constants
// =============================================================================

const RISC_API_BASE = 'https://risc.googleapis.com/v1beta';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const RISC_SCOPE = 'https://www.googleapis.com/auth/risc.configuration';

/**
 * All event types we want to receive.
 */
const REQUESTED_EVENT_TYPES = [
  RISC_EVENT_TYPES.SESSIONS_REVOKED,
  RISC_EVENT_TYPES.TOKENS_REVOKED,
  RISC_EVENT_TYPES.ACCOUNT_DISABLED,
  RISC_EVENT_TYPES.ACCOUNT_ENABLED,
  RISC_EVENT_TYPES.CREDENTIAL_CHANGE_REQUIRED,
  RISC_EVENT_TYPES.VERIFICATION,
  RISC_EVENT_TYPES.OAUTH_TOKENS_REVOKED,
  RISC_EVENT_TYPES.OAUTH_TOKEN_REVOKED,
];

// =============================================================================
// Token Cache
// =============================================================================

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: CachedToken | null = null;

// =============================================================================
// Authentication
// =============================================================================

/**
 * Get an access token using Application Default Credentials.
 * This works automatically in GCP environments (Cloud Run, Cloud Functions, GKE)
 * and locally with `gcloud auth application-default login`.
 */
async function getAccessTokenViaADC(): Promise<string> {
  // Dynamic import to avoid issues if google-auth-library is not installed
  const { GoogleAuth } = (await import('google-auth-library')) as {
    GoogleAuth: new (options: { scopes: string[] }) => {
      getClient: () => Promise<{
        getAccessToken: () => Promise<{ token?: string | null }>;
      }>;
    };
  };

  const auth = new GoogleAuth({
    scopes: [RISC_SCOPE],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  if (!tokenResponse.token) {
    throw new Error('Failed to obtain access token via ADC');
  }

  return tokenResponse.token;
}

/**
 * Generate a signed JWT for service account authentication.
 * Used when ADC is disabled and explicit credentials are provided.
 */
async function generateServiceAccountJWT(
  serviceAccountEmail: string,
  privateKey: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Import the private key (PEM format)
  const key = await importPKCS8(privateKey, 'RS256');

  const jwt = await new SignJWT({
    scope: RISC_SCOPE,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(serviceAccountEmail)
    .setSubject(serviceAccountEmail)
    .setAudience(TOKEN_ENDPOINT)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600) // 1 hour
    .sign(key);

  return jwt;
}

/**
 * Exchange a service account JWT for an access token.
 */
async function exchangeJWTForAccessToken(
  jwt: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange JWT for access token: ${error}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Get an access token for the RISC API.
 * Uses ADC by default, falls back to explicit credentials if configured.
 */
async function getAccessToken(): Promise<string> {
  const config = env.riscConfig;
  if (!config) {
    throw new Error('RISC configuration not available');
  }

  // Check cache (with 5 minute buffer)
  if (tokenCache && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) {
    return tokenCache.accessToken;
  }

  let accessToken: string;
  let expiresIn = 3600; // Default 1 hour

  if (config.useAdc) {
    // Use Application Default Credentials
    try {
      accessToken = await getAccessTokenViaADC();
    } catch (adcError) {
      // If ADC fails and we have explicit credentials, try those
      if (config.serviceAccountEmail && config.privateKey) {
        logger.warn({ error: adcError }, '[RISC] ADC failed, falling back to explicit credentials');
        const jwt = await generateServiceAccountJWT(config.serviceAccountEmail, config.privateKey);
        const tokenResponse = await exchangeJWTForAccessToken(jwt);
        accessToken = tokenResponse.accessToken;
        expiresIn = tokenResponse.expiresIn;
      } else {
        throw new Error(
          `Failed to obtain access token via ADC: ${adcError instanceof Error ? adcError.message : 'Unknown error'}`,
        );
      }
    }
  } else {
    // Use explicit credentials
    if (!config.serviceAccountEmail || !config.privateKey) {
      throw new Error('RISC explicit credentials required but not configured');
    }
    const jwt = await generateServiceAccountJWT(config.serviceAccountEmail, config.privateKey);
    const tokenResponse = await exchangeJWTForAccessToken(jwt);
    accessToken = tokenResponse.accessToken;
    expiresIn = tokenResponse.expiresIn;
  }

  // Cache the token
  tokenCache = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return accessToken;
}

// =============================================================================
// API Helpers
// =============================================================================

/**
 * Make an authenticated request to the RISC API.
 */
async function riscApiRequest<T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<T> {
  const accessToken = await getAccessToken();
  const url = `${RISC_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`RISC API error (${String(response.status)}): ${error}`);
  }

  // Some endpoints return empty responses
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

// =============================================================================
// Stream Management Functions
// =============================================================================

/**
 * Get the current RISC stream configuration.
 */
export async function getStream(): Promise<RISCStreamConfig | null> {
  try {
    return await riscApiRequest<RISCStreamConfig>('/stream');
  } catch (error) {
    // 404 means no stream configured
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

/**
 * Register or update the RISC stream configuration.
 */
export async function registerStream(webhookUrl: string): Promise<RISCStreamConfig> {
  const streamConfig = {
    delivery: {
      delivery_method: 'https://schemas.openid.net/secevent/risc/delivery-method/push' as const,
      url: webhookUrl,
    },
    events_requested: REQUESTED_EVENT_TYPES,
  };

  return await riscApiRequest<RISCStreamConfig>('/stream:update', {
    method: 'POST',
    body: streamConfig,
  });
}

/**
 * Update the stream status (enable/disable).
 */
export async function updateStreamStatus(enabled: boolean): Promise<void> {
  await riscApiRequest<unknown>('/stream/status:update', {
    method: 'POST',
    body: {
      status: enabled ? 'enabled' : 'disabled',
    },
  });
}

/**
 * Request a verification event to test the webhook.
 */
export async function requestVerification(state?: string): Promise<void> {
  await riscApiRequest<unknown>('/stream:verify', {
    method: 'POST',
    body: {
      state: state ?? crypto.randomUUID(),
    },
  });
}

/**
 * Get the current stream status.
 */
export async function getStreamStatus(): Promise<RISCStreamStatus | null> {
  try {
    return await riscApiRequest<RISCStreamStatus>('/stream/status');
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the RISC stream on application startup.
 *
 * This function:
 * 1. Checks if a stream is already configured
 * 2. Registers/updates the stream with our webhook URL
 * 3. Ensures the stream is enabled
 * 4. Optionally sends a verification event
 */
export async function initializeRISCStream(): Promise<void> {
  const config = env.riscConfig;
  if (!config) {
    logger.info('[RISC] Stream management not configured (missing RISC_WEBHOOK_URL)');
    return;
  }

  try {
    // Check current stream configuration
    const currentStream = await getStream();

    if (currentStream) {
      // Stream exists - check if webhook URL matches
      if (currentStream.delivery.url === config.webhookUrl) {
        logger.info(
          { webhookUrl: config.webhookUrl },
          '[RISC] Stream already configured with correct webhook URL',
        );
      } else {
        // Update webhook URL
        logger.info(
          {
            oldUrl: currentStream.delivery.url,
            newUrl: config.webhookUrl,
          },
          '[RISC] Updating stream webhook URL',
        );
        await registerStream(config.webhookUrl);
      }
    } else {
      // No stream exists - create one
      logger.info({ webhookUrl: config.webhookUrl }, '[RISC] Registering new RISC stream');
      await registerStream(config.webhookUrl);
    }

    // Ensure stream is enabled
    const status = await getStreamStatus();
    if (status?.status !== 'enabled') {
      logger.info('[RISC] Enabling stream');
      await updateStreamStatus(true);
    }

    // Request verification event
    const verificationState = crypto.randomUUID();
    logger.info({ state: verificationState }, '[RISC] Requesting verification event');
    await requestVerification(verificationState);

    logger.info('[RISC] Stream initialization complete');
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      '[RISC] Stream initialization failed',
    );
    throw error;
  }
}
