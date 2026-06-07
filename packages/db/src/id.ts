/**
 * The single repo-wide ULID generator.
 *
 * @remarks
 * Every entity id in Docket is a 26-char Crockford-base32 ULID (lexicographically
 * sortable, time-prefixed). This is the ONLY id generator — no uuid, no cuid2 — and
 * Better Auth is configured (`advanced.database.generateId`) to share it so the
 * `user`/`session`/`account` ids line up with `actor.user_id`.
 *
 * @returns a new 26-char ULID string.
 *
 * @example
 * ```ts
 * const id = genId(); // "01JABCD...": matches /^[0-9A-HJKMNP-TV-Z]{26}$/
 * ```
 */
import { ulid } from 'ulid';

/** Generate a new 26-char Crockford-base32 ULID — the single repo-wide id generator. */
export const genId = (): string => ulid();
