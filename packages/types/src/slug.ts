/**
 * `@docket/types` — the public URL path-segment shape.
 *
 * @remarks
 * One rule set for every string that ends up as a segment in a URL someone else reads: a
 * workspace's own identity slug ({@link OrgCreate}/{@link OrgUpdate}, `@docket/types/organization`)
 * and a published brief's own path segment ({@link PublicationCreate}/{@link PublicationUpdate},
 * `@docket/types/publish`). Neither domain owns this — it lives here, neutrally, so publishing
 * importing it from "organization" (or vice versa) never has to happen.
 */
import { z } from 'zod';

/**
 * Path segments no workspace or brief may claim.
 *
 * @remarks
 * Two distinct hazards, one list. Some entries (`api`, `admin`, `app`, `www`, `mail`) would let a
 * workspace impersonate a product host if the shared brief host were ever flattened; the rest
 * (`sign-in`, `settings`, `_next`, `privacy`) are real Docket paths, and a workspace answering on
 * one of them would shadow a page the product owns. Screening every public path segment — a
 * workspace's own identity slug included, since it doubles as its default brief address — against
 * one list is what CORE-32's "reserved/system slugs are refused" asks for, and keeping it here
 * means the API rejects and the UI warns from the same source, for every caller.
 */
export const RESERVED_PUBLIC_SLUGS: readonly string[] = [
  '_next',
  'about',
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'blog',
  'brief',
  'briefs',
  'cdn',
  'dashboard',
  'docket',
  'docs',
  'domain',
  'health',
  'help',
  'hub',
  'internal',
  'legal',
  'login',
  'mail',
  'me',
  'new',
  'onboarding',
  'orgs',
  'pricing',
  'privacy',
  'problems',
  'public',
  'settings',
  'sign-in',
  'sign-out',
  'sign-up',
  'signin',
  'signup',
  'static',
  'status',
  'support',
  'terms',
  'today',
  'v1',
  'www',
];

/** The shape every public slug must take: lowercase alphanumerics, single-hyphen separated. */
export const PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Longest slug accepted, short enough to stay legible in a shared link. */
export const PUBLIC_SLUG_MAX_LENGTH = 64;

/**
 * A URL-safe public path segment: lowercase alphanumerics separated by single hyphens.
 *
 * @remarks
 * Deliberately stricter than "what a URL allows". A public slug is something a person reads off a
 * slide and types into a phone, so mixed case, underscores, dots, and percent-encoding are all
 * refused rather than normalized — silently changing what someone typed produces a link they
 * cannot reproduce.
 */
export const PublicSlug = z
  .string()
  .min(1)
  .max(PUBLIC_SLUG_MAX_LENGTH)
  .regex(PUBLIC_SLUG_PATTERN)
  .refine((value) => !RESERVED_PUBLIC_SLUGS.includes(value), {
    error: 'reserved',
  })
  .describe(
    'A public path segment: 1–64 characters, lowercase letters/digits separated by single hyphens, and not one of the reserved system names.',
  );
/** Public slug value. */
export type PublicSlug = z.infer<typeof PublicSlug>;

/**
 * Best-effort conversion of free text into a candidate slug.
 *
 * @remarks
 * A *suggestion*, never an authority: the result is offered so the common case needs no typing,
 * and it is re-validated by {@link PublicSlug} on the way in like any other input. Returns an
 * empty string when the input has no slug-able characters at all (e.g. text that is entirely
 * emoji), which callers treat as "ask the person to choose".
 *
 * @param text - The record title, workspace name, or other free text to derive a slug from.
 * @returns A candidate slug, possibly empty.
 *
 * @example
 * ```ts
 * suggestSlug('Q3 — Payments Reliability!'); // 'q3-payments-reliability'
 * ```
 */
export function suggestSlug(text: string): string {
  const slug = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PUBLIC_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  return RESERVED_PUBLIC_SLUGS.includes(slug) ? '' : slug;
}
