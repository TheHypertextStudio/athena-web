/**
 * `@docket/api` — the things Athena says on the phone before a conversation can start.
 *
 * @remarks
 * Two announcements, both written as **copy**, both tested as copy. A caller whose organization
 * does not own Docket Pro, and a caller Docket does not recognize, each get a spoken sentence rather than a tone, a
 * silence, or an error read aloud.
 *
 * ## Tone is a requirement, not a preference
 *
 * These scripts contain no error codes, no status text, and none of the words "denied",
 * "forbidden", "unauthorized", "invalid" or "failed" — {@link forbiddenAnnouncementWords} names
 * them and a test asserts their absence. A phone line is the most exposed surface a product has:
 * there is no visual context, no back button, and no way to re-read. Anything that sounds like a
 * system error sounds, to the person holding the phone, like they did something wrong.
 *
 * ## The URL is dictated, not gestured at
 *
 * "Visit our website" is a dead end when you are holding a phone to your ear. The product
 * announcement speaks the exact address, host and path, with the path spoken as "slash pricing" so
 * it survives text-to-speech. The host comes from the host-config contract
 * (`WEB_URL`), so the address the caller hears follows the product's own host and
 * cannot drift from it during a domain cutover.
 */
import { apiHosts, requireEnvOrigin } from '@docket/env/api';

/** The path on the web app that explains Docket and Docket Pro. */
export const PRICING_PATH = '/pricing';

/** Words a gating announcement must never contain. */
export const forbiddenAnnouncementWords: readonly string[] = [
  'denied',
  'forbidden',
  'unauthorized',
  'invalid',
  'failed',
];

/**
 * The exact URL a caller is told to visit.
 *
 * @remarks
 * Absolute, on the product's own apex, and the same string the acceptance check fetches. Built
 * from `WEB_URL` rather than assembled from parts so a half-applied domain
 * cutover fails at boot instead of dictating an address that does not resolve.
 *
 * @returns e.g. `https://docket.place/pricing`.
 */
export function pricingUrl(): string {
  return `${requireEnvOrigin(apiHosts.app, 'WEB_URL')}${PRICING_PATH}`;
}

/**
 * Render a URL so a text-to-speech voice reads it as a person would say it.
 *
 * @remarks
 * Drops the scheme (nobody dictates "h-t-t-p-s colon slash slash"), keeps the host intact so the
 * listener hears the dots, and speaks the path separator as the word "slash". The result is
 * meant to be heard once and typed correctly.
 *
 * @param url - An absolute URL.
 * @returns the spoken form, e.g. `docket.place slash pricing`.
 */
export function speakableUrl(url: string): string {
  const withoutScheme = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const [host = '', ...segments] = withoutScheme.split('/');
  return [host, ...segments.map((segment) => `slash ${segment}`)].join(' ');
}

/**
 * What a caller hears when their organization does not own Docket Pro.
 *
 * @remarks
 * Opens with a greeting, states the one fact that matters (Docket Pro is needed, and purchase is on the
 * web), dictates the address twice — once spoken for the ear, once written for the transcript and
 * for any provider that renders it — and closes with a next step. Nothing about what went wrong,
 * because nothing went wrong.
 *
 * @returns the announcement script.
 */
export function productRequiredAnnouncement(): string {
  const url = pricingUrl();
  return [
    'Hi, this is Athena from Docket.',
    'Calling Athena requires Docket Pro, and this organization does not have it.',
    `A workspace administrator can add Docket Pro at ${speakableUrl(url)}. That is ${url}.`,
    'After Docket Pro is active, call this number again.',
  ].join(' ');
}

/**
 * What a caller hears when the number they are calling from is not bound to any account.
 *
 * @remarks
 * Deliberately says nothing about *why*. A line that distinguishes "unknown number" from "number
 * awaiting verification" is an oracle for testing whether a phone number belongs to a Docket
 * customer, which is a privacy leak available to anyone with a phone.
 *
 * @returns the announcement script.
 */
export function unrecognizedCallerAnnouncement(): string {
  const url = requireEnvOrigin(apiHosts.app, 'WEB_URL');
  return [
    'Hi, this is Athena from Docket.',
    'I can only pick up when I recognize the number you are calling from.',
    `Add this number to your account at ${speakableUrl(url)}, confirm the code I text you, and then give me a ring.`,
    'See you soon.',
  ].join(' ');
}

/** The greeting a recognized, entitled caller hears as the conversation opens. */
export function callerGreeting(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first ? `Hi ${first}, it's Athena. What's on your mind?` : "Hi, it's Athena. What's up?";
}
