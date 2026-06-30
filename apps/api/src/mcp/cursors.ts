/**
 * `@docket/api` -- signed opaque cursor codec for MCP pagination.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

interface SignedCursor<Payload> {
  readonly payload: Payload;
  readonly sig: string;
}

interface CursorCodecOptions<Payload> {
  readonly payloadSchema: z.ZodType<Payload>;
  readonly invalidCursorError: () => Error;
  readonly secretMissingError: () => Error;
}

/**
 * Encodes and decodes signed, opaque pagination cursors.
 *
 * @typeParam Payload - The shape of the data carried inside the cursor.
 */
export interface CursorCodec<Payload> {
  /** Serialize and sign a payload into an opaque base64url cursor string. */
  encode(payload: Payload): string;
  /** Verify and decode an opaque cursor string back into its payload. */
  decode(cursor: string): Payload;
}

function signingSecret(error: Error): string {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (!secret) throw error;
  return secret;
}

/**
 * Build a {@link CursorCodec} that HMAC-signs payloads with the app secret.
 *
 * @typeParam Payload - The shape of the data carried inside the cursor.
 * @param options - Payload schema plus factories for invalid-cursor and
 *   missing-secret errors.
 * @returns A codec whose cursors are tamper-evident via constant-time
 *   signature comparison.
 */
export function createCursorCodec<Payload>({
  payloadSchema,
  invalidCursorError,
  secretMissingError,
}: CursorCodecOptions<Payload>): CursorCodec<Payload> {
  const signedSchema: z.ZodType<SignedCursor<Payload>> = z.object({
    payload: payloadSchema,
    sig: z.string(),
  });

  function sign(payload: Payload): string {
    return createHmac('sha256', signingSecret(secretMissingError()))
      .update(JSON.stringify(payload))
      .digest('base64url');
  }

  return {
    encode(payload) {
      return Buffer.from(JSON.stringify({ payload, sig: sign(payload) }), 'utf8').toString(
        'base64url',
      );
    },
    decode(cursor) {
      let parsed: SignedCursor<Payload>;
      try {
        parsed = signedSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
      } catch {
        throw invalidCursorError();
      }

      const expected = Buffer.from(sign(parsed.payload));
      const actual = Buffer.from(parsed.sig);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        throw invalidCursorError();
      }
      return parsed.payload;
    },
  };
}
