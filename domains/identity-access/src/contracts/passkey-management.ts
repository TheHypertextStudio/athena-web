/** Safe passkey-management transport contracts. */
import { z } from 'zod';

/** A user-visible passkey summary with no assertion material. */
export const PasskeySummary = z.object({
  id: z.string(),
  name: z.string().nullable(),
  deviceType: z.string(),
  backedUp: z.boolean(),
  transports: z.array(z.string()),
  aaguid: z.string().nullable(),
  createdAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
});
/** User-visible passkey summary. */
export type PasskeySummary = z.infer<typeof PasskeySummary>;

/** The signed-in user's passkeys. */
export const PasskeyListOut = z.object({ items: z.array(PasskeySummary) });
/** Passkey list response. */
export type PasskeyListOut = z.infer<typeof PasskeyListOut>;

/** Rename one passkey. */
export const PasskeyRenameIn = z.object({ name: z.string().trim().min(1).max(100) });
/** Passkey rename input. */
export type PasskeyRenameIn = z.infer<typeof PasskeyRenameIn>;

/** Successful deletion plus the provider credential to invalidate locally. */
export const PasskeyDeleteOut = z.object({
  status: z.literal(true),
  credentialId: z.string(),
});
/** Passkey deletion response. */
export type PasskeyDeleteOut = z.infer<typeof PasskeyDeleteOut>;
